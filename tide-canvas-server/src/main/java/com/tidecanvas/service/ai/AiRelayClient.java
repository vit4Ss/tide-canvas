package com.tidecanvas.service.ai;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tidecanvas.mapper.AiModelMapper;
import com.tidecanvas.mapper.AiProviderMapper;
import com.tidecanvas.model.entity.AiGenerationLogDO;
import com.tidecanvas.model.entity.AiModelDO;
import com.tidecanvas.model.entity.AiProviderDO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * AI 中转站（ScarecrowToken Relay）客户端。
 * <p>
 * 兼容 {@code relay.mbfczzzz.top/v1} 协议：文生图 {@code /images/generations}、
 * 图生图 {@code /images/edits}、视频任务 {@code /contents/generations/tasks}，
 * 统一处理「200 同步成功」与「202 异步受理 + 轮询 {@code /tasks/{id}}」两种返回形态，
 * 并解析 OpenAI 风格错误信封。供各 AI Handler 复用。
 *
 * @author tidecanvas
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AiRelayClient {

    private final AiModelMapper modelMapper;
    private final AiProviderMapper providerMapper;
    private final ObjectMapper objectMapper;
    private final GenerationLogRecorder logRecorder;

    /** 轮询间隔（毫秒） */
    private static final long POLL_INTERVAL_MILLIS = 3_000L;
    /** 轮询最长时间（毫秒）—— 视频任务可能较慢，给足时间确保结果最终落库 */
    private static final long MAX_POLL_MILLIS = 6 * 60 * 1000L;

    /** 共享 RestClient（不可变、线程安全，构建一次复用） */
    private final RestClient http = buildClient();

    /** 供应商是否可用（已配置 baseUrl + apiKey） */
    public boolean isUsable(AiProviderDO provider) {
        return provider != null
                && StringUtils.hasText(provider.getBaseUrl())
                && StringUtils.hasText(provider.getApiKey());
    }

    /** 解析供应商：优先按 model 关联，找不到则取优先级最高的启用供应商 */
    public AiProviderDO resolveProvider(String modelId) {
        if (StringUtils.hasText(modelId) && !"default".equals(modelId)) {
            AiModelDO model = modelMapper.selectOne(
                    new LambdaQueryWrapper<AiModelDO>().eq(AiModelDO::getModelId, modelId));
            if (model != null && model.getProviderId() != null) {
                AiProviderDO p = providerMapper.selectById(model.getProviderId());
                if (p != null && (p.getStatus() == null || p.getStatus() == 1)) {
                    return p;
                }
            }
        }
        return providerMapper.selectOne(
                new LambdaQueryWrapper<AiProviderDO>()
                        .eq(AiProviderDO::getStatus, 1)
                        .orderByDesc(AiProviderDO::getPriority)
                        .last("LIMIT 1"));
    }

    // ==================== 业务接口 ====================

    /** 文生图：POST {baseUrl}/images/generations，返回最终图片 URL */
    public String generate(AiProviderDO provider, String modelId, String prompt, Map<String, Object> input) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", resolveModelName(modelId, provider, "gpt-image-2"));
        body.put("prompt", prompt);
        applyImageParams(body, input);
        return submitAndResolve(provider, "/images/generations", body);
    }

    /** 图生图编辑：POST {baseUrl}/images/edits（JSON image_urls），返回最终图片 URL */
    public String edit(AiProviderDO provider, String modelId, String prompt, List<String> imageUrls, Map<String, Object> input) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", resolveModelName(modelId, provider, "gpt-image-2"));
        body.put("prompt", prompt);
        body.put("image_urls", imageUrls);
        applyImageParams(body, input);
        return submitAndResolve(provider, "/images/edits", body);
    }

    /** 视频任务：POST {baseUrl}/contents/generations/tasks（多模态 content[]），返回最终视频 URL */
    public String generateVideo(AiProviderDO provider, String modelId, String prompt, Map<String, Object> input) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", resolveModelName(modelId, provider, "seedance-v2"));
        body.put("content", buildVideoContent(prompt, input));
        String ratio = ratioOf(input);
        if (StringUtils.hasText(ratio) && !"auto".equals(ratio)) {
            body.put("ratio", ratio);
        }
        putIfText(body, "resolution", resolutionOf(input));
        putIfText(body, "duration", strOf(input.get("duration")));
        putIfText(body, "fps", strOf(input.get("fps")));
        putIfText(body, "mode", strOf(input.get("mode")));
        return submitAndResolve(provider, "/contents/generations/tasks", body);
    }

    // ==================== 协议处理 ====================

    /**
     * 提交请求并解析结果：兼容「200 同步」与「202 异步 + 轮询」两种形态。
     */
    private String submitAndResolve(AiProviderDO provider, String path, Map<String, Object> body) throws Exception {
        long start = System.currentTimeMillis();
        String fullUrl = baseUrl(provider) + path;
        ResponseEntity<String> resp = http.post()
                .uri(fullUrl)
                .header("Authorization", "Bearer " + provider.getApiKey())
                .contentType(MediaType.APPLICATION_JSON)
                .body(body)
                .retrieve()
                .onStatus(status -> true, (req, res) -> { /* 不抛异常，自行按状态码解析 */ })
                .toEntity(String.class);

        int code = resp.getStatusCode().value();
        String raw = resp.getBody();
        JsonNode root = tryParse(raw);
        String upstreamTaskId = root != null ? root.path("id").asText(null) : null;
        try {
            String url = resolveResult(provider, code, raw, root);
            recordLog(operationOf(path), fullUrl, body, code, raw, upstreamTaskId, true, url, null, start);
            return url;
        } catch (Exception e) {
            recordLog(operationOf(path), fullUrl, body, code, raw, upstreamTaskId, false, null, e.getMessage(), start);
            throw e;
        }
    }

    /** 解析上游响应：同步媒体地址 / 失败信封 / 202 异步轮询 */
    private String resolveResult(AiProviderDO provider, int code, String raw, JsonNode root) throws Exception {
        if (root == null) {
            // 非 JSON 响应（如 400 纯文本 "model is required"，或网关 HTML 错误页）
            throw new IllegalStateException(StringUtils.hasText(raw) ? raw : ("上游返回异常: HTTP " + code));
        }
        String url = extractUrl(root);
        if (url != null) {
            return url;
        }
        if (isFailed(root) || code >= 400) {
            throw new IllegalStateException(errorMessage(root, code));
        }
        String taskId = root.path("id").asText(null);
        if (StringUtils.hasText(taskId)) {
            return pollTask(provider, taskId);
        }
        throw new IllegalStateException("上游返回无法解析: HTTP " + code);
    }

    /** 记录一次上游调用日志（best-effort，由 GenerationLogRecorder 回填任务归属并落库） */
    private void recordLog(String operation, String url, Map<String, Object> body, int status, String respBody,
                           String upstreamTaskId, boolean success, String resultUrl, String error, long start) {
        AiGenerationLogDO lg = new AiGenerationLogDO();
        lg.setOperation(operation);
        lg.setRequestUrl(url);
        lg.setModel(body != null && body.get("model") != null ? String.valueOf(body.get("model")) : null);
        try {
            lg.setRequestBody(objectMapper.writeValueAsString(body));
        } catch (Exception ignore) {
            lg.setRequestBody(String.valueOf(body));
        }
        lg.setHttpStatus(status);
        lg.setResponseBody(respBody);
        lg.setUpstreamTaskId(StringUtils.hasText(upstreamTaskId) ? upstreamTaskId : null);
        lg.setSuccess(success ? 1 : 0);
        lg.setResultUrl(resultUrl);
        lg.setErrorMsg(error);
        lg.setDurationMs(System.currentTimeMillis() - start);
        logRecorder.save(lg);
    }

    private String operationOf(String path) {
        if (path.contains("/edits")) {
            return "edits";
        }
        if (path.contains("/contents/")) {
            return "video";
        }
        return "generation";
    }

    /**
     * 轮询任意异步任务状态：GET {baseUrl}/tasks/{id}，直到 succeeded / failed 或超时。
     */
    private String pollTask(AiProviderDO provider, String taskId) throws Exception {
        long deadline = System.currentTimeMillis() + MAX_POLL_MILLIS;
        String path = "/tasks/" + taskId;
        while (System.currentTimeMillis() < deadline) {
            ResponseEntity<String> resp = http.get()
                    .uri(baseUrl(provider) + path)
                    .header("Authorization", "Bearer " + provider.getApiKey())
                    .retrieve()
                    .onStatus(status -> true, (req, res) -> { })
                    .toEntity(String.class);

            int code = resp.getStatusCode().value();
            JsonNode root = tryParse(resp.getBody());
            if (code == 404) {
                throw new IllegalStateException("上游任务不存在: " + taskId);
            }
            if (code == 403) {
                throw new IllegalStateException("无权访问上游任务: " + taskId);
            }
            if (root != null) {
                String status = root.path("status").asText("");
                if ("succeeded".equalsIgnoreCase(status)) {
                    String url = extractUrl(root);
                    if (url != null) {
                        return url;
                    }
                    throw new IllegalStateException("任务成功但未返回结果地址: " + taskId);
                }
                if ("failed".equalsIgnoreCase(status) || isFailed(root)) {
                    throw new IllegalStateException(errorMessage(root, code));
                }
                // queued / processing → 继续轮询
            }
            sleep(POLL_INTERVAL_MILLIS);
        }
        throw new IllegalStateException("上游任务超时未完成: " + taskId);
    }

    /** 从响应中提取媒体地址：data[0].url / data[0].b64_json / output_url */
    private String extractUrl(JsonNode root) {
        JsonNode data = root.path("data");
        if (data.isArray() && !data.isEmpty()) {
            JsonNode first = data.get(0);
            if (first.hasNonNull("url")) {
                return first.get("url").asText();
            }
            if (first.hasNonNull("b64_json")) {
                return "data:image/png;base64," + first.get("b64_json").asText();
            }
        }
        if (root.hasNonNull("output_url") && StringUtils.hasText(root.get("output_url").asText())) {
            return root.get("output_url").asText();
        }
        return null;
    }

    /** 是否为失败响应（OpenAI 错误信封 或 status=failed） */
    private boolean isFailed(JsonNode root) {
        if (root.path("error").isObject()) {
            return true;
        }
        return "failed".equalsIgnoreCase(root.path("status").asText(""));
    }

    /** 解析错误信息：error.message / error_message / 原始文本 / 兜底 */
    private String errorMessage(JsonNode root, int code) {
        JsonNode err = root.path("error");
        if (err.isObject() && err.hasNonNull("message")) {
            return err.get("message").asText();
        }
        if (root.hasNonNull("error_message") && StringUtils.hasText(root.get("error_message").asText())) {
            return root.get("error_message").asText();
        }
        if (root.isTextual() && StringUtils.hasText(root.asText())) {
            return root.asText();
        }
        return "上游返回错误: HTTP " + code;
    }

    // ==================== 参数构建 ====================

    /** 透传图像通用参数：aspect_ratio / quality / resolution（按中转站 params_schema） */
    private void applyImageParams(Map<String, Object> body, Map<String, Object> input) {
        String aspect = ratioOf(input);
        if (StringUtils.hasText(aspect) && !"auto".equals(aspect)) {
            body.put("aspect_ratio", aspect);
        }
        String quality = strOf(input.get("quality"));
        if (StringUtils.hasText(quality)) {
            body.put("quality", mapQuality(quality));
        }
        String resolution = resolutionOf(input);
        if (StringUtils.hasText(resolution)) {
            body.put("resolution", resolution);
        }
    }

    /** 构建视频多模态 content[]：文本 + 可选首/尾帧/参考图 */
    private List<Map<String, Object>> buildVideoContent(String prompt, Map<String, Object> input) {
        List<Map<String, Object>> content = new ArrayList<>();
        if (StringUtils.hasText(prompt)) {
            Map<String, Object> text = new LinkedHashMap<>();
            text.put("type", "text");
            text.put("text", prompt);
            content.add(text);
        }
        // 首帧：优先 firstFrame，其次 sourceImage（图生视频）
        Object first = input.get("firstFrame");
        if (first == null) {
            first = input.get("sourceImage");
        }
        addImageContent(content, first, "first_frame");
        addImageContent(content, input.get("lastFrame"), "last_frame");
        addImageContent(content, input.get("referenceImage"), "reference_image");
        return content;
    }

    private void addImageContent(List<Map<String, Object>> content, Object url, String role) {
        String s = strOf(url);
        if (!StringUtils.hasText(s)) {
            return;
        }
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("type", "image_url");
        item.put("image_url", Map.of("url", s));
        item.put("role", role);
        content.add(item);
    }

    /** 发送给供应商的模型名：优先传入 modelId，其次该供应商下启用模型，最后兜底 */
    private String resolveModelName(String modelId, AiProviderDO provider, String fallback) {
        if (StringUtils.hasText(modelId) && !"default".equals(modelId)) {
            return modelId;
        }
        AiModelDO model = modelMapper.selectOne(
                new LambdaQueryWrapper<AiModelDO>()
                        .eq(AiModelDO::getProviderId, provider.getId())
                        .eq(AiModelDO::getStatus, 1)
                        .last("LIMIT 1"));
        if (model != null && StringUtils.hasText(model.getModelId())) {
            return model.getModelId();
        }
        return fallback;
    }

    /** 比例：input.aspectRatio，缺省 1:1 */
    private String ratioOf(Map<String, Object> input) {
        Object r = input.get("aspectRatio");
        return r != null ? String.valueOf(r) : "1:1";
    }

    /** 清晰度：input.resolution 优先，其次 input.clarity（如 2K → 2k） */
    private String resolutionOf(Map<String, Object> input) {
        Object r = input.get("resolution");
        if (r == null) {
            r = input.get("clarity");
        }
        return r == null ? null : String.valueOf(r).toLowerCase();
    }

    /** 前端画质 {low, standard, high} → 中转站 {low, medium, high} */
    private String mapQuality(String quality) {
        return switch (quality) {
            case "standard" -> "medium";
            case "low", "medium", "high" -> quality;
            default -> quality;
        };
    }

    // ==================== 工具方法 ====================

    private void putIfText(Map<String, Object> body, String key, String value) {
        if (StringUtils.hasText(value)) {
            body.put(key, value);
        }
    }

    private String strOf(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    private JsonNode tryParse(String body) {
        if (!StringUtils.hasText(body)) {
            return null;
        }
        try {
            return objectMapper.readTree(body);
        } catch (Exception e) {
            return null;
        }
    }

    private void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("任务轮询被中断", e);
        }
    }

    private String baseUrl(AiProviderDO provider) {
        return provider.getBaseUrl().replaceAll("/+$", "");
    }

    private static RestClient buildClient() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(15_000);
        // 读超时放宽到 5 分钟：中转站对部分模型（如 gpt-image-2 2k）可能同步阻塞
        // 返回 200（实测可达 130s+），超时过短会在上游已成功时误判为失败。
        // 异步 202 场景下该 POST 会快速返回，由 pollTask 负责等待，不受此值影响。
        factory.setReadTimeout(300_000);
        return RestClient.builder().requestFactory(factory).build();
    }
}

package com.tidecanvas.service.ai;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tidecanvas.mapper.AiModelMapper;
import com.tidecanvas.mapper.AiProviderMapper;
import com.tidecanvas.model.entity.AiGenerationLogDO;
import com.tidecanvas.model.entity.AiModelDO;
import com.tidecanvas.model.entity.AiProviderDO;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;

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

    // ===== 轮询 / 重试 / 超时参数：默认值如下，可在 application.yml 的 ai.relay.* 覆盖（无需改代码） =====
    /** 轮询间隔（毫秒） */
    @Value("${ai.relay.poll-interval-ms:3000}")
    private long pollIntervalMs;
    /**
     * 轮询最长时间（毫秒）—— 视频任务（如 seedance 15s 720P + face 参考）常需 6~12 分钟，
     * 过短会在上游仍 processing 时误判超时失败。默认 12 分钟，应小于 {@code AiTaskRecoveryRunner}
     * 的 15 分钟兜底，避免轮询期间被恢复器抢先判失败。
     */
    @Value("${ai.relay.poll-timeout-ms:720000}")
    private long pollTimeoutMs;
    /** 502/503 瞬态故障最大重试次数 */
    @Value("${ai.relay.max-retries:2}")
    private int maxRetries;
    /** 重试初始等待（毫秒，指数退避基数：第 n 次等待 retryDelayMs * 2^(n-1)） */
    @Value("${ai.relay.retry-delay-ms:1500}")
    private long retryDelayMs;
    /** 上游连接超时（毫秒） */
    @Value("${ai.relay.connect-timeout-ms:15000}")
    private int connectTimeoutMs;
    /**
     * 上游读超时（毫秒）—— 中转站对部分模型（如 gpt-image-2 2k）可能同步阻塞返回 200（实测可达 130s+），
     * 过短会在上游已成功时误判失败；异步 202 场景下 POST 快速返回、由轮询负责等待，不受此值影响。
     */
    @Value("${ai.relay.read-timeout-ms:300000}")
    private int readTimeoutMs;
    /** edits 接口允许的参考图数量（上游协议固定限制，非调优项，保留为常量） */
    private static final int MAX_EDIT_IMAGE_URLS = 16;

    /** 共享 RestClient（不可变、线程安全；因超时取自 @Value，故在 @PostConstruct 注入完成后构建） */
    private RestClient http;

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

    /**
     * 文生图：POST {baseUrl}/images/generations，返回最终图片 URL 列表（n>1 时一次多张）。
     * 中转站新版协议：携带 operation=generation + mode=t2i 标识，比例字段为 aspect（旧版为 aspect_ratio）。
     */
    public List<String> generate(AiProviderDO provider, String modelId, String prompt, Map<String, Object> input) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", resolveModelName(modelId, provider, "gpt-image-2"));
        body.put("operation", "generation");
        body.put("mode", "t2i");
        body.put("prompt", prompt);
        applyImageParams(body, input);
        applyBatchCount(body, input);
        return submitAndResolveMulti(provider, "/images/generations", body);
    }

    /**
     * 图生图：POST {baseUrl}/images/edits（operation=edits + mode=i2i），
     * 图片以 image_urls 传递，返回最终图片 URL 列表（n>1 时一次多张）。
     */
    public List<String> edit(AiProviderDO provider, String modelId, String prompt, List<String> imageUrls, Map<String, Object> input) throws Exception {
        List<String> normalizedImageUrls = normalizeEditImageUrls(imageUrls);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", resolveModelName(modelId, provider, "gpt-image-2"));
        body.put("operation", "edits");
        body.put("mode", "i2i");
        body.put("prompt", prompt);
        body.put("image_urls", normalizedImageUrls);
        applyEditParams(body, input);
        applyBatchCount(body, input);
        return submitAndResolveMulti(provider, "/images/edits", body);
    }

    /**
     * 视频任务：POST {baseUrl}/contents/generations/tasks，返回最终视频 URL。
     * 新版协议：prompt 提升为顶层字段，operation=generation + mode 区分形态
     * （t2v 文生视频 / i2v 图生视频 / keyframe 首尾帧 / omni_ref 全能参考）；
     * 首尾帧/参考图等媒体输入仍以 content[] 携带（仅媒体项，不再含 text）。
     */
    public String generateVideo(AiProviderDO provider, String modelId, String prompt, Map<String, Object> input, String mode) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", resolveModelName(modelId, provider, "seedance-v2"));
        body.put("operation", "generation");
        putIfText(body, "mode", mode);
        body.put("prompt", prompt);
        List<Map<String, Object>> media = buildVideoContent(input);
        if (!media.isEmpty()) {
            body.put("content", media);
        }
        String ratio = ratioOf(input);
        if (StringUtils.hasText(ratio)) {
            // 文档比例集含 adaptive（自适应）；前端的 auto 归一为 adaptive
            body.put("ratio", "auto".equals(ratio) ? "adaptive" : ratio);
        }
        putIfText(body, "resolution", resolutionOf(input));
        putIfText(body, "duration", durationOf(input));
        putIfText(body, "fps", strOf(input.get("fps")));
        return submitAndResolve(provider, "/contents/generations/tasks", body);
    }

    // ==================== 协议处理 ====================

    /**
     * 提交请求并解析结果（多图）：兼容「200 同步」与「202 异步 + 轮询」两种形态。
     * 遇到 502/503 时自动重试（relay 上游瞬时不可达），最多重试 maxRetries 次。
     */
    private List<String> submitAndResolveMulti(AiProviderDO provider, String path, Map<String, Object> body) throws Exception {
        long start = System.currentTimeMillis();
        String fullUrl = baseUrl(provider) + path;
        Exception lastEx = null;
        String lastRaw = null;

        for (int attempt = 0; attempt <= maxRetries; attempt++) {
            if (attempt > 0) {
                long delay = retryDelayMs * (1L << (attempt - 1));  // 退避：1.5s, 3s, ...
                log.warn("上游 {} 返回瞬态错误，第 {} 次重试（等待 {}ms）", path, attempt, delay);
                sleep(delay);
            }
            // 响应按字节读取再转 UTF-8 文本：部分中转站会把 JSON 响应错标成 application/octet-stream，
            // 用 String 解码会因「无 octet-stream→String 转换器」直接报错；读 byte[] 可绕过 content-type 限制。
            // 同时带上 Accept: application/json，引导上游返回 JSON（而非二进制流）。
            ResponseEntity<byte[]> resp = http.post()
                    .uri(fullUrl)
                    .header("Authorization", "Bearer " + provider.getApiKey())
                    .header("Accept", "application/json")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .onStatus(status -> true, (req, res) -> { })
                    .toEntity(byte[].class);

            int code = resp.getStatusCode().value();
            byte[] bytes = resp.getBody();
            String raw = bytes != null ? new String(bytes, java.nio.charset.StandardCharsets.UTF_8) : null;
            lastRaw = raw;
            JsonNode root = tryParseSse(raw); // 兼容 SSE 格式：先尝试解析 data: {...} 行
            if (root == null) root = tryParse(raw);
            String upstreamTaskId = root != null ? root.path("id").asText(null) : null;
            try {
                // 异步任务(202→轮询)记录「最终完成响应」(带图片资源)，而非初始受理响应(status=processing)
                ResolveResult result = resolveResult(provider, code, raw, root);
                recordLog(operationOf(path, body), fullUrl, body, code, result.finalRaw(), upstreamTaskId, true, first(result.urls()), null, start);
                return result.urls();
            } catch (Exception e) {
                lastEx = e;
                // 502/503 可重试，其他错误直接抛
                if ((code == 502 || code == 503) && attempt < maxRetries) {
                    continue;
                }
                recordLog(operationOf(path, body), fullUrl, body, code, raw, upstreamTaskId, false, null, e.getMessage(), start);
                throw e;
            }
        }
        // 理论上不会到这里（最后一次迭代的 catch 会 throw）
        recordLog(operationOf(path, body), fullUrl, body, 502, lastRaw, null, false, null, lastEx != null ? lastEx.getMessage() : "重试耗尽", start);
        throw lastEx != null ? lastEx : new IllegalStateException("上游 502 重试耗尽");
    }

    /** 单图包装：取结果列表首个（视频 / 单图场景复用） */
    private String submitAndResolve(AiProviderDO provider, String path, Map<String, Object> body) throws Exception {
        return first(submitAndResolveMulti(provider, path, body));
    }

    /** 解析结果：媒体地址 + 产生它的最终响应原文（同步=初始响应；异步=轮询完成响应，含图片资源结构体） */
    private record ResolveResult(List<String> urls, String finalRaw) {
    }

    /** 解析上游响应：同步媒体地址（可多张）/ 失败信封 / 202 异步轮询 */
    private ResolveResult resolveResult(AiProviderDO provider, int code, String raw, JsonNode root) throws Exception {
        if (root == null) {
            // 非 JSON 响应：截取前 200 字符，避免日志刷屏
            String snippet = StringUtils.hasText(raw) ? raw.strip().replace("\n", " | ") : "(empty)";
            if (snippet.length() > 200) snippet = snippet.substring(0, 200) + "...";
            throw new IllegalStateException(snippet);
        }
        List<String> urls = extractUrls(root);
        if (!urls.isEmpty()) {
            return new ResolveResult(urls, raw);
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
        lg.setOperationType("ai_generate");
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
        GenerationLogContext.markRecorded();
    }

    /** 日志操作类型：新版协议优先取 body.mode（t2i/i2i/t2v/i2v/keyframe/omni_ref），无 mode 时按路径归类 */
    private String operationOf(String path, Map<String, Object> body) {
        Object mode = body != null ? body.get("mode") : null;
        if (mode != null && StringUtils.hasText(String.valueOf(mode))) {
            return String.valueOf(mode);
        }
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
     * 返回结果时携带「完成响应原文」(带图片资源的结构体)，供日志记录最终响应而非初始受理响应。
     */
    private ResolveResult pollTask(AiProviderDO provider, String taskId) throws Exception {
        long deadline = System.currentTimeMillis() + pollTimeoutMs;
        String path = "/tasks/" + taskId;
        while (System.currentTimeMillis() < deadline) {
            ResponseEntity<byte[]> resp = http.get()
                    .uri(baseUrl(provider) + path)
                    .header("Authorization", "Bearer " + provider.getApiKey())
                    .header("Accept", "application/json")
                    .retrieve()
                    .onStatus(status -> true, (req, res) -> { })
                    .toEntity(byte[].class);

            int code = resp.getStatusCode().value();
            byte[] bytes = resp.getBody();
            String raw = bytes != null ? new String(bytes, java.nio.charset.StandardCharsets.UTF_8) : null;
            JsonNode root = tryParse(raw);
            if (code == 404) {
                throw new IllegalStateException("上游任务不存在: " + taskId);
            }
            if (code == 403) {
                throw new IllegalStateException("无权访问上游任务: " + taskId);
            }
            if (root != null) {
                String status = root.path("status").asText("");
                if ("succeeded".equalsIgnoreCase(status)) {
                    List<String> urls = extractUrls(root);
                    if (!urls.isEmpty()) {
                        return new ResolveResult(urls, raw);
                    }
                    throw new IllegalStateException("任务成功但未返回结果地址: " + taskId);
                }
                if ("failed".equalsIgnoreCase(status) || isFailed(root)) {
                    throw new IllegalStateException(errorMessage(root, code));
                }
                // queued / processing → 继续轮询
            }
            sleep(pollIntervalMs);
        }
        throw new IllegalStateException("上游任务超时未完成: " + taskId);
    }

    /**
     * 从响应中提取媒体地址列表，兼容多种「带资源」结构体：
     * OpenAI 风格 {@code data[].url / b64_json}；任务完成响应的资源数组
     * {@code urls / image_urls / results / attachments / output.image_urls}；
     * 单图兜底 {@code output_url}。优先取独立多资源(可直接铺组图，免前端切图)，合图兜底。
     */
    private List<String> extractUrls(JsonNode root) {
        List<String> urls = new ArrayList<>();
        // 1) OpenAI 风格 data[]
        JsonNode data = root.path("data");
        if (data.isArray()) {
            for (JsonNode item : data) {
                if (item.hasNonNull("url")) {
                    urls.add(item.get("url").asText());
                } else if (item.hasNonNull("b64_json")) {
                    urls.add("data:image/png;base64," + item.get("b64_json").asText());
                }
            }
        }
        // 2) 任务完成响应常见的资源数组字段（字符串数组 或 对象数组取 url）
        if (urls.isEmpty()) {
            collectUrlArray(root.path("urls"), urls);
            collectUrlArray(root.path("image_urls"), urls);
            collectUrlArray(root.path("results"), urls);
            collectUrlArray(root.path("attachments"), urls);
            collectUrlArray(root.path("output").path("image_urls"), urls);
        }
        // 3) 单图兜底：output_url（如 Midjourney merged 四宫格合图）
        if (urls.isEmpty() && root.hasNonNull("output_url") && StringUtils.hasText(root.get("output_url").asText())) {
            urls.add(root.get("output_url").asText());
        }
        return urls;
    }

    /** 从数组节点收集媒体地址：兼容字符串数组 ["url1","url2"] 与对象数组 [{"url":...}] */
    private void collectUrlArray(JsonNode node, List<String> urls) {
        if (!node.isArray()) {
            return;
        }
        for (JsonNode item : node) {
            if (item.isTextual() && StringUtils.hasText(item.asText())) {
                urls.add(item.asText());
            } else if (item.hasNonNull("url") && StringUtils.hasText(item.get("url").asText())) {
                urls.add(item.get("url").asText());
            }
        }
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
        if (err.isObject()) {
            String msg = err.path("message").asText(null);
            String type = err.path("type").asText(null);
            if (StringUtils.hasText(msg)) {
                return StringUtils.hasText(type) ? type + ": " + msg : msg;
            }
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

    /** 文生图参数：aspect_ratio + quality + resolution */
    /** 文生图参数（新版协议）：aspect + quality + resolution */
    private void applyImageParams(Map<String, Object> body, Map<String, Object> input) {
        applyAspectParam(body, input, "1:1", "aspect");
        applyCommonParams(body, input);
    }

    /** 图生图参数（新版协议）：aspect + quality + resolution */
    private void applyEditParams(Map<String, Object> body, Map<String, Object> input) {
        applyAspectParam(body, input, null, "aspect");
        applyCommonParams(body, input);
    }

    private void applyAspectParam(Map<String, Object> body, Map<String, Object> input, String defaultValue, String fieldName) {
        String aspect = aspectOf(input, defaultValue);
        if (StringUtils.hasText(aspect) && !"auto".equals(aspect)) {
            body.put(fieldName, aspect);
        }
    }

    private void applyCommonParams(Map<String, Object> body, Map<String, Object> input) {
        String quality = strOf(input.get("quality"));
        if (StringUtils.hasText(quality)) {
            body.put("quality", mapQuality(quality));
        }
        String resolution = resolutionOf(input);
        if (StringUtils.hasText(resolution)) {
            body.put("resolution", resolution);
            String model = strOf(body.get("model"));
            if (StringUtils.hasText(model) && model.toLowerCase(Locale.ROOT).contains("seedream")) {
                body.put("quality", resolution.toUpperCase(Locale.ROOT));
            }
        }
    }

    /** 出图张数 n：取 input.batchCount / input.n，clamp 到 [1,4]，仅 >1 时下发（OpenAI images 默认 n=1） */
    private void applyBatchCount(Map<String, Object> body, Map<String, Object> input) {
        Object bc = input.get("batchCount");
        if (bc == null) {
            bc = input.get("n");
        }
        if (bc == null) {
            return;
        }
        int n;
        try {
            n = Integer.parseInt(String.valueOf(bc).trim());
        } catch (NumberFormatException e) {
            return;
        }
        n = Math.max(1, Math.min(4, n));
        if (n > 1) {
            body.put("n", n);
        }
    }

    /** 取列表首个，空则 null */
    private String first(List<String> list) {
        return list == null || list.isEmpty() ? null : list.get(0);
    }

    private List<String> normalizeEditImageUrls(List<String> imageUrls) {
        if (imageUrls == null) {
            throw new IllegalArgumentException("image_urls不能为空");
        }
        List<String> urls = imageUrls.stream()
                .filter(StringUtils::hasText)
                .map(String::strip)
                .distinct()
                .limit(MAX_EDIT_IMAGE_URLS)
                .collect(Collectors.toList());
        if (urls.isEmpty()) {
            throw new IllegalArgumentException("image_urls不能为空");
        }
        return urls;
    }

    /** 构建视频媒体 content[]：可选首/尾帧/参考图/参考视频（新版协议 prompt 在顶层，content 仅媒体项） */
    private List<Map<String, Object>> buildVideoContent(Map<String, Object> input) {
        List<Map<String, Object>> content = new ArrayList<>();
        // 首帧：优先 firstFrame，其次 sourceImage（图生视频）
        Object first = input.get("firstFrame");
        if (first == null) {
            first = input.get("sourceImage");
        }
        addImageContent(content, first, "first_frame");
        addImageContent(content, input.get("lastFrame"), "last_frame");
        addImageContent(content, input.get("referenceImage"), "reference_image");
        // 多张参考图（图片参考 / 全能参考模式）：每张作为一个 reference_image
        Object refs = input.get("references");
        if (refs instanceof List<?> list) {
            for (Object r : list) {
                addImageContent(content, r, "reference_image");
            }
        }
        // 视频参考（全能参考模式）：每个视频作为一个 reference_video
        Object videoRefs = input.get("videoReferences");
        if (videoRefs instanceof List<?> vlist) {
            for (Object v : vlist) {
                addVideoContent(content, v, "reference_video");
            }
        }
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

    private void addVideoContent(List<Map<String, Object>> content, Object url, String role) {
        String s = strOf(url);
        if (!StringUtils.hasText(s)) {
            return;
        }
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("type", "video_url");
        item.put("video_url", Map.of("url", s));
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

    /** 比例：input.aspectRatio / input.aspect_ratio / input.aspect */
    private String ratioOf(Map<String, Object> input) {
        return aspectOf(input, "1:1");
    }

    private String aspectOf(Map<String, Object> input, String defaultValue) {
        Object r = input.get("aspectRatio");
        if (r == null) {
            r = input.get("aspect_ratio");
        }
        if (r == null) {
            r = input.get("aspect");
        }
        return r != null ? String.valueOf(r) : defaultValue;
    }

    /** 清晰度：input.resolution 优先，其次 input.clarity（如 2K → 2k） */
    private String resolutionOf(Map<String, Object> input) {
        Object r = input.get("resolution");
        if (r == null) {
            r = input.get("clarity");
        }
        return r == null ? null : String.valueOf(r).toLowerCase();
    }

    /** 视频时长：归一为「Ns」格式（文档取值 5s/10s/15s）。前端传数字 5 → "5s"，"5.0" → "5s"，已带 s 则原样 */
    private String durationOf(Map<String, Object> input) {
        Object d = input.get("duration");
        if (d == null) {
            return null;
        }
        String s = String.valueOf(d).trim();
        if (s.isEmpty()) {
            return null;
        }
        return s.matches("\\d+(\\.\\d+)?") ? s.replaceAll("\\.0+$", "") + "s" : s;
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

    /**
     * 尽力从各种畸形响应中提取 JSON：SSE data: 行 → MYAPI: 前缀行 → 原始 JSON → 子串中的 JSON 对象。
     * 返回提取到的首个有效 JSON，都没有则返回 null。
     */
    private JsonNode tryParseSse(String body) {
        if (!StringUtils.hasText(body)) return null;
        // 1) 标准 SSE：data: {...} 或 data: [...]
        try {
            for (String line : body.split("\\R")) {
                String t = line.strip();
                if (t.startsWith("data:")) {
                    String json = t.substring(5).strip();
                    if (json.startsWith("{") || json.startsWith("[")) {
                        JsonNode n = objectMapper.readTree(json);
                        if (n != null) return n;
                    }
                }
                // 2) 混合前缀行：MYAPI: 502 BAD_GATEWAY {"error":{...}}
                int brace = t.indexOf('{');
                if (brace > 0) {
                    String maybeJson = t.substring(brace);
                    try {
                        JsonNode n = objectMapper.readTree(maybeJson);
                        if (n != null && n.has("error")) return n;
                    } catch (Exception ignore) { }
                }
            }
        } catch (Exception ignore) { }
        return null;
    }

    private JsonNode tryParse(String body) {
        if (!StringUtils.hasText(body)) return null;
        try {
            return objectMapper.readTree(body);
        } catch (Exception e) {
            // 尝试在字符串任意位置查找 JSON 对象（如 relay 返回 HTML 中内嵌的 JSON）
            int s = body.indexOf('{');
            if (s >= 0) {
                try { return objectMapper.readTree(body.substring(s)); } catch (Exception e2) { }
            }
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

    /** 依赖注入完成后构建共享 RestClient（@Value 超时此时已就绪） */
    @PostConstruct
    private void initHttpClient() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(connectTimeoutMs);
        factory.setReadTimeout(readTimeoutMs);
        http = RestClient.builder().requestFactory(factory).build();
    }
}

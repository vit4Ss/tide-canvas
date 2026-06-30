package com.tidecanvas.service.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tidecanvas.model.entity.AiGenerationLogDO;
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

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Runware 原生 API 客户端（https://runware.ai/docs）。
 * <p>
 * 协议要点：POST {baseUrl}（即 https://api.runware.ai/v1），Bearer 鉴权，请求体为「任务数组」；
 * 模型用 AIR 标识（如 {@code runware:101@1} / {@code bytedance:2@1} / {@code klingai:5@3}）。
 * <ul>
 *   <li>图像 {@code imageInference}：同步返回 {@code imageURL}；文生图给 width/height（按比例映射、64 对齐），
 *       图生图/编辑默认走 {@code referenceImages}（FLUX Kontext / Seedream Edit 等编辑模型），
 *       模型 config 配 {@code {"img2img": true}} 时切换 {@code seedImage + strength} 经典重绘模式。</li>
 *   <li>视频 {@code videoInference}：{@code deliveryMethod=async} 受理后用 {@code getResponse} 按 taskUUID
 *       轮询至 success / error / 超时。</li>
 *   <li>统一附带 {@code includeCost}，上游返回的 USD 成本随响应体留存在生成日志中。</li>
 *   <li>模型 config 的 {@code runware} 对象会原样合并进任务体（steps / CFGScale / providerSettings 等透传逃生门）。</li>
 * </ul>
 *
 * @author tidecanvas
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class RunwareClient {

    private final ObjectMapper objectMapper;
    private final GenerationLogRecorder logRecorder;
    private final com.tidecanvas.mapper.AiModelMapper modelMapper;
    private final com.tidecanvas.mapper.AiTaskMapper taskMapper;

    /** 视频轮询间隔（毫秒） */
    @Value("${ai.runware.poll-interval-ms:3000}")
    private long pollIntervalMs;
    /** 视频轮询最长时间（毫秒）：Veo/Kling 长视频常需数分钟 */
    @Value("${ai.runware.poll-timeout-ms:720000}")
    private long pollTimeoutMs;
    /** 连接超时（毫秒） */
    @Value("${ai.runware.connect-timeout-ms:15000}")
    private int connectTimeoutMs;
    /** 读超时（毫秒）：图像任务为同步阻塞返回 */
    @Value("${ai.runware.read-timeout-ms:300000}")
    private int readTimeoutMs;

    private static final int MAX_REFERENCE_IMAGES = 8;

    /** 文生图比例 → 尺寸（64 对齐，约 1MP 基准档） */
    private static final Map<String, int[]> IMAGE_SIZES = Map.of(
            "1:1", new int[]{1024, 1024},
            "16:9", new int[]{1344, 768},
            "9:16", new int[]{768, 1344},
            "4:3", new int[]{1152, 896},
            "3:4", new int[]{896, 1152},
            "3:2", new int[]{1216, 832},
            "2:3", new int[]{832, 1216},
            "21:9", new int[]{1536, 640},
            "2:1", new int[]{1408, 704}
    );

    /** 视频比例 → 尺寸（主流模型支持的 720p 档） */
    private static final Map<String, int[]> VIDEO_SIZES = Map.of(
            "16:9", new int[]{1280, 720},
            "9:16", new int[]{720, 1280},
            "1:1", new int[]{960, 960},
            "4:3", new int[]{1104, 832},
            "3:4", new int[]{832, 1104},
            "21:9", new int[]{1680, 720}
    );

    private RestClient http;

    @PostConstruct
    private void initHttpClient() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(connectTimeoutMs);
        factory.setReadTimeout(readTimeoutMs);
        http = RestClient.builder().requestFactory(factory).build();
    }

    // ==================== 业务接口（与 AiRelayClient 同签名，供网关分发） ====================

    /** 文生图：imageInference，返回图片 URL 列表（numberResults 一次多张） */
    public List<String> generate(AiProviderDO provider, String modelId, String prompt, Map<String, Object> input) throws Exception {
        Map<String, Object> task = baseImageTask(modelId, prompt, input);
        int[] size = imageSizeOf(input);
        task.put("width", size[0]);
        task.put("height", size[1]);
        mergeModelExtras(task, modelId);
        return submitImage(provider, task);
    }

    /** 图生图/编辑：imageInference + referenceImages（编辑模型）或 seedImage（config.img2img=true 时） */
    public List<String> edit(AiProviderDO provider, String modelId, String prompt, List<String> imageUrls, Map<String, Object> input) throws Exception {
        if (imageUrls == null || imageUrls.isEmpty()) {
            throw new IllegalArgumentException("image_urls不能为空");
        }
        List<String> urls = imageUrls.stream()
                .filter(StringUtils::hasText)
                .map(String::strip)
                .distinct()
                .limit(MAX_REFERENCE_IMAGES)
                .toList();

        Map<String, Object> task = baseImageTask(modelId, prompt, input);
        boolean img2img = modelConfigFlag(modelId, "img2img");
        if (img2img) {
            // 经典重绘：seedImage + strength（SD 系 checkpoint）
            task.put("seedImage", urls.get(0));
            Object strength = input.get("strength");
            task.put("strength", strength instanceof Number n ? n.doubleValue() : 0.8);
            int[] size = imageSizeOf(input);
            task.put("width", size[0]);
            task.put("height", size[1]);
        } else {
            // 编辑模型（FLUX Kontext / Seedream Edit / Qwen-Image-Edit 等）：全部输入作为 referenceImages
            task.put("referenceImages", urls);
        }
        mergeModelExtras(task, modelId);
        return submitImage(provider, task);
    }

    /** 视频任务：videoInference 异步受理 + getResponse 轮询，返回最终视频 URL */
    public String generateVideo(AiProviderDO provider, String modelId, String prompt, Map<String, Object> input) throws Exception {
        Map<String, Object> task = new LinkedHashMap<>();
        String taskUuid = UUID.randomUUID().toString();
        task.put("taskType", "videoInference");
        task.put("taskUUID", taskUuid);
        task.put("model", modelId);
        if (StringUtils.hasText(prompt)) {
            task.put("positivePrompt", prompt);
        }
        task.put("deliveryMethod", "async");
        task.put("includeCost", true);

        Integer duration = durationOf(input);
        if (duration != null) {
            task.put("duration", duration);
        }
        int[] size = videoSizeOf(input);
        task.put("width", size[0]);
        task.put("height", size[1]);

        // ===== 媒体参数：参考模式(全能参考) 与 首尾帧模式 互斥 =====
        // v2 模型（如 Seedance 2.0）要求嵌套在 inputs 对象下（config 配 "videoInputs":true），
        // 且 frameImages 用 {image,frame} 结构；旧模型保持顶层平铺 + {inputImage,frame}。
        boolean wrapInputs = modelConfigFlag(modelId, "videoInputs");
        Map<String, Object> media = new LinkedHashMap<>();

        List<String> refImages = collectUrlList(input.get("references"), MAX_REFERENCE_IMAGES);
        List<String> refVideos = collectUrlList(input.get("videoReferences"), 3);

        if (!refImages.isEmpty() || !refVideos.isEmpty()) {
            // 全能参考模式：图片参考 + 视频参考（与首尾帧互斥，不再下发 frameImages）
            if (!refImages.isEmpty()) {
                media.put("referenceImages", refImages);
            }
            if (!refVideos.isEmpty()) {
                media.put("referenceVideos", refVideos);
            }
        } else {
            // 首尾帧模式
            List<Object> frames = new ArrayList<>();
            Object first = input.get("firstFrame") != null ? input.get("firstFrame") : input.get("sourceImage");
            if (first != null && StringUtils.hasText(first.toString())) {
                frames.add(frameEntry(first.toString(), "first", wrapInputs));
            }
            Object last = input.get("lastFrame");
            if (last != null && StringUtils.hasText(last.toString())) {
                frames.add(frameEntry(last.toString(), "last", wrapInputs));
            }
            if (!frames.isEmpty()) {
                media.put("frameImages", frames);
            }
        }

        if (wrapInputs) {
            if (!media.isEmpty()) {
                task.put("inputs", media);
            }
        } else {
            task.putAll(media);
        }
        mergeModelExtras(task, modelId);

        long start = System.currentTimeMillis();
        String fullUrl = baseUrl(provider);
        ApiResult submitted = post(provider, List.of(task));

        // 提交阶段即被拒（HTTP 4xx 或 errors[]）→ 立即带真实原因失败，
        // 不去轮询一个上游根本没受理的任务（否则会空转到 12 分钟超时，并把真实错误掩盖成「超时」）。
        String submitErr = errorFor(submitted.root(), null);
        if (submitErr == null && submitted.code() >= 400) {
            submitErr = errorMessage(submitted);
        }
        if (submitErr != null) {
            recordLog("runware_video", fullUrl, task, submitted, false, null, submitErr, null, start);
            throw new IllegalStateException(submitErr);
        }

        try {
            JsonNode node = firstDataNode(submitted.root());
            // 同步直接返回（个别短任务）：拿到 videoURL 即完成
            String direct = node != null ? node.path("videoURL").asText(null) : null;
            if (StringUtils.hasText(direct)) {
                recordLog("runware_video", fullUrl, task, submitted, true, direct, null, sumCost(submitted.root()), start);
                return direct;
            }
            MediaResult vr = pollMedia(provider, taskUuid, "videoURL");
            recordLog("runware_video", fullUrl, task, submitted, true, vr.url(), null, vr.cost(), start);
            return vr.url();
        } catch (Exception e) {
            recordLog("runware_video", fullUrl, task, submitted, false, null, e.getMessage(), null, start);
            throw e;
        }
    }

    /**
     * 语音合成：audioInference（{@code speech.text} + {@code speech.voice}），同步返回音频 URL。
     * 音色为各模型自有的字符串 ID（如 MiniMax 的 Chinese (Mandarin)_Lovely_Girl），由前端按模型 config.voices 下发。
     */
    public String generateAudio(AiProviderDO provider, String modelId, String text, Map<String, Object> input) throws Exception {
        Map<String, Object> task = new LinkedHashMap<>();
        String taskUuid = UUID.randomUUID().toString();
        task.put("taskType", "audioInference");
        task.put("taskUUID", taskUuid);
        task.put("model", modelId);
        Map<String, Object> speech = new LinkedHashMap<>();
        speech.put("text", text);
        Object voice = input.get("voice");
        if (voice != null && StringUtils.hasText(voice.toString())) {
            speech.put("voice", voice.toString());
        }
        task.put("speech", speech);
        task.put("outputType", "URL");
        task.put("outputFormat", "MP3");
        task.put("deliveryMethod", "sync");
        task.put("includeCost", true);
        mergeModelExtras(task, modelId);

        long start = System.currentTimeMillis();
        String fullUrl = baseUrl(provider);
        ApiResult result = post(provider, List.of(task));
        try {
            String err = errorFor(result.root(), null);
            if (err == null && result.code() >= 400) {
                err = errorMessage(result);
            }
            if (err != null) {
                throw new IllegalStateException(err);
            }
            JsonNode node = firstDataNode(result.root());
            String url = node != null ? node.path("audioURL").asText(null) : null;
            if (!StringUtils.hasText(url)) {
                // 个别模型按异步受理：轮询取回
                MediaResult mr = pollMedia(provider, taskUuid, "audioURL");
                recordLog("runware_audio", fullUrl, task, result, true, mr.url(), null, mr.cost(), start);
                return mr.url();
            }
            recordLog("runware_audio", fullUrl, task, result, true, url, null, sumCost(result.root()), start);
            return url;
        } catch (Exception e) {
            recordLog("runware_audio", fullUrl, task, result, false, null, e.getMessage(), null, start);
            throw e;
        }
    }

    // ==================== 协议处理 ====================

    private Map<String, Object> baseImageTask(String modelId, String prompt, Map<String, Object> input) {
        Map<String, Object> task = new LinkedHashMap<>();
        task.put("taskType", "imageInference");
        task.put("taskUUID", UUID.randomUUID().toString());
        task.put("model", modelId);
        task.put("positivePrompt", prompt == null ? "" : prompt);
        task.put("numberResults", batchCountOf(input));
        task.put("outputType", "URL");
        task.put("outputFormat", "PNG");
        task.put("includeCost", true);
        return task;
    }

    private List<String> submitImage(AiProviderDO provider, Map<String, Object> task) throws Exception {
        long start = System.currentTimeMillis();
        String fullUrl = baseUrl(provider);
        ApiResult result = post(provider, List.of(task));
        try {
            List<String> urls = new ArrayList<>();
            JsonNode data = result.root() != null ? result.root().path("data") : null;
            if (data != null && data.isArray()) {
                for (JsonNode item : data) {
                    String u = item.path("imageURL").asText(null);
                    if (StringUtils.hasText(u)) {
                        urls.add(u);
                    }
                }
            }
            if (urls.isEmpty()) {
                throw new IllegalStateException(errorMessage(result));
            }
            recordLog("runware_image", fullUrl, task, result, true, urls.get(0), null, sumCost(result.root()), start);
            return urls;
        } catch (Exception e) {
            recordLog("runware_image", fullUrl, task, result, false, null, e.getMessage(), null, start);
            throw e;
        }
    }

    /** 异步媒体轮询结果：最终地址 + 该次生成的上游成本(USD) */
    private record MediaResult(String url, java.math.BigDecimal cost) { }

    /** 轮询 getResponse 直到 success / error / 超时；urlField 为结果地址字段名（videoURL / audioURL） */
    private MediaResult pollMedia(AiProviderDO provider, String taskUuid, String urlField) throws Exception {
        long deadline = System.currentTimeMillis() + pollTimeoutMs;
        Map<String, Object> poll = Map.of("taskType", "getResponse", "taskUUID", taskUuid);
        while (System.currentTimeMillis() < deadline) {
            sleep(pollIntervalMs);
            ApiResult result = post(provider, List.of(poll));
            JsonNode root = result.root();
            if (root == null) {
                continue;
            }
            // 失败：errors 数组中匹配本任务，或 data 项 status=error
            String err = errorFor(root, taskUuid);
            if (err != null) {
                throw new IllegalStateException(err);
            }
            JsonNode data = root.path("data");
            if (data.isArray()) {
                for (JsonNode item : data) {
                    if (!taskUuid.equals(item.path("taskUUID").asText(null))) {
                        continue;
                    }
                    String status = item.path("status").asText("");
                    String url = item.path(urlField).asText(null);
                    if (StringUtils.hasText(url)) {
                        JsonNode c = item.path("cost");
                        return new MediaResult(url, c.isNumber() ? c.decimalValue() : null);
                    }
                    if ("error".equalsIgnoreCase(status)) {
                        throw new IllegalStateException("上游任务失败: " + item.path("error").path("message").asText("unknown"));
                    }
                    // queued / processing → 回写实时进度让前端「生成情况」可见，然后继续轮询
                    JsonNode prog = item.path("progress");
                    if (prog.isNumber()) {
                        updateTaskProgress(Math.min(99, Math.max(1, prog.asInt())));
                    }
                }
            }
        }
        throw new IllegalStateException("上游任务超时未完成: " + taskUuid);
    }

    /** 模型搜索（管理后台「模型选择」用）：返回 AIR 标识列表 */
    public List<Map<String, String>> searchModels(AiProviderDO provider, String search) throws Exception {
        Map<String, Object> task = new LinkedHashMap<>();
        task.put("taskType", "modelSearch");
        task.put("taskUUID", UUID.randomUUID().toString());
        if (StringUtils.hasText(search)) {
            task.put("search", search);
        }
        task.put("limit", 50);
        ApiResult result = post(provider, List.of(task));
        JsonNode data = firstDataNode(result.root());
        List<Map<String, String>> models = new ArrayList<>();
        if (data != null && data.path("results").isArray()) {
            for (JsonNode m : data.path("results")) {
                String air = m.path("air").asText(null);
                if (StringUtils.hasText(air)) {
                    models.add(Map.of("air", air, "name", m.path("name").asText("")));
                }
            }
        }
        if (models.isEmpty() && result.code() >= 400) {
            throw new IllegalStateException(errorMessage(result));
        }
        return models;
    }

    private record ApiResult(int code, String raw, JsonNode root) { }

    private ApiResult post(AiProviderDO provider, List<Map<String, Object>> tasks) {
        ResponseEntity<byte[]> resp = http.post()
                .uri(baseUrl(provider))
                .header("Authorization", "Bearer " + provider.getApiKey())
                .header("Accept", "application/json")
                .contentType(MediaType.APPLICATION_JSON)
                .body(tasks)
                .retrieve()
                .onStatus(status -> true, (req, res) -> { })
                .toEntity(byte[].class);
        byte[] bytes = resp.getBody();
        String raw = bytes != null ? new String(bytes, StandardCharsets.UTF_8) : null;
        JsonNode root = null;
        try {
            root = StringUtils.hasText(raw) ? objectMapper.readTree(raw) : null;
        } catch (Exception ignore) {
            // 非 JSON 响应按解析失败处理，errorMessage 兜底
        }
        return new ApiResult(resp.getStatusCode().value(), raw, root);
    }

    private JsonNode firstDataNode(JsonNode root) {
        if (root == null) {
            return null;
        }
        JsonNode data = root.path("data");
        return data.isArray() && !data.isEmpty() ? data.get(0) : null;
    }

    /** 解析 errors[] 中与指定任务相关（或任意一条）的错误信息 */
    private String errorFor(JsonNode root, String taskUuid) {
        if (root == null) {
            return null;
        }
        JsonNode errors = root.path("errors");
        if (!errors.isArray() || errors.isEmpty()) {
            return null;
        }
        for (JsonNode e : errors) {
            String uuid = e.path("taskUUID").asText(null);
            if (taskUuid == null || uuid == null || taskUuid.equals(uuid)) {
                String code = e.path("code").asText("");
                String msg = e.path("message").asText("上游返回错误");
                return StringUtils.hasText(code) ? code + ": " + msg : msg;
            }
        }
        return null;
    }

    private String errorMessage(ApiResult result) {
        if (result.root() != null) {
            String err = errorFor(result.root(), null);
            if (err != null) {
                return err;
            }
        }
        String snippet = StringUtils.hasText(result.raw()) ? result.raw().strip().replace("\n", " | ") : "(empty)";
        if (snippet.length() > 200) {
            snippet = snippet.substring(0, 200) + "...";
        }
        return "Runware 返回无法解析: HTTP " + result.code() + " " + snippet;
    }

    // ==================== 参数构建 ====================

    private int[] imageSizeOf(Map<String, Object> input) {
        String aspect = aspectOf(input, "1:1");
        int[] base = IMAGE_SIZES.getOrDefault(aspect, IMAGE_SIZES.get("1:1"));
        // 清晰度档位：2k×1.5 / 4k×2，64 对齐并夹在 [256, 2048]
        double mul = switch (resolutionOf(input)) {
            case "2k" -> 1.5;
            case "4k" -> 2.0;
            default -> 1.0;
        };
        return new int[]{snap64(base[0] * mul), snap64(base[1] * mul)};
    }

    private int[] videoSizeOf(Map<String, Object> input) {
        String aspect = aspectOf(input, "16:9");
        return VIDEO_SIZES.getOrDefault(aspect, VIDEO_SIZES.get("16:9"));
    }

    private int snap64(double v) {
        int snapped = (int) (Math.round(v / 64.0) * 64);
        return Math.max(256, Math.min(2048, snapped));
    }

    private String aspectOf(Map<String, Object> input, String defaultValue) {
        Object r = input.get("aspectRatio");
        if (r == null) {
            r = input.get("aspect_ratio");
        }
        if (r == null) {
            r = input.get("aspect");
        }
        String s = r == null ? null : String.valueOf(r);
        return StringUtils.hasText(s) && !"auto".equals(s) ? s : defaultValue;
    }

    private String resolutionOf(Map<String, Object> input) {
        Object r = input.get("resolution");
        if (r == null) {
            r = input.get("clarity");
        }
        return r == null ? "" : String.valueOf(r).toLowerCase();
    }

    /** 时长：归一为整数秒（"5s" / 5 / "5.0" → 5） */
    private Integer durationOf(Map<String, Object> input) {
        Object d = input.get("duration");
        if (d == null) {
            return null;
        }
        String s = String.valueOf(d).trim().replaceAll("[sS]$", "");
        try {
            return (int) Math.round(Double.parseDouble(s));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** 从 input 的某个 List 字段收集去重的 URL 列表（限量），非列表或空则返回空列表 */
    private List<String> collectUrlList(Object value, int max) {
        List<String> out = new ArrayList<>();
        if (value instanceof List<?> list) {
            for (Object r : list) {
                String u = r == null ? null : r.toString().strip();
                if (StringUtils.hasText(u) && !out.contains(u) && out.size() < max) {
                    out.add(u);
                }
            }
        }
        return out;
    }

    /** 单个首尾帧条目：v2(inputs) 用 {image,frame}，旧模型用 {inputImage,frame} */
    private Map<String, Object> frameEntry(String url, String frame, boolean wrapInputs) {
        return wrapInputs
                ? Map.of("image", url, "frame", frame)
                : Map.of("inputImage", url, "frame", frame);
    }

    private int batchCountOf(Map<String, Object> input) {
        Object bc = input.get("batchCount");
        if (bc == null) {
            bc = input.get("n");
        }
        if (bc == null) {
            return 1;
        }
        try {
            return Math.max(1, Math.min(4, Integer.parseInt(String.valueOf(bc).trim())));
        } catch (NumberFormatException e) {
            return 1;
        }
    }

    /** 模型 config.img2img 布尔开关 */
    private boolean modelConfigFlag(String modelId, String key) {
        JsonNode cfg = modelConfig(modelId);
        return cfg != null && cfg.path(key).asBoolean(false);
    }

    /** 模型 config.runware 对象 → 原样合并进任务体（steps/CFGScale/providerSettings 等透传） */
    private void mergeModelExtras(Map<String, Object> task, String modelId) {
        JsonNode cfg = modelConfig(modelId);
        if (cfg == null) {
            return;
        }
        JsonNode extras = cfg.path("runware");
        if (!extras.isObject()) {
            return;
        }
        Iterator<Map.Entry<String, JsonNode>> it = extras.fields();
        while (it.hasNext()) {
            Map.Entry<String, JsonNode> e = it.next();
            task.put(e.getKey(), objectMapper.convertValue(e.getValue(), Object.class));
        }
    }

    private JsonNode modelConfig(String modelId) {
        if (!StringUtils.hasText(modelId) || "default".equals(modelId)) {
            return null;
        }
        try {
            com.tidecanvas.model.entity.AiModelDO model = modelMapper.selectOne(
                    new com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<com.tidecanvas.model.entity.AiModelDO>()
                            .eq(com.tidecanvas.model.entity.AiModelDO::getModelId, modelId));
            if (model == null || !StringUtils.hasText(model.getConfig())) {
                return null;
            }
            return objectMapper.readTree(model.getConfig());
        } catch (Exception e) {
            return null;
        }
    }

    /** 轮询期间回写任务实时进度（taskId 取自 ThreadLocal 上下文；仅处理中状态生效，失败静默不影响生成） */
    private void updateTaskProgress(int progress) {
        try {
            GenerationLogContext.Ctx ctx = GenerationLogContext.get();
            if (ctx != null && ctx.taskId() != null) {
                taskMapper.updateProgress(ctx.taskId(), progress,
                        com.tidecanvas.enums.AiTaskStatusEnum.PROCESSING.getCode());
            }
        } catch (Exception ignore) {
            // 进度回写为辅助信息，失败不影响主流程
        }
    }

    /** 汇总上游成本：response data[].cost 求和（numberResults>1 时多张分别计费）；无 cost 字段返回 null */
    private java.math.BigDecimal sumCost(JsonNode root) {
        if (root == null) {
            return null;
        }
        JsonNode data = root.path("data");
        if (!data.isArray()) {
            return null;
        }
        java.math.BigDecimal sum = null;
        for (JsonNode item : data) {
            JsonNode c = item.path("cost");
            if (c.isNumber()) {
                sum = (sum == null ? java.math.BigDecimal.ZERO : sum).add(c.decimalValue());
            }
        }
        return sum;
    }

    private void recordLog(String operation, String url, Map<String, Object> body, ApiResult result,
                           boolean success, String resultUrl, String error, java.math.BigDecimal cost, long start) {
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
        lg.setHttpStatus(result != null ? result.code() : null);
        // 响应体随日志留存（含上游返回的 USD cost 字段，后台可据此核对成本）
        lg.setResponseBody(result != null ? result.raw() : null);
        lg.setUpstreamTaskId(body != null ? String.valueOf(body.get("taskUUID")) : null);
        lg.setSuccess(success ? 1 : 0);
        lg.setResultUrl(resultUrl);
        lg.setErrorMsg(error);
        lg.setCost(cost);
        lg.setDurationMs(System.currentTimeMillis() - start);
        logRecorder.save(lg);
        GenerationLogContext.markRecorded();
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
}

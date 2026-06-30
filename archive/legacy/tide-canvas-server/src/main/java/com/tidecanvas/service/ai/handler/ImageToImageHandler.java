package com.tidecanvas.service.ai.handler;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.tidecanvas.model.entity.AiProviderDO;
import com.tidecanvas.service.ai.AiHandler;
import com.tidecanvas.service.ai.AiHandlerResult;
import com.tidecanvas.service.ai.AiMediaGateway;
import com.tidecanvas.service.ai.util.PromptRefUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 图生图 Handler —— 调用中转站图像编辑接口（/images/edits，JSON image_urls）。
 * 根据文字指令对输入图片进行编辑；未配置可用供应商时回退为占位图（演示模式）。
 *
 * @author tidecanvas
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ImageToImageHandler implements AiHandler {

    private final AiMediaGateway imageClient;
    private final ObjectMapper objectMapper;

    // 内联 1x1 透明 PNG，避免浏览器因外部假 URL 报 "Unsafe asset URL"
    private static final String PLACEHOLDER =
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    private static final int MAX_EDIT_IMAGE_URLS = 16;

    @Override
    public String getHandlerName() {
        return "image_to_image";
    }

    @Override
    public void validate(Map<String, Object> input) {
        if (!input.containsKey("prompt") || input.get("prompt").toString().isBlank()) {
            throw new IllegalArgumentException("prompt不能为空");
        }
        if (!input.containsKey("sourceImage") || input.get("sourceImage").toString().isBlank()) {
            throw new IllegalArgumentException("sourceImage不能为空");
        }
    }

    @Override
    @SuppressWarnings("unchecked")
    public AiHandlerResult execute(String modelId, Map<String, Object> input) {
        String prompt = input.get("prompt") != null ? String.valueOf(input.get("prompt")) : "";
        Object src = input.get("sourceImage");
        if (src == null || src.toString().isBlank()) {
            return AiHandlerResult.fail("缺少源图片，请先上传图片或从上游节点连接");
        }
        String sourceImage = src.toString();

        // 优先使用前端传入的 imageList 原顺序，与 LibTV 调用保持一致：
        // Image 1 = 第一张输入图（通常是分镜/占位参考），Image 2/3... = 角色或额外参考图。
        List<String> allUrls = collectImageList(input.get("imageList"));
        if (allUrls.isEmpty()) {
            allUrls.add(sourceImage);
            collectImageList(input.get("references")).forEach((url) -> {
                if (allUrls.size() < MAX_EDIT_IMAGE_URLS && !allUrls.contains(url)) {
                    allUrls.add(url);
                }
            });
        }
        // 多图时标注每张图的角色（对齐 LiblibAI / 主流工具规范）：
        //  · 若用户已在 prompt 中用「图片N」内联绑定角色（如「让图片1变成男主」），尊重其编号、
        //    不再叠加任何前缀，仅做编号归一化，避免模型 grounding 偏差导致张冠李戴；
        //  · 否则按旧规则补「{{Image N}} 是主图/参考图」的整体说明。
        if (allUrls.size() > 1) {
            if (PromptRefUtils.containsInlineImageRef(prompt)) {
                prompt = PromptRefUtils.normalizeInlineImageRefs(prompt);
            } else {
                StringBuilder sb = new StringBuilder();
                sb.append("{{Image 1}} is the primary storyboard/composition reference");
                for (int i = 1; i < allUrls.size(); i++) {
                    sb.append("; {{Image ").append(i + 1).append("}} is reference image ").append(i + 1);
                }
                sb.append(". ").append(prompt);
                prompt = sb.toString();
            }
        }

        AiProviderDO provider = imageClient.resolveProvider(modelId);
        if (!imageClient.isUsable(provider)) {
            log.warn("未配置可用的 AI 供应商（baseUrl/apiKey），返回占位图");
            return AiHandlerResult.ok(PLACEHOLDER);
        }
        try {
            return buildResult(imageClient.edit(provider, modelId, prompt, allUrls, input), input);
        } catch (Exception e) {
            log.error("图生图调用失败: {}", e.getMessage(), e);
            return AiHandlerResult.fail("图像编辑失败: " + e.getMessage());
        }
    }

    private List<String> collectImageList(Object value) {
        if (!(value instanceof List<?> list) || list.isEmpty()) {
            return List.of();
        }
        List<String> urls = new ArrayList<>();
        for (Object item : list) {
            if (urls.size() >= MAX_EDIT_IMAGE_URLS) {
                break;
            }
            String url = item == null ? null : item.toString().strip();
            if (StringUtils.hasText(url) && !urls.contains(url)) {
                urls.add(url);
            }
        }
        return urls;
    }

    /** 把图片 URL 列表封装为结果：首张作主结果 URL，多张时把全部写入 resultMeta.urls 供前端铺多个节点 */
    private AiHandlerResult buildResult(List<String> urls, Map<String, Object> input) {
        if (urls == null || urls.isEmpty()) {
            return AiHandlerResult.fail("未返回任何图片");
        }
        AiHandlerResult r = AiHandlerResult.ok(urls.get(0));
        try {
            r.setResultMeta(objectMapper.writeValueAsString(Map.of("urls", urls, "input", input)));
        } catch (Exception ignore) {
            // meta 失败不影响主结果
        }
        return r;
    }

    @Override
    public boolean isAsync() {
        return true;
    }
}

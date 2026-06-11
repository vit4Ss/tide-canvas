package com.tidecanvas.service.ai.handler;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.tidecanvas.model.entity.AiProviderDO;
import com.tidecanvas.service.ai.AiHandler;
import com.tidecanvas.service.ai.AiHandlerResult;
import com.tidecanvas.service.ai.AiMediaGateway;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/**
 * 文生图 Handler —— 调用 OpenAI 兼容的图像生成接口（/images/generations）。
 * 未配置可用供应商时回退为占位图（演示模式）。
 *
 * @author tidecanvas
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class TextToImageHandler implements AiHandler {

    private final AiMediaGateway imageClient;
    private final ObjectMapper objectMapper;

    // 内联 1x1 透明 PNG，避免浏览器因外部假 URL 报 "Unsafe asset URL"
    private static final String PLACEHOLDER =
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    @Override
    public String getHandlerName() {
        return "text_to_image";
    }

    @Override
    public void validate(Map<String, Object> input) {
        if (!input.containsKey("prompt") || input.get("prompt").toString().isBlank()) {
            throw new IllegalArgumentException("prompt不能为空");
        }
    }

    @Override
    public AiHandlerResult execute(String modelId, Map<String, Object> input) {
        String prompt = String.valueOf(input.get("prompt"));
        AiProviderDO provider = imageClient.resolveProvider(modelId);
        if (!imageClient.isUsable(provider)) {
            log.warn("未配置可用的 AI 供应商（baseUrl/apiKey），返回占位图");
            return AiHandlerResult.ok(PLACEHOLDER);
        }
        try {
            return buildResult(imageClient.generate(provider, modelId, prompt, input), input);
        } catch (Exception e) {
            log.error("文生图调用失败: {}", e.getMessage(), e);
            return AiHandlerResult.fail("图像生成失败: " + e.getMessage());
        }
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

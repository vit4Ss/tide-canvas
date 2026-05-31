package com.tidecanvas.service.ai.handler;

import com.tidecanvas.model.entity.AiProviderDO;
import com.tidecanvas.service.ai.AiHandler;
import com.tidecanvas.service.ai.AiHandlerResult;
import com.tidecanvas.service.ai.AiRelayClient;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

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

    private final AiRelayClient imageClient;

    private static final String PLACEHOLDER = "https://placeholder.com/generated-image.png";

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
            return AiHandlerResult.ok(imageClient.generate(provider, modelId, prompt, input));
        } catch (Exception e) {
            log.error("文生图调用失败: {}", e.getMessage(), e);
            return AiHandlerResult.fail("图像生成失败: " + e.getMessage());
        }
    }

    @Override
    public boolean isAsync() {
        return true;
    }
}

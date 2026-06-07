package com.tidecanvas.service.ai.handler;

import com.tidecanvas.model.entity.AiProviderDO;
import com.tidecanvas.service.ai.AiHandler;
import com.tidecanvas.service.ai.AiHandlerResult;
import com.tidecanvas.service.ai.AiRelayClient;
import com.tidecanvas.service.ai.util.PromptRefUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * 图生视频 Handler —— 以输入图片作为首帧（first_frame）调用中转站视频任务接口。
 * 未配置可用供应商时回退为占位视频（演示模式）。
 *
 * @author tidecanvas
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ImageToVideoHandler implements AiHandler {

    private final AiRelayClient relayClient;

    // 内联 1x1 透明 PNG（演示模式），避免浏览器因外部假 URL 报 "Unsafe asset URL"
    private static final String PLACEHOLDER =
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    @Override
    public String getHandlerName() {
        return "image_to_video";
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
    public AiHandlerResult execute(String modelId, Map<String, Object> input) {
        String prompt = PromptRefUtils.normalizeInlineImageRefs(String.valueOf(input.get("prompt")));
        AiProviderDO provider = relayClient.resolveProvider(modelId);
        if (!relayClient.isUsable(provider)) {
            log.warn("未配置可用的 AI 供应商（baseUrl/apiKey），返回占位视频");
            return AiHandlerResult.ok(PLACEHOLDER);
        }
        try {
            return AiHandlerResult.ok(relayClient.generateVideo(provider, modelId, prompt, input));
        } catch (Exception e) {
            log.error("图生视频调用失败: {}", e.getMessage(), e);
            return AiHandlerResult.fail("视频生成失败: " + e.getMessage());
        }
    }

    @Override
    public boolean isAsync() {
        return true;
    }
}

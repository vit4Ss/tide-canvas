package com.tidecanvas.service.ai.handler;

import com.tidecanvas.model.entity.AiProviderDO;
import com.tidecanvas.service.ai.AiHandler;
import com.tidecanvas.service.ai.AiHandlerResult;
import com.tidecanvas.service.ai.AiRelayClient;
import com.tidecanvas.service.ai.util.PromptRefUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/**
 * 参考生视频 Handler —— 图片 / 视频 / 文字多模态参考综合生成视频（无固定首帧）。
 * 图片作 reference_image、视频作 reference_video、文字作 prompt 一并喂给中转站视频接口。
 * 用于「图片参考」「全能参考」模式。
 *
 * @author tidecanvas
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ReferenceToVideoHandler implements AiHandler {

    private final AiRelayClient relayClient;

    // 内联 1x1 透明 PNG（演示模式），避免浏览器因外部假 URL 报 "Unsafe asset URL"
    private static final String PLACEHOLDER =
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    @Override
    public String getHandlerName() {
        return "reference_to_video";
    }

    @Override
    public void validate(Map<String, Object> input) {
        if (!input.containsKey("prompt") || input.get("prompt").toString().isBlank()) {
            throw new IllegalArgumentException("prompt不能为空");
        }
        boolean hasImageRef = input.get("references") instanceof List<?> li && !li.isEmpty();
        boolean hasVideoRef = input.get("videoReferences") instanceof List<?> lv && !lv.isEmpty();
        if (!hasImageRef && !hasVideoRef) {
            throw new IllegalArgumentException("至少需要连接一个参考图片/视频");
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
            log.error("参考生视频调用失败: {}", e.getMessage(), e);
            return AiHandlerResult.fail("视频生成失败: " + e.getMessage());
        }
    }

    @Override
    public boolean isAsync() {
        return true;
    }
}

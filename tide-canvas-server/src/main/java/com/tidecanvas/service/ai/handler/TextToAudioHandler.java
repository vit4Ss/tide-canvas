package com.tidecanvas.service.ai.handler;

import com.tidecanvas.model.entity.AiProviderDO;
import com.tidecanvas.service.ai.AiHandler;
import com.tidecanvas.service.ai.AiHandlerResult;
import com.tidecanvas.service.ai.AiMediaGateway;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * 文本转语音 Handler —— 调用 Runware audioInference 合成语音。
 * 音色（voice）为各供应商各模型自有的字符串 ID，由前端按模型 config.voices 选择后随 input 下发。
 *
 * @author tidecanvas
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class TextToAudioHandler implements AiHandler {

    private final AiMediaGateway relayClient;

    /** TTS 文本上限（与 Runware MiniMax 等模型一致） */
    private static final int MAX_TEXT_LENGTH = 50_000;

    @Override
    public String getHandlerName() {
        return "text_to_audio";
    }

    @Override
    public void validate(Map<String, Object> input) {
        Object prompt = input.get("prompt");
        if (prompt == null || prompt.toString().isBlank()) {
            throw new IllegalArgumentException("prompt不能为空");
        }
        if (prompt.toString().length() > MAX_TEXT_LENGTH) {
            throw new IllegalArgumentException("合成文本超长，最多 " + MAX_TEXT_LENGTH + " 字符");
        }
    }

    @Override
    public AiHandlerResult execute(String modelId, Map<String, Object> input) {
        String text = String.valueOf(input.get("prompt"));
        AiProviderDO provider = relayClient.resolveProvider(modelId);
        if (!relayClient.isUsable(provider)) {
            return AiHandlerResult.fail("未配置可用的 AI 供应商（baseUrl/apiKey）");
        }
        try {
            return AiHandlerResult.ok(relayClient.generateAudio(provider, modelId, text, input));
        } catch (Exception e) {
            log.error("语音合成调用失败: {}", e.getMessage(), e);
            return AiHandlerResult.fail("语音合成失败: " + e.getMessage());
        }
    }

    @Override
    public boolean isAsync() {
        return true;
    }
}

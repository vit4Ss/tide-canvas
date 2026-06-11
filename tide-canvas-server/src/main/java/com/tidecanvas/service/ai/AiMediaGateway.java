package com.tidecanvas.service.ai;

import com.tidecanvas.model.entity.AiProviderDO;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/**
 * AI 媒体生成网关：按供应商 {@code providerType} 把请求分发到对应协议客户端。
 * <ul>
 *   <li>{@code runware} → {@link RunwareClient}（Runware 原生任务数组协议）</li>
 *   <li>其余（openai/custom/...）→ {@link AiRelayClient}（中转站统一协议）</li>
 * </ul>
 * 与 {@link AiRelayClient} 暴露同一组方法签名，Handler 只面向网关、不感知协议差异。
 *
 * @author tidecanvas
 */
@Component
@RequiredArgsConstructor
public class AiMediaGateway {

    public static final String PROVIDER_TYPE_RUNWARE = "runware";

    private final AiRelayClient relayClient;
    private final RunwareClient runwareClient;

    /** 解析供应商：优先按 model 关联，找不到则取优先级最高的启用供应商 */
    public AiProviderDO resolveProvider(String modelId) {
        return relayClient.resolveProvider(modelId);
    }

    /** 供应商是否可用（已配置 baseUrl + apiKey） */
    public boolean isUsable(AiProviderDO provider) {
        return relayClient.isUsable(provider);
    }

    public static boolean isRunware(AiProviderDO provider) {
        return provider != null && PROVIDER_TYPE_RUNWARE.equalsIgnoreCase(provider.getProviderType());
    }

    /** 文生图：返回图片 URL 列表（n>1 时一次多张） */
    public List<String> generate(AiProviderDO provider, String modelId, String prompt, Map<String, Object> input) throws Exception {
        return isRunware(provider)
                ? runwareClient.generate(provider, modelId, prompt, input)
                : relayClient.generate(provider, modelId, prompt, input);
    }

    /** 图生图/编辑：返回图片 URL 列表 */
    public List<String> edit(AiProviderDO provider, String modelId, String prompt, List<String> imageUrls, Map<String, Object> input) throws Exception {
        return isRunware(provider)
                ? runwareClient.edit(provider, modelId, prompt, imageUrls, input)
                : relayClient.edit(provider, modelId, prompt, imageUrls, input);
    }

    /** 视频任务：返回最终视频 URL */
    public String generateVideo(AiProviderDO provider, String modelId, String prompt, Map<String, Object> input) throws Exception {
        return isRunware(provider)
                ? runwareClient.generateVideo(provider, modelId, prompt, input)
                : relayClient.generateVideo(provider, modelId, prompt, input);
    }

    /** 语音合成：返回音频 URL（目前仅 Runware 协议支持） */
    public String generateAudio(AiProviderDO provider, String modelId, String text, Map<String, Object> input) throws Exception {
        if (!isRunware(provider)) {
            throw new IllegalStateException("当前供应商不支持语音合成，请在模型管理中将语音模型关联 Runware 供应商");
        }
        return runwareClient.generateAudio(provider, modelId, text, input);
    }
}

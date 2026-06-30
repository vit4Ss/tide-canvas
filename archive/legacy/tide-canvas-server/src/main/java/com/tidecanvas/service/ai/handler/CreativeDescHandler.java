package com.tidecanvas.service.ai.handler;

import com.tidecanvas.service.ai.AiHandler;
import com.tidecanvas.service.ai.AiHandlerResult;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Map;

@Slf4j
@Component
public class CreativeDescHandler implements AiHandler {

    @Override
    public String getHandlerName() {
        return "creative_desc";
    }

    @Override
    public void validate(Map<String, Object> input) {
        if (!input.containsKey("prompt") || input.get("prompt").toString().isBlank()) {
            throw new IllegalArgumentException("prompt不能为空");
        }
    }

    @Override
    public AiHandlerResult execute(String modelId, Map<String, Object> input) {
        log.info("CreativeDesc handler executing: model={}, prompt={}", modelId, input.get("prompt"));
        AiHandlerResult result = AiHandlerResult.ok(null);
        result.setResultMeta("{\"enhancedPrompt\": \"AI enhanced version of: " + input.get("prompt") + "\"}");
        return result;
    }

    @Override
    public boolean isAsync() {
        return false;
    }
}

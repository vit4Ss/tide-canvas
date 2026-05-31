package com.tidecanvas.service.ai;

import java.util.Map;

public interface AiHandler {

    String getHandlerName();

    void validate(Map<String, Object> input);

    AiHandlerResult execute(String modelId, Map<String, Object> input);

    boolean isAsync();
}

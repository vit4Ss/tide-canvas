package com.tidecanvas.service.ai;

import com.tidecanvas.common.ResultCode;
import com.tidecanvas.exception.BusinessException;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Component
public class AiHandlerRegistry {

    private final Map<String, AiHandler> handlerMap = new HashMap<>();

    public AiHandlerRegistry(List<AiHandler> handlers) {
        for (AiHandler handler : handlers) {
            handlerMap.put(handler.getHandlerName(), handler);
        }
    }

    public AiHandler getHandler(String name) {
        AiHandler handler = handlerMap.get(name);
        if (handler == null) {
            throw new BusinessException(ResultCode.HANDLER_NOT_FOUND, "Handler不存在: " + name);
        }
        return handler;
    }

    public List<String> listHandlerNames() {
        return List.copyOf(handlerMap.keySet());
    }
}

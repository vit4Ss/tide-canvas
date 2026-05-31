package com.tidecanvas.service.ai;

import lombok.Data;

@Data
public class AiHandlerResult {
    private boolean success;
    private String resultUrl;
    private String resultMeta;
    private String errorMsg;

    public static AiHandlerResult ok(String resultUrl) {
        AiHandlerResult r = new AiHandlerResult();
        r.setSuccess(true);
        r.setResultUrl(resultUrl);
        return r;
    }

    public static AiHandlerResult fail(String errorMsg) {
        AiHandlerResult r = new AiHandlerResult();
        r.setSuccess(false);
        r.setErrorMsg(errorMsg);
        return r;
    }
}

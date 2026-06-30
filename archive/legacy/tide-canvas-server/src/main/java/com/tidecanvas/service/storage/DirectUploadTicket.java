package com.tidecanvas.service.storage;

/**
 * 前端直传凭据：对象键、预签名 PUT 地址、最终公网访问地址。
 *
 * @author tidecanvas
 */
public record DirectUploadTicket(String key, String uploadUrl, String fileUrl) {
}

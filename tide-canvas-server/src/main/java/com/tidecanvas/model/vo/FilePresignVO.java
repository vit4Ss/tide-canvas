package com.tidecanvas.model.vo;

import lombok.Data;

/**
 * 前端直传凭据 VO。
 * <p>
 * {@code direct=false} 表示当前存储（本地）不支持直传，前端应回退到服务器中转上传。
 *
 * @author tidecanvas
 */
@Data
public class FilePresignVO {

    /** 是否可走前端直传 */
    private boolean direct;

    /** 预签名 PUT 地址（direct=true 时有效） */
    private String uploadUrl;

    /** 对象键，登记时回传 */
    private String key;

    /** 最终公网访问地址 */
    private String fileUrl;

    /** 直传时必须随 PUT 一起发送的 Content-Type（须与签名一致） */
    private String contentType;
}

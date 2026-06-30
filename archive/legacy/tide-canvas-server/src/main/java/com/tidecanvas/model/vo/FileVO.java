package com.tidecanvas.model.vo;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class FileVO {
    private Long id;
    /** 归属用户ID（团队共享时前端据此区分自己/队友的素材） */
    private Long ownerId;
    private String originalName;
    private String fileUrl;
    private Long fileSize;
    private String fileType;
    private String mimeType;
    private String storageType;
    private LocalDateTime createTime;
}

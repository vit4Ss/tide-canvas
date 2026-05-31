package com.tidecanvas.model.vo;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class FileVO {
    private Long id;
    private String originalName;
    private String fileUrl;
    private Long fileSize;
    private String fileType;
    private String mimeType;
    private String storageType;
    private LocalDateTime createTime;
}

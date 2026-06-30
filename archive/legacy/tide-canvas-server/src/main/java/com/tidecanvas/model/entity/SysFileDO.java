package com.tidecanvas.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.tidecanvas.common.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("sys_file")
public class SysFileDO extends BaseEntity {
    private Long userId;
    private String originalName;
    private String storedName;
    private String filePath;
    private String fileUrl;
    private Long fileSize;
    private String fileType;
    private String mimeType;
    private String hash;
    private String storageType;
}

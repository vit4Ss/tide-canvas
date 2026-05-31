package com.tidecanvas.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public enum StorageTypeEnum {
    LOCAL("local", "本地存储"),
    OSS("oss", "OSS存储");

    private final String code;
    private final String desc;
}

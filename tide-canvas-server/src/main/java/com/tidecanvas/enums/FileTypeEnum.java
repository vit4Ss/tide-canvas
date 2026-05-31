package com.tidecanvas.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public enum FileTypeEnum {
    IMAGE("image", "图片"),
    VIDEO("video", "视频"),
    OTHER("other", "其他");

    private final String code;
    private final String desc;

    public static FileTypeEnum fromMimeType(String mimeType) {
        if (mimeType == null) {
            return OTHER;
        }
        if (mimeType.startsWith("image/")) {
            return IMAGE;
        }
        if (mimeType.startsWith("video/")) {
            return VIDEO;
        }
        return OTHER;
    }
}

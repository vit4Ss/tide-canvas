package com.tidecanvas.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public enum BlogStatusEnum {
    DRAFT(0, "草稿"),
    PUBLISHED(1, "已发布"),
    REMOVED(2, "已下架");

    private final int code;
    private final String desc;

    public static BlogStatusEnum of(int code) {
        for (BlogStatusEnum status : values()) {
            if (status.code == code) {
                return status;
            }
        }
        return null;
    }
}

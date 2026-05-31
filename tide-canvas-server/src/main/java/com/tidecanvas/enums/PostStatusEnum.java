package com.tidecanvas.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public enum PostStatusEnum {
    DRAFT(0, "草稿"),
    PUBLISHED(1, "已发布"),
    REMOVED(2, "已下架");

    private final int code;
    private final String desc;

    public static PostStatusEnum of(int code) {
        for (PostStatusEnum status : values()) {
            if (status.code == code) {
                return status;
            }
        }
        return null;
    }
}

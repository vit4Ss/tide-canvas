package com.tidecanvas.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public enum LikeTargetTypeEnum {
    POST(1, "帖子"),
    COMMENT(2, "评论"),
    BLOG(3, "博客");

    private final int code;
    private final String desc;

    public static LikeTargetTypeEnum of(int code) {
        for (LikeTargetTypeEnum type : values()) {
            if (type.code == code) {
                return type;
            }
        }
        return null;
    }
}

package com.tidecanvas.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public enum AiTaskStatusEnum {
    PROCESSING(0, "处理中"),
    SUCCESS(1, "成功"),
    FAILED(2, "失败"),
    CANCELLED(3, "已取消");

    private final int code;
    private final String desc;
}

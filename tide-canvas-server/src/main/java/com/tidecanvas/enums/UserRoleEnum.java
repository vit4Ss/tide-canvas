package com.tidecanvas.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public enum UserRoleEnum {
    USER(0, "普通用户"),
    VIP(1, "VIP用户"),
    ADMIN(9, "管理员");

    private final int code;
    private final String desc;

    public static UserRoleEnum of(int code) {
        for (UserRoleEnum role : values()) {
            if (role.code == code) {
                return role;
            }
        }
        return USER;
    }
}

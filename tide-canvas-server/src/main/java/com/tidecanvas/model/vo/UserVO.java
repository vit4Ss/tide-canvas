package com.tidecanvas.model.vo;

import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Data
public class UserVO {
    private Long id;
    private String username;
    private String email;
    private String phone;
    private String nickname;
    private String avatar;
    private Integer role;
    private Integer status;
    private Integer apiQuota;
    private Integer points;
    private Integer isAuthor;
    private Long storageQuota;
    /** 所属团队ID；null 表示未加入团队 */
    private Long teamId;
    /** 是否在团队中（前端据此显示团队价/共享标识） */
    private Boolean inTeam;
    /** 团队模式 AI 消耗加价系数（不在团队为 1） */
    private BigDecimal teamPriceFactor;
    private LocalDateTime createTime;
    private LocalDateTime lastLoginTime;
}

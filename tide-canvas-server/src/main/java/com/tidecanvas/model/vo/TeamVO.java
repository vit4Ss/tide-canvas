package com.tidecanvas.model.vo;

import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

@Data
public class TeamVO {
    private Long id;
    private String name;
    private String inviteCode;
    private Long ownerId;
    private Integer memberCount;
    /** 团队模式 AI 消耗加价系数（>1） */
    private BigDecimal priceFactor;
    /** 当前请求用户是否为该团队管理员 */
    private Boolean iAmOwner;
    private List<TeamMemberVO> members;
    private LocalDateTime createTime;
}

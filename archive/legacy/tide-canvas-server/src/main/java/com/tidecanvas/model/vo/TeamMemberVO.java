package com.tidecanvas.model.vo;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class TeamMemberVO {
    private Long userId;
    private String username;
    private String nickname;
    private String avatar;
    /** 团队内角色：0 成员，1 管理员 */
    private Integer role;
    private Boolean isOwner;
    private LocalDateTime joinTime;
}

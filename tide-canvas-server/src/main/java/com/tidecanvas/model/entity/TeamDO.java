package com.tidecanvas.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.tidecanvas.common.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

/** 团队（自助创建，创建者即团队管理员 owner）。 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("team")
public class TeamDO extends BaseEntity {
    private String name;
    /** 团队管理员（创建者）用户ID */
    private Long ownerId;
    /** 加入邀请码 */
    private String inviteCode;
    /** 成员数（冗余展示用，含管理员；真值以 team_member 为准） */
    private Integer memberCount;
}

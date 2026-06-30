package com.tidecanvas.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.tidecanvas.common.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

/** 团队成员关系（user_id 唯一 → 一人至多属于一个团队）。 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("team_member")
public class TeamMemberDO extends BaseEntity {
    private Long teamId;
    private Long userId;
    /** 团队内角色：0 成员，1 管理员 */
    private Integer role;
}

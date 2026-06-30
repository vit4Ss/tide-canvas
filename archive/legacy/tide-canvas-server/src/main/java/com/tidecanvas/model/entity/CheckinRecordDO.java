package com.tidecanvas.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.tidecanvas.common.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;
import java.time.LocalDate;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("checkin_record")
public class CheckinRecordDO extends BaseEntity {
    private Long userId;
    private LocalDate checkinDate;
    private Integer streakDays;
    private Integer pointsAwarded;
}

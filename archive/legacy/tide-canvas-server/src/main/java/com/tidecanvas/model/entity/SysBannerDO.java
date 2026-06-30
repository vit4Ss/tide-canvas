package com.tidecanvas.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.tidecanvas.common.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("sys_banner")
public class SysBannerDO extends BaseEntity {
    private String title;
    private String imageUrl;
    private String linkUrl;
    private Integer sortOrder;
    private Integer status;
}

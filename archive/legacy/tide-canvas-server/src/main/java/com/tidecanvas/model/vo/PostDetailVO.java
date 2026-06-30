package com.tidecanvas.model.vo;

import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 帖子详情VO
 */
@Data
@EqualsAndHashCode(callSuper = true)
public class PostDetailVO extends PostVO {

    private String content;
}

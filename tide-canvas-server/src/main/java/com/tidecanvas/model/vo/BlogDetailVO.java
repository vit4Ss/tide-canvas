package com.tidecanvas.model.vo;

import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 博客详情VO
 * <p>若为付费博客且未购买，content 为 null</p>
 */
@Data
@EqualsAndHashCode(callSuper = true)
public class BlogDetailVO extends BlogVO {

    private String content;
}

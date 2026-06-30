package com.tidecanvas.model.query;

import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 博客查询条件
 */
@Data
@EqualsAndHashCode(callSuper = true)
public class BlogQuery extends PageQuery {

    private String keyword;

    private String category;

    private Long authorId;

    private Boolean free;
}

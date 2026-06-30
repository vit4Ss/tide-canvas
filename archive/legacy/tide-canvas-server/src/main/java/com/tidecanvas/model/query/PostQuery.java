package com.tidecanvas.model.query;

import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 帖子查询条件
 */
@Data
@EqualsAndHashCode(callSuper = true)
public class PostQuery extends PageQuery {

    private String keyword;

    private String category;

    private Long userId;
}

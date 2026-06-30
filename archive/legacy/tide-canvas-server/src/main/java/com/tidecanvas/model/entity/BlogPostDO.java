package com.tidecanvas.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.tidecanvas.common.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("blog_post")
public class BlogPostDO extends BaseEntity {
    private Long authorId;
    private String title;
    private String content;
    private String summary;
    private String coverImage;
    private String category;
    private String tags;
    private Integer pointsRequired;
    private Integer viewCount;
    private Integer likeCount;
    private Integer commentCount;
    private Integer tipTotal;
    private Integer status;
}

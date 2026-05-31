package com.tidecanvas.model.vo;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * 博客VO
 */
@Data
public class BlogVO {

    private Long id;

    private Long authorId;

    private String authorName;

    private String authorAvatar;

    private String title;

    private String summary;

    private String coverImage;

    private String category;

    private String tags;

    private Integer pointsRequired;

    private Integer viewCount;

    private Integer likeCount;

    private Integer tipTotal;

    private Boolean liked;

    private Boolean purchased;

    private LocalDateTime createTime;
}

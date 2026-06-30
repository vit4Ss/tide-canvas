package com.tidecanvas.model.vo;

import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 帖子VO
 */
@Data
public class PostVO {

    private Long id;

    private Long userId;

    private String nickname;

    private String avatar;

    private String title;

    private String contentPreview;

    private String images;

    private List<String> contentImages;

    private String category;

    private String tags;

    private Integer viewCount;

    private Integer likeCount;

    private Integer commentCount;

    private Boolean liked;

    private LocalDateTime createTime;
}

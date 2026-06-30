package com.tidecanvas.model.vo;

import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 评论VO
 */
@Data
public class CommentVO {

    private Long id;

    private Long userId;

    private String nickname;

    private String avatar;

    private String content;

    private Long parentId;

    private Integer likeCount;

    private LocalDateTime createTime;

    private List<CommentVO> replies;
}

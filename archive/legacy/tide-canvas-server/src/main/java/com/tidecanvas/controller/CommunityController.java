package com.tidecanvas.controller;

import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.Result;
import com.tidecanvas.model.dto.CommentCreateDTO;
import com.tidecanvas.model.dto.PostCreateDTO;
import com.tidecanvas.model.dto.PostUpdateDTO;
import com.tidecanvas.model.query.PostQuery;
import com.tidecanvas.model.vo.CommentVO;
import com.tidecanvas.model.vo.PostDetailVO;
import com.tidecanvas.model.vo.PostVO;
import com.tidecanvas.security.SecurityUtils;
import com.tidecanvas.service.CommunityService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 社区接口
 *
 * @author tidecanvas
 */
@Tag(name = "社区动态")
@RestController
@RequestMapping("/api/posts")
@RequiredArgsConstructor
public class CommunityController {

    private final CommunityService communityService;

    @Operation(summary = "发布帖子")
    @PostMapping
    public Result<PostVO> create(@Valid @RequestBody PostCreateDTO dto) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(communityService.createPost(userId, dto));
    }

    @Operation(summary = "更新帖子")
    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id,
                               @Valid @RequestBody PostUpdateDTO dto) {
        Long userId = SecurityUtils.getCurrentUserId();
        communityService.updatePost(userId, id, dto);
        return Result.success();
    }

    @Operation(summary = "删除帖子")
    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        Long userId = SecurityUtils.getCurrentUserId();
        communityService.deletePost(userId, id);
        return Result.success();
    }

    @Operation(summary = "帖子详情")
    @GetMapping("/{id}")
    public Result<PostDetailVO> get(@PathVariable Long id) {
        Long currentUserId = tryGetCurrentUserId();
        return Result.success(communityService.getPost(id, currentUserId));
    }

    @Operation(summary = "帖子列表")
    @GetMapping
    public Result<PageResult<PostVO>> list(PostQuery query) {
        Long currentUserId = tryGetCurrentUserId();
        return Result.success(communityService.listPosts(query, currentUserId));
    }

    @Operation(summary = "点赞/取消点赞")
    @PostMapping("/{id}/like")
    public Result<Boolean> toggleLike(@PathVariable Long id) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(communityService.toggleLikePost(userId, id));
    }

    @Operation(summary = "发表评论")
    @PostMapping("/{id}/comments")
    public Result<CommentVO> createComment(@PathVariable Long id,
                                           @Valid @RequestBody CommentCreateDTO dto) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(communityService.addComment(userId, id, dto));
    }

    @Operation(summary = "评论列表")
    @GetMapping("/{id}/comments")
    public Result<List<CommentVO>> listComments(@PathVariable Long id) {
        return Result.success(communityService.listComments(id));
    }

    @Operation(summary = "删除评论")
    @DeleteMapping("/comments/{commentId}")
    public Result<Void> deleteComment(@PathVariable Long commentId) {
        Long userId = SecurityUtils.getCurrentUserId();
        communityService.deleteComment(userId, commentId);
        return Result.success();
    }

    /**
     * 尝试获取当前登录用户ID，未登录时返回null
     */
    private Long tryGetCurrentUserId() {
        return SecurityUtils.getCurrentUserIdOrNull();
    }
}

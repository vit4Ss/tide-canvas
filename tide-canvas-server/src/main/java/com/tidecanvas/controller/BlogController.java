package com.tidecanvas.controller;

import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.Result;
import com.tidecanvas.model.dto.BlogCreateDTO;
import com.tidecanvas.model.dto.BlogTipDTO;
import com.tidecanvas.model.dto.BlogUpdateDTO;
import com.tidecanvas.model.query.BlogQuery;
import com.tidecanvas.model.vo.BlogDetailVO;
import com.tidecanvas.model.vo.BlogVO;
import com.tidecanvas.security.SecurityUtils;
import com.tidecanvas.service.BlogService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

/**
 * 博客接口
 *
 * @author tidecanvas
 */
@Tag(name = "博客管理")
@RestController
@RequestMapping("/api/blogs")
@RequiredArgsConstructor
public class BlogController {

    private final BlogService blogService;

    @Operation(summary = "发布博客")
    @PreAuthorize("hasRole('AUTHOR')")
    @PostMapping
    public Result<BlogVO> create(@Valid @RequestBody BlogCreateDTO dto) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(blogService.createBlog(userId, dto));
    }

    @Operation(summary = "更新博客")
    @PreAuthorize("hasRole('AUTHOR')")
    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id,
                               @Valid @RequestBody BlogUpdateDTO dto) {
        Long userId = SecurityUtils.getCurrentUserId();
        blogService.updateBlog(userId, id, dto);
        return Result.success();
    }

    @Operation(summary = "删除博客")
    @PreAuthorize("hasRole('AUTHOR')")
    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        Long userId = SecurityUtils.getCurrentUserId();
        blogService.deleteBlog(userId, id);
        return Result.success();
    }

    @Operation(summary = "博客详情")
    @GetMapping("/{id}")
    public Result<BlogDetailVO> get(@PathVariable Long id) {
        Long currentUserId = tryGetCurrentUserId();
        return Result.success(blogService.getBlog(id, currentUserId));
    }

    @Operation(summary = "博客列表")
    @GetMapping
    public Result<PageResult<BlogVO>> list(BlogQuery query) {
        Long currentUserId = tryGetCurrentUserId();
        return Result.success(blogService.listBlogs(query, currentUserId));
    }

    @Operation(summary = "购买付费博客")
    @PostMapping("/{id}/purchase")
    public Result<Void> purchase(@PathVariable Long id) {
        Long userId = SecurityUtils.getCurrentUserId();
        blogService.purchaseBlog(userId, id);
        return Result.success();
    }

    @Operation(summary = "打赏博客")
    @PostMapping("/{id}/tip")
    public Result<Void> tip(@PathVariable Long id,
                            @Valid @RequestBody BlogTipDTO dto) {
        Long userId = SecurityUtils.getCurrentUserId();
        blogService.tipBlog(userId, id, dto);
        return Result.success();
    }

    @Operation(summary = "点赞/取消点赞")
    @PostMapping("/{id}/like")
    public Result<Boolean> toggleLike(@PathVariable Long id) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(blogService.toggleLikeBlog(userId, id));
    }

    @Operation(summary = "我的博客列表")
    @GetMapping("/my")
    public Result<PageResult<BlogVO>> myBlogs(BlogQuery query) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(blogService.listMyBlogs(userId, query));
    }

    /**
     * 尝试获取当前登录用户ID，未登录时返回null
     */
    private Long tryGetCurrentUserId() {
        return SecurityUtils.getCurrentUserIdOrNull();
    }
}

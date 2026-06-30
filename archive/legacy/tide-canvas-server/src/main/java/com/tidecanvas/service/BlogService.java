package com.tidecanvas.service;

import com.tidecanvas.common.PageResult;
import com.tidecanvas.model.dto.BlogCreateDTO;
import com.tidecanvas.model.dto.BlogTipDTO;
import com.tidecanvas.model.dto.BlogUpdateDTO;
import com.tidecanvas.model.query.BlogQuery;
import com.tidecanvas.model.vo.BlogDetailVO;
import com.tidecanvas.model.vo.BlogVO;

/**
 * 博客服务接口
 *
 * @author tidecanvas
 */
public interface BlogService {

    /**
     * 创建博客
     *
     * @param userId 用户ID
     * @param dto    博客创建DTO
     * @return 博客VO
     */
    BlogVO createBlog(Long userId, BlogCreateDTO dto);

    /**
     * 更新博客
     *
     * @param userId 用户ID
     * @param blogId 博客ID
     * @param dto    博客更新DTO
     */
    void updateBlog(Long userId, Long blogId, BlogUpdateDTO dto);

    /**
     * 删除博客
     *
     * @param userId 用户ID
     * @param blogId 博客ID
     */
    void deleteBlog(Long userId, Long blogId);

    /**
     * 获取博客详情
     *
     * @param blogId        博客ID
     * @param currentUserId 当前用户ID（可为null）
     * @return 博客详情VO
     */
    BlogDetailVO getBlog(Long blogId, Long currentUserId);

    /**
     * 分页查询博客列表
     *
     * @param query         查询条件
     * @param currentUserId 当前用户ID（可为null）
     * @return 分页结果
     */
    PageResult<BlogVO> listBlogs(BlogQuery query, Long currentUserId);

    /**
     * 购买博客
     *
     * @param userId 用户ID
     * @param blogId 博客ID
     */
    void purchaseBlog(Long userId, Long blogId);

    /**
     * 打赏博客
     *
     * @param userId 用户ID
     * @param blogId 博客ID
     * @param dto    打赏DTO
     */
    void tipBlog(Long userId, Long blogId, BlogTipDTO dto);

    /**
     * 切换博客点赞状态
     *
     * @param userId 用户ID
     * @param blogId 博客ID
     * @return true=已点赞, false=已取消
     */
    boolean toggleLikeBlog(Long userId, Long blogId);

    /**
     * 分页查询我的博客列表
     *
     * @param userId 用户ID
     * @param query  查询条件
     * @return 分页结果
     */
    PageResult<BlogVO> listMyBlogs(Long userId, BlogQuery query);
}

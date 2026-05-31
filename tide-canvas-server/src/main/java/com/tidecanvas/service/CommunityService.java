package com.tidecanvas.service;

import com.tidecanvas.common.PageResult;
import com.tidecanvas.model.dto.CommentCreateDTO;
import com.tidecanvas.model.dto.PostCreateDTO;
import com.tidecanvas.model.dto.PostUpdateDTO;
import com.tidecanvas.model.query.PostQuery;
import com.tidecanvas.model.vo.CommentVO;
import com.tidecanvas.model.vo.PostDetailVO;
import com.tidecanvas.model.vo.PostVO;

import java.util.List;

/**
 * 社区服务接口
 *
 * @author tidecanvas
 */
public interface CommunityService {

    /**
     * 创建帖子
     *
     * @param userId 用户ID
     * @param dto    帖子创建DTO
     * @return 帖子VO
     */
    PostVO createPost(Long userId, PostCreateDTO dto);

    /**
     * 更新帖子
     *
     * @param userId 用户ID
     * @param postId 帖子ID
     * @param dto    帖子更新DTO
     */
    void updatePost(Long userId, Long postId, PostUpdateDTO dto);

    /**
     * 删除帖子
     *
     * @param userId 用户ID
     * @param postId 帖子ID
     */
    void deletePost(Long userId, Long postId);

    /**
     * 获取帖子详情
     *
     * @param postId        帖子ID
     * @param currentUserId 当前用户ID（可为null）
     * @return 帖子详情VO
     */
    PostDetailVO getPost(Long postId, Long currentUserId);

    /**
     * 分页查询帖子列表
     *
     * @param query         查询条件
     * @param currentUserId 当前用户ID（可为null）
     * @return 分页结果
     */
    PageResult<PostVO> listPosts(PostQuery query, Long currentUserId);

    /**
     * 切换帖子点赞状态
     *
     * @param userId 用户ID
     * @param postId 帖子ID
     * @return true=已点赞, false=已取消
     */
    boolean toggleLikePost(Long userId, Long postId);

    /**
     * 添加评论
     *
     * @param userId 用户ID
     * @param postId 帖子ID
     * @param dto    评论创建DTO
     * @return 评论VO
     */
    CommentVO addComment(Long userId, Long postId, CommentCreateDTO dto);

    /**
     * 查询帖子评论列表（树形结构）
     *
     * @param postId 帖子ID
     * @return 评论列表
     */
    List<CommentVO> listComments(Long postId);

    /**
     * 删除评论
     *
     * @param userId    用户ID
     * @param commentId 评论ID
     */
    void deleteComment(Long userId, Long commentId);
}

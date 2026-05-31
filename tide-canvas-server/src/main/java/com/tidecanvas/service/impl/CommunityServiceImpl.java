package com.tidecanvas.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.ResultCode;
import com.tidecanvas.enums.LikeTargetTypeEnum;
import com.tidecanvas.exception.BusinessException;
import com.tidecanvas.mapper.CommunityCommentMapper;
import com.tidecanvas.mapper.CommunityLikeMapper;
import com.tidecanvas.mapper.CommunityPostMapper;
import com.tidecanvas.mapper.SysUserMapper;
import com.tidecanvas.model.dto.CommentCreateDTO;
import com.tidecanvas.model.dto.PostCreateDTO;
import com.tidecanvas.model.dto.PostUpdateDTO;
import com.tidecanvas.model.entity.CommunityCommentDO;
import com.tidecanvas.model.entity.CommunityLikeDO;
import com.tidecanvas.model.entity.CommunityPostDO;
import com.tidecanvas.model.entity.SysUserDO;
import com.tidecanvas.model.query.PostQuery;
import com.tidecanvas.model.vo.CommentVO;
import com.tidecanvas.model.vo.PostDetailVO;
import com.tidecanvas.model.vo.PostVO;
import com.tidecanvas.service.CommunityService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * 社区服务实现类
 *
 * @author tidecanvas
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CommunityServiceImpl implements CommunityService {

    private final CommunityPostMapper postMapper;
    private final CommunityCommentMapper commentMapper;
    private final CommunityLikeMapper likeMapper;
    private final SysUserMapper userMapper;
    private final ObjectMapper objectMapper;

    private static final int CONTENT_PREVIEW_LENGTH = 200;
    private static final Pattern IMAGE_PATTERN = Pattern.compile("!\\[[^\\]]*]\\(\\s*([^)\\s]+)");

    @Override
    @Transactional(rollbackFor = Exception.class)
    public PostVO createPost(Long userId, PostCreateDTO dto) {
        CommunityPostDO post = new CommunityPostDO();
        post.setUserId(userId);
        post.setTitle(dto.getTitle());
        post.setContent(dto.getContent());
        post.setImages(toJsonString(dto.getImages()));
        post.setCategory(dto.getCategory());
        post.setTags(toJsonString(dto.getTags()));
        post.setViewCount(0);
        post.setLikeCount(0);
        post.setCommentCount(0);
        post.setStatus(1);
        post.setDeleted(0);
        postMapper.insert(post);
        return toPostVO(post, userId);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void updatePost(Long userId, Long postId, PostUpdateDTO dto) {
        CommunityPostDO post = getAndCheckOwnership(userId, postId);

        if (StringUtils.hasText(dto.getTitle())) {
            post.setTitle(dto.getTitle());
        }
        if (dto.getContent() != null) {
            post.setContent(dto.getContent());
        }
        if (dto.getImages() != null) {
            post.setImages(toJsonString(dto.getImages()));
        }
        if (dto.getCategory() != null) {
            post.setCategory(dto.getCategory());
        }
        if (dto.getTags() != null) {
            post.setTags(toJsonString(dto.getTags()));
        }
        if (dto.getStatus() != null) {
            post.setStatus(dto.getStatus());
        }
        postMapper.updateById(post);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void deletePost(Long userId, Long postId) {
        getAndCheckOwnership(userId, postId);
        postMapper.deleteById(postId);
    }

    @Override
    public PostDetailVO getPost(Long postId, Long currentUserId) {
        CommunityPostDO post = postMapper.selectById(postId);
        if (post == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "帖子不存在");
        }

        // 原子自增浏览量
        postMapper.update(null, new UpdateWrapper<CommunityPostDO>()
                .setSql("view_count = view_count + 1")
                .eq("id", postId));

        SysUserDO user = userMapper.selectById(post.getUserId());

        PostDetailVO vo = new PostDetailVO();
        vo.setId(post.getId());
        vo.setUserId(post.getUserId());
        vo.setNickname(user != null ? user.getNickname() : null);
        vo.setAvatar(user != null ? user.getAvatar() : null);
        vo.setTitle(post.getTitle());
        vo.setContent(post.getContent());
        vo.setContentPreview(buildContentPreview(post.getContent()));
        vo.setImages(post.getImages());
        vo.setCategory(post.getCategory());
        vo.setTags(post.getTags());
        vo.setViewCount(post.getViewCount() + 1);
        vo.setLikeCount(post.getLikeCount());
        vo.setCommentCount(post.getCommentCount());
        vo.setLiked(checkLiked(currentUserId, LikeTargetTypeEnum.POST, postId));
        vo.setCreateTime(post.getCreateTime());
        return vo;
    }

    @Override
    public PageResult<PostVO> listPosts(PostQuery query, Long currentUserId) {
        Page<CommunityPostDO> page = new Page<>(query.getPageNum(), query.getPageSize());

        LambdaQueryWrapper<CommunityPostDO> wrapper = new LambdaQueryWrapper<CommunityPostDO>()
                .like(StringUtils.hasText(query.getKeyword()), CommunityPostDO::getTitle, query.getKeyword())
                .eq(StringUtils.hasText(query.getCategory()), CommunityPostDO::getCategory, query.getCategory())
                .eq(query.getUserId() != null, CommunityPostDO::getUserId, query.getUserId())
                .orderByDesc(CommunityPostDO::getCreateTime);

        postMapper.selectPage(page, wrapper);
        List<PostVO> records = page.getRecords().stream()
                .map(post -> toPostVO(post, currentUserId))
                .toList();
        return PageResult.of(records, page);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public boolean toggleLikePost(Long userId, Long postId) {
        CommunityPostDO post = postMapper.selectById(postId);
        if (post == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "帖子不存在");
        }

        CommunityLikeDO existingLike = likeMapper.selectOne(
                new LambdaQueryWrapper<CommunityLikeDO>()
                        .eq(CommunityLikeDO::getUserId, userId)
                        .eq(CommunityLikeDO::getTargetType, LikeTargetTypeEnum.POST.getCode())
                        .eq(CommunityLikeDO::getTargetId, postId));

        if (existingLike != null) {
            // 取消点赞
            likeMapper.deleteById(existingLike.getId());
            postMapper.update(null, new UpdateWrapper<CommunityPostDO>()
                    .setSql("like_count = like_count - 1")
                    .eq("id", postId)
                    .gt("like_count", 0));
            return false;
        }

        // 新增点赞
        CommunityLikeDO like = new CommunityLikeDO();
        like.setUserId(userId);
        like.setTargetType(LikeTargetTypeEnum.POST.getCode());
        like.setTargetId(postId);
        like.setCreateTime(LocalDateTime.now());
        likeMapper.insert(like);

        postMapper.update(null, new UpdateWrapper<CommunityPostDO>()
                .setSql("like_count = like_count + 1")
                .eq("id", postId));
        return true;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public CommentVO addComment(Long userId, Long postId, CommentCreateDTO dto) {
        CommunityPostDO post = postMapper.selectById(postId);
        if (post == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "帖子不存在");
        }

        CommunityCommentDO comment = new CommunityCommentDO();
        comment.setPostId(postId);
        comment.setUserId(userId);
        comment.setParentId(dto.getParentId());
        comment.setContent(dto.getContent());
        comment.setLikeCount(0);
        comment.setStatus(1);
        comment.setDeleted(0);
        commentMapper.insert(comment);

        // 原子自增评论数
        postMapper.update(null, new UpdateWrapper<CommunityPostDO>()
                .setSql("comment_count = comment_count + 1")
                .eq("id", postId));

        return toCommentVO(comment);
    }

    @Override
    public List<CommentVO> listComments(Long postId) {
        List<CommunityCommentDO> allComments = commentMapper.selectList(
                new LambdaQueryWrapper<CommunityCommentDO>()
                        .eq(CommunityCommentDO::getPostId, postId)
                        .orderByAsc(CommunityCommentDO::getCreateTime));

        if (allComments.isEmpty()) {
            return Collections.emptyList();
        }

        // 转换为 VO 列表
        List<CommentVO> allVos = allComments.stream()
                .map(this::toCommentVO)
                .toList();

        // 按 parentId 分组，构建树形结构
        Map<Long, List<CommentVO>> childrenMap = allVos.stream()
                .filter(vo -> vo.getParentId() != null)
                .collect(Collectors.groupingBy(CommentVO::getParentId));

        // 顶层评论
        List<CommentVO> topLevel = new ArrayList<>();
        for (CommentVO vo : allVos) {
            vo.setReplies(childrenMap.getOrDefault(vo.getId(), Collections.emptyList()));
            if (vo.getParentId() == null) {
                topLevel.add(vo);
            }
        }
        return topLevel;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void deleteComment(Long userId, Long commentId) {
        CommunityCommentDO comment = commentMapper.selectById(commentId);
        if (comment == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "评论不存在");
        }
        if (!comment.getUserId().equals(userId)) {
            throw new BusinessException(ResultCode.FORBIDDEN, "无权删除该评论");
        }

        commentMapper.deleteById(commentId);

        // 原子自减评论数
        postMapper.update(null, new UpdateWrapper<CommunityPostDO>()
                .setSql("comment_count = comment_count - 1")
                .eq("id", comment.getPostId())
                .gt("comment_count", 0));
    }

    // ============================= 私有方法 =============================

    /**
     * 校验帖子所有权并返回帖子实体
     */
    private CommunityPostDO getAndCheckOwnership(Long userId, Long postId) {
        CommunityPostDO post = postMapper.selectById(postId);
        if (post == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "帖子不存在");
        }
        if (!post.getUserId().equals(userId)) {
            throw new BusinessException(ResultCode.FORBIDDEN, "无权操作该帖子");
        }
        return post;
    }

    /**
     * 检查当前用户是否已点赞
     */
    private Boolean checkLiked(Long currentUserId, LikeTargetTypeEnum targetType, Long targetId) {
        if (currentUserId == null) {
            return false;
        }
        Long count = likeMapper.selectCount(
                new LambdaQueryWrapper<CommunityLikeDO>()
                        .eq(CommunityLikeDO::getUserId, currentUserId)
                        .eq(CommunityLikeDO::getTargetType, targetType.getCode())
                        .eq(CommunityLikeDO::getTargetId, targetId));
        return count > 0;
    }

    /**
     * 构建内容预览（截取前200字符）
     */
    private String buildContentPreview(String content) {
        String text = stripMarkdown(content);
        if (text == null) {
            return null;
        }
        if (text.length() <= CONTENT_PREVIEW_LENGTH) {
            return text;
        }
        return text.substring(0, CONTENT_PREVIEW_LENGTH) + "...";
    }

    /**
     * 提取正文中所有图片地址（Markdown 图片语法，最多 9 张）
     */
    private List<String> extractImages(String content) {
        if (content == null) {
            return Collections.emptyList();
        }
        List<String> urls = new ArrayList<>();
        Matcher matcher = IMAGE_PATTERN.matcher(content);
        while (matcher.find() && urls.size() < 9) {
            urls.add(matcher.group(1));
        }
        return urls;
    }

    /**
     * 去除 Markdown 标记，转为纯文本（用于列表预览）
     */
    private String stripMarkdown(String md) {
        if (md == null) {
            return null;
        }
        String text = md;
        text = text.replaceAll("```[\\s\\S]*?```", " ");                          // 代码块
        text = text.replaceAll("!\\[[^\\]]*]\\([^)]*\\)", " ");                    // 图片
        text = text.replaceAll("\\[([^\\]]*)]\\([^)]*\\)", "$1");                  // 链接 -> 文字
        text = text.replaceAll("(?m)^\\s{0,3}(#{1,6}|>|[-*+]|\\d+\\.)\\s+", "");   // 行首标记
        text = text.replaceAll("[*_~`]", "");                                      // 强调/行内代码符号
        text = text.replaceAll("\\s+", " ").trim();                               // 折叠空白
        return text;
    }

    /**
     * 将 List 转换为 JSON 字符串
     */
    private String toJsonString(List<String> list) {
        if (list == null || list.isEmpty()) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(list);
        } catch (JsonProcessingException e) {
            log.error("JSON序列化失败", e);
            return null;
        }
    }

    /**
     * 将帖子DO转换为PostVO
     */
    private PostVO toPostVO(CommunityPostDO post, Long currentUserId) {
        SysUserDO user = userMapper.selectById(post.getUserId());

        PostVO vo = new PostVO();
        vo.setId(post.getId());
        vo.setUserId(post.getUserId());
        vo.setNickname(user != null ? user.getNickname() : null);
        vo.setAvatar(user != null ? user.getAvatar() : null);
        vo.setTitle(post.getTitle());
        vo.setContentPreview(buildContentPreview(post.getContent()));
        vo.setContentImages(extractImages(post.getContent()));
        vo.setImages(post.getImages());
        vo.setCategory(post.getCategory());
        vo.setTags(post.getTags());
        vo.setViewCount(post.getViewCount());
        vo.setLikeCount(post.getLikeCount());
        vo.setCommentCount(post.getCommentCount());
        vo.setLiked(checkLiked(currentUserId, LikeTargetTypeEnum.POST, post.getId()));
        vo.setCreateTime(post.getCreateTime());
        return vo;
    }

    /**
     * 将评论DO转换为CommentVO
     */
    private CommentVO toCommentVO(CommunityCommentDO comment) {
        SysUserDO user = userMapper.selectById(comment.getUserId());

        CommentVO vo = new CommentVO();
        vo.setId(comment.getId());
        vo.setUserId(comment.getUserId());
        vo.setNickname(user != null ? user.getNickname() : null);
        vo.setAvatar(user != null ? user.getAvatar() : null);
        vo.setContent(comment.getContent());
        vo.setParentId(comment.getParentId());
        vo.setLikeCount(comment.getLikeCount());
        vo.setCreateTime(comment.getCreateTime());
        vo.setReplies(Collections.emptyList());
        return vo;
    }
}

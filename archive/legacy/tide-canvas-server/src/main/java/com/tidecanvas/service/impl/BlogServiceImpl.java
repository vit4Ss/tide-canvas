package com.tidecanvas.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.ResultCode;
import com.tidecanvas.enums.LikeTargetTypeEnum;
import com.tidecanvas.enums.PointsTransactionTypeEnum;
import com.tidecanvas.exception.BusinessException;
import com.tidecanvas.mapper.BlogPostMapper;
import com.tidecanvas.mapper.BlogPurchaseMapper;
import com.tidecanvas.mapper.CommunityLikeMapper;
import com.tidecanvas.mapper.SysUserMapper;
import com.tidecanvas.model.dto.BlogCreateDTO;
import com.tidecanvas.model.dto.BlogTipDTO;
import com.tidecanvas.model.dto.BlogUpdateDTO;
import com.tidecanvas.model.entity.BlogPostDO;
import com.tidecanvas.model.entity.BlogPurchaseDO;
import com.tidecanvas.model.entity.CommunityLikeDO;
import com.tidecanvas.model.entity.SysUserDO;
import com.tidecanvas.model.query.BlogQuery;
import com.tidecanvas.model.vo.BlogDetailVO;
import com.tidecanvas.model.vo.BlogVO;
import com.tidecanvas.service.BlogService;
import com.tidecanvas.service.PointsService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 博客服务实现类
 *
 * @author tidecanvas
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class BlogServiceImpl implements BlogService {

    private final BlogPostMapper blogPostMapper;
    private final BlogPurchaseMapper blogPurchaseMapper;
    private final CommunityLikeMapper likeMapper;
    private final SysUserMapper userMapper;
    private final PointsService pointsService;
    private final ObjectMapper objectMapper;

    @Override
    @Transactional(rollbackFor = Exception.class)
    public BlogVO createBlog(Long userId, BlogCreateDTO dto) {
        SysUserDO user = userMapper.selectById(userId);
        if (user == null) {
            throw new BusinessException(ResultCode.ACCOUNT_NOT_FOUND);
        }
        if (user.getIsAuthor() == null || user.getIsAuthor() != 1) {
            throw new BusinessException(ResultCode.NOT_AUTHOR);
        }

        BlogPostDO blog = new BlogPostDO();
        blog.setAuthorId(userId);
        blog.setTitle(dto.getTitle());
        blog.setContent(dto.getContent());
        blog.setSummary(dto.getSummary());
        blog.setCoverImage(dto.getCoverImage());
        blog.setCategory(dto.getCategory());
        blog.setTags(toJsonString(dto.getTags()));
        blog.setPointsRequired(dto.getPointsRequired() != null ? dto.getPointsRequired() : 0);
        blog.setViewCount(0);
        blog.setLikeCount(0);
        blog.setCommentCount(0);
        blog.setTipTotal(0);
        blog.setStatus(1);
        blog.setDeleted(0);
        blogPostMapper.insert(blog);

        return toBlogVO(blog, userId);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void updateBlog(Long userId, Long blogId, BlogUpdateDTO dto) {
        BlogPostDO blog = getAndCheckOwnership(userId, blogId);

        if (StringUtils.hasText(dto.getTitle())) {
            blog.setTitle(dto.getTitle());
        }
        if (dto.getContent() != null) {
            blog.setContent(dto.getContent());
        }
        if (dto.getSummary() != null) {
            blog.setSummary(dto.getSummary());
        }
        if (dto.getCoverImage() != null) {
            blog.setCoverImage(dto.getCoverImage());
        }
        if (dto.getCategory() != null) {
            blog.setCategory(dto.getCategory());
        }
        if (dto.getTags() != null) {
            blog.setTags(toJsonString(dto.getTags()));
        }
        if (dto.getPointsRequired() != null) {
            blog.setPointsRequired(dto.getPointsRequired());
        }
        if (dto.getStatus() != null) {
            blog.setStatus(dto.getStatus());
        }
        blogPostMapper.updateById(blog);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void deleteBlog(Long userId, Long blogId) {
        getAndCheckOwnership(userId, blogId);
        blogPostMapper.deleteById(blogId);
    }

    @Override
    public BlogDetailVO getBlog(Long blogId, Long currentUserId) {
        BlogPostDO blog = blogPostMapper.selectById(blogId);
        if (blog == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "博客不存在");
        }

        // 原子自增浏览量
        blogPostMapper.update(null, new UpdateWrapper<BlogPostDO>()
                .setSql("view_count = view_count + 1")
                .eq("id", blogId));

        SysUserDO author = userMapper.selectById(blog.getAuthorId());

        BlogDetailVO vo = new BlogDetailVO();
        vo.setId(blog.getId());
        vo.setAuthorId(blog.getAuthorId());
        vo.setAuthorName(author != null ? author.getNickname() : null);
        vo.setAuthorAvatar(author != null ? author.getAvatar() : null);
        vo.setTitle(blog.getTitle());
        vo.setSummary(blog.getSummary());
        vo.setCoverImage(blog.getCoverImage());
        vo.setCategory(blog.getCategory());
        vo.setTags(blog.getTags());
        vo.setPointsRequired(blog.getPointsRequired());
        vo.setViewCount(blog.getViewCount() + 1);
        vo.setLikeCount(blog.getLikeCount());
        vo.setTipTotal(blog.getTipTotal());
        vo.setLiked(checkLiked(currentUserId, blogId));
        vo.setCreateTime(blog.getCreateTime());

        // 付费内容访问控制
        boolean purchased = false;
        boolean isAuthor = currentUserId != null && currentUserId.equals(blog.getAuthorId());
        if (blog.getPointsRequired() != null && blog.getPointsRequired() > 0) {
            if (currentUserId != null) {
                purchased = checkPurchased(currentUserId, blogId);
            }
            // 非作者且未购买，内容不可见
            if (!isAuthor && !purchased) {
                vo.setContent(null);
            } else {
                vo.setContent(blog.getContent());
            }
        } else {
            // 免费博客，内容直接可见
            vo.setContent(blog.getContent());
            purchased = true;
        }
        vo.setPurchased(purchased || isAuthor);
        return vo;
    }

    @Override
    public PageResult<BlogVO> listBlogs(BlogQuery query, Long currentUserId) {
        Page<BlogPostDO> page = new Page<>(query.getPageNum(), query.getPageSize());

        LambdaQueryWrapper<BlogPostDO> wrapper = new LambdaQueryWrapper<BlogPostDO>()
                .and(StringUtils.hasText(query.getKeyword()),
                        w -> w.like(BlogPostDO::getTitle, query.getKeyword())
                                .or()
                                .like(BlogPostDO::getSummary, query.getKeyword()))
                .eq(StringUtils.hasText(query.getCategory()), BlogPostDO::getCategory, query.getCategory())
                .eq(query.getAuthorId() != null, BlogPostDO::getAuthorId, query.getAuthorId())
                .eq(Boolean.TRUE.equals(query.getFree()), BlogPostDO::getPointsRequired, 0)
                .orderByDesc(BlogPostDO::getCreateTime);

        blogPostMapper.selectPage(page, wrapper);
        List<BlogVO> records = page.getRecords().stream()
                .map(blog -> toBlogVO(blog, currentUserId))
                .toList();
        return PageResult.of(records, page);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void purchaseBlog(Long userId, Long blogId) {
        BlogPostDO blog = blogPostMapper.selectById(blogId);
        if (blog == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "博客不存在");
        }
        if (blog.getPointsRequired() == null || blog.getPointsRequired() <= 0) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "该博客无需购买");
        }

        // 检查是否已购买
        if (checkPurchased(userId, blogId)) {
            throw new BusinessException(ResultCode.BLOG_ALREADY_PURCHASED);
        }

        int pointsRequired = blog.getPointsRequired();

        // 扣减用户积分
        pointsService.deductPoints(userId, pointsRequired,
                PointsTransactionTypeEnum.BLOG_VIEW, blogId, "购买博客: " + blog.getTitle());

        // 插入购买记录
        BlogPurchaseDO purchase = new BlogPurchaseDO();
        purchase.setUserId(userId);
        purchase.setBlogId(blogId);
        purchase.setPointsPaid(pointsRequired);
        purchase.setCreateTime(LocalDateTime.now());
        blogPurchaseMapper.insert(purchase);

        // 作者获得积分
        pointsService.addPoints(blog.getAuthorId(), pointsRequired,
                PointsTransactionTypeEnum.TIP_IN, blogId, "博客被购买: " + blog.getTitle());

        log.info("博客购买成功: userId={}, blogId={}, points={}", userId, blogId, pointsRequired);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void tipBlog(Long userId, Long blogId, BlogTipDTO dto) {
        BlogPostDO blog = blogPostMapper.selectById(blogId);
        if (blog == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "博客不存在");
        }

        int amount = dto.getAmount();

        // 扣减打赏者积分
        pointsService.deductPoints(userId, amount,
                PointsTransactionTypeEnum.TIP_OUT, blogId, "打赏博客: " + blog.getTitle());

        // 作者获得打赏积分
        pointsService.addPoints(blog.getAuthorId(), amount,
                PointsTransactionTypeEnum.TIP_IN, blogId, "收到打赏: " + blog.getTitle());

        // 原子更新博客打赏总额
        blogPostMapper.update(null, new UpdateWrapper<BlogPostDO>()
                .setSql("tip_total = tip_total + " + amount)
                .eq("id", blogId));

        log.info("博客打赏成功: userId={}, blogId={}, amount={}", userId, blogId, amount);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public boolean toggleLikeBlog(Long userId, Long blogId) {
        BlogPostDO blog = blogPostMapper.selectById(blogId);
        if (blog == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "博客不存在");
        }

        CommunityLikeDO existingLike = likeMapper.selectOne(
                new LambdaQueryWrapper<CommunityLikeDO>()
                        .eq(CommunityLikeDO::getUserId, userId)
                        .eq(CommunityLikeDO::getTargetType, LikeTargetTypeEnum.BLOG.getCode())
                        .eq(CommunityLikeDO::getTargetId, blogId));

        if (existingLike != null) {
            // 取消点赞
            likeMapper.deleteById(existingLike.getId());
            blogPostMapper.update(null, new UpdateWrapper<BlogPostDO>()
                    .setSql("like_count = like_count - 1")
                    .eq("id", blogId)
                    .gt("like_count", 0));
            return false;
        }

        // 新增点赞
        CommunityLikeDO like = new CommunityLikeDO();
        like.setUserId(userId);
        like.setTargetType(LikeTargetTypeEnum.BLOG.getCode());
        like.setTargetId(blogId);
        like.setCreateTime(LocalDateTime.now());
        likeMapper.insert(like);

        blogPostMapper.update(null, new UpdateWrapper<BlogPostDO>()
                .setSql("like_count = like_count + 1")
                .eq("id", blogId));
        return true;
    }

    @Override
    public PageResult<BlogVO> listMyBlogs(Long userId, BlogQuery query) {
        Page<BlogPostDO> page = new Page<>(query.getPageNum(), query.getPageSize());

        LambdaQueryWrapper<BlogPostDO> wrapper = new LambdaQueryWrapper<BlogPostDO>()
                .eq(BlogPostDO::getAuthorId, userId)
                .and(StringUtils.hasText(query.getKeyword()),
                        w -> w.like(BlogPostDO::getTitle, query.getKeyword())
                                .or()
                                .like(BlogPostDO::getSummary, query.getKeyword()))
                .eq(StringUtils.hasText(query.getCategory()), BlogPostDO::getCategory, query.getCategory())
                .orderByDesc(BlogPostDO::getCreateTime);

        blogPostMapper.selectPage(page, wrapper);
        List<BlogVO> records = page.getRecords().stream()
                .map(blog -> toBlogVO(blog, userId))
                .toList();
        return PageResult.of(records, page);
    }

    // ============================= 私有方法 =============================

    /**
     * 校验博客所有权并返回博客实体
     */
    private BlogPostDO getAndCheckOwnership(Long userId, Long blogId) {
        BlogPostDO blog = blogPostMapper.selectById(blogId);
        if (blog == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "博客不存在");
        }
        if (!blog.getAuthorId().equals(userId)) {
            throw new BusinessException(ResultCode.FORBIDDEN, "无权操作该博客");
        }
        return blog;
    }

    /**
     * 检查当前用户是否已点赞
     */
    private Boolean checkLiked(Long currentUserId, Long blogId) {
        if (currentUserId == null) {
            return false;
        }
        Long count = likeMapper.selectCount(
                new LambdaQueryWrapper<CommunityLikeDO>()
                        .eq(CommunityLikeDO::getUserId, currentUserId)
                        .eq(CommunityLikeDO::getTargetType, LikeTargetTypeEnum.BLOG.getCode())
                        .eq(CommunityLikeDO::getTargetId, blogId));
        return count > 0;
    }

    /**
     * 检查用户是否已购买该博客
     */
    private boolean checkPurchased(Long userId, Long blogId) {
        Long count = blogPurchaseMapper.selectCount(
                new LambdaQueryWrapper<BlogPurchaseDO>()
                        .eq(BlogPurchaseDO::getUserId, userId)
                        .eq(BlogPurchaseDO::getBlogId, blogId));
        return count > 0;
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
     * 将博客DO转换为BlogVO
     */
    private BlogVO toBlogVO(BlogPostDO blog, Long currentUserId) {
        SysUserDO author = userMapper.selectById(blog.getAuthorId());

        BlogVO vo = new BlogVO();
        vo.setId(blog.getId());
        vo.setAuthorId(blog.getAuthorId());
        vo.setAuthorName(author != null ? author.getNickname() : null);
        vo.setAuthorAvatar(author != null ? author.getAvatar() : null);
        vo.setTitle(blog.getTitle());
        vo.setSummary(blog.getSummary());
        vo.setCoverImage(blog.getCoverImage());
        vo.setCategory(blog.getCategory());
        vo.setTags(blog.getTags());
        vo.setPointsRequired(blog.getPointsRequired());
        vo.setViewCount(blog.getViewCount());
        vo.setLikeCount(blog.getLikeCount());
        vo.setTipTotal(blog.getTipTotal());
        vo.setLiked(checkLiked(currentUserId, blog.getId()));
        vo.setCreateTime(blog.getCreateTime());

        // 列表场景下购买状态
        boolean isAuthor = currentUserId != null && currentUserId.equals(blog.getAuthorId());
        if (isAuthor || blog.getPointsRequired() == null || blog.getPointsRequired() == 0) {
            vo.setPurchased(true);
        } else {
            vo.setPurchased(currentUserId != null && checkPurchased(currentUserId, blog.getId()));
        }
        return vo;
    }
}

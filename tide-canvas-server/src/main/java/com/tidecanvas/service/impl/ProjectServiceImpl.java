package com.tidecanvas.service.impl;

import cn.hutool.core.util.IdUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.ResultCode;
import com.tidecanvas.exception.BusinessException;
import com.tidecanvas.mapper.CanvasProjectMapper;
import com.tidecanvas.model.dto.CanvasSaveDTO;
import com.tidecanvas.model.dto.ProjectCreateDTO;
import com.tidecanvas.model.dto.ProjectUpdateDTO;
import com.tidecanvas.model.entity.CanvasProjectDO;
import com.tidecanvas.model.query.ProjectQuery;
import com.tidecanvas.model.vo.ProjectDetailVO;
import com.tidecanvas.model.vo.ProjectVO;
import com.tidecanvas.service.ProjectService;
import com.tidecanvas.service.TeamService;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.BeanUtils;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.security.SecureRandom;
import java.util.List;

@Service
@RequiredArgsConstructor
public class ProjectServiceImpl implements ProjectService {

    private final CanvasProjectMapper projectMapper;
    private final TeamService teamService;

    /** URL token 字符集，剔除易混淆字符（0/O/1/l/I） */
    private static final char[] TOKEN_ALPHABET =
            "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789".toCharArray();
    private static final SecureRandom TOKEN_RANDOM = new SecureRandom();
    private static final int TOKEN_LENGTH = 12;

    @Override
    public PageResult<ProjectVO> listProjects(Long userId, ProjectQuery query) {
        Page<CanvasProjectDO> page = new Page<>(query.getPageNum(), query.getPageSize());
        LambdaQueryWrapper<CanvasProjectDO> wrapper = new LambdaQueryWrapper<CanvasProjectDO>()
                .in(CanvasProjectDO::getUserId, teamService.getTeamMemberIds(userId)) // 团队共享项目
                .like(StringUtils.hasText(query.getKeyword()), CanvasProjectDO::getName, query.getKeyword())
                .eq(query.getStatus() != null, CanvasProjectDO::getStatus, query.getStatus())
                .orderByDesc(CanvasProjectDO::getUpdateTime);
        projectMapper.selectPage(page, wrapper);
        List<ProjectVO> records = page.getRecords().stream().map(this::toProjectVO).toList();
        return PageResult.of(records, page);
    }

    @Override
    public ProjectVO createProject(Long userId, ProjectCreateDTO dto) {
        CanvasProjectDO project = new CanvasProjectDO();
        project.setUserId(userId);
        project.setName(dto.getName());
        project.setDescription(dto.getDescription());
        project.setStatus(0);
        project.setIsPublic(0);
        project.setCanvasData("{}");
        project.setUrlToken(generateUrlToken());
        project.setDeleted(0);
        projectMapper.insert(project);
        return toProjectVO(project);
    }

    @Override
    public ProjectDetailVO getProject(Long userId, Long projectId) {
        CanvasProjectDO project = getAndCheck(userId, projectId);
        ProjectDetailVO vo = new ProjectDetailVO();
        BeanUtils.copyProperties(project, vo);
        vo.setIsPublic(project.getIsPublic() == 1);
        return vo;
    }

    @Override
    public ProjectDetailVO getProjectByToken(Long userId, String urlToken) {
        if (!StringUtils.hasText(urlToken)) {
            throw new BusinessException(ResultCode.NOT_FOUND, "项目不存在");
        }
        CanvasProjectDO project = projectMapper.selectOne(
                new LambdaQueryWrapper<CanvasProjectDO>().eq(CanvasProjectDO::getUrlToken, urlToken));
        if (project == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "项目不存在");
        }
        if (!teamService.getTeamMemberIds(userId).contains(project.getUserId())) {
            throw new BusinessException(ResultCode.FORBIDDEN, "无权访问该项目");
        }
        ProjectDetailVO vo = new ProjectDetailVO();
        BeanUtils.copyProperties(project, vo);
        vo.setIsPublic(project.getIsPublic() == 1);
        return vo;
    }

    @Override
    public ProjectVO updateProject(Long userId, Long projectId, ProjectUpdateDTO dto) {
        CanvasProjectDO project = getAndCheck(userId, projectId);
        if (StringUtils.hasText(dto.getName())) {
            project.setName(dto.getName());
        }
        if (dto.getDescription() != null) {
            project.setDescription(dto.getDescription());
        }
        if (dto.getStatus() != null) {
            project.setStatus(dto.getStatus());
        }
        if (dto.getIsPublic() != null) {
            project.setIsPublic(dto.getIsPublic() ? 1 : 0);
        }
        projectMapper.updateById(project);
        return toProjectVO(project);
    }

    @Override
    public void deleteProject(Long userId, Long projectId) {
        CanvasProjectDO project = projectMapper.selectById(projectId);
        if (project == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "项目不存在");
        }
        // 删除仅限所有者或团队管理员（成员可看/编辑共享项目，但不能删）
        if (!project.getUserId().equals(userId) && !teamService.isTeamAdminOf(userId, project.getUserId())) {
            throw new BusinessException(ResultCode.FORBIDDEN, "无权删除该项目");
        }
        projectMapper.deleteById(projectId);
    }

    @Override
    public void saveCanvas(Long userId, Long projectId, CanvasSaveDTO dto) {
        CanvasProjectDO project = getAndCheck(userId, projectId);
        project.setCanvasData(dto.getCanvasData());
        if (StringUtils.hasText(dto.getThumbnail())) {
            project.setThumbnail(dto.getThumbnail());
        }
        projectMapper.updateById(project);
    }

    @Override
    public String getCanvasData(Long userId, Long projectId) {
        CanvasProjectDO project = getAndCheck(userId, projectId);
        return project.getCanvasData();
    }

    @Override
    public String shareProject(Long userId, Long projectId) {
        CanvasProjectDO project = getAndCheck(userId, projectId);
        if (!StringUtils.hasText(project.getShareToken())) {
            project.setShareToken(IdUtil.fastSimpleUUID());
            projectMapper.updateById(project);
        }
        return project.getShareToken();
    }

    /** 取项目并校验访问权：本人或同团队成员（团队共享 → 成员可看/编辑；删除另在 deleteProject 单独限所有者/管理员） */
    private CanvasProjectDO getAndCheck(Long userId, Long projectId) {
        CanvasProjectDO project = projectMapper.selectById(projectId);
        if (project == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "项目不存在");
        }
        if (!teamService.getTeamMemberIds(userId).contains(project.getUserId())) {
            throw new BusinessException(ResultCode.FORBIDDEN, "无权访问该项目");
        }
        return project;
    }

    /** 生成不透明随机短 token，并校验唯一性（极小概率冲突时重试） */
    private String generateUrlToken() {
        for (int attempt = 0; attempt < 5; attempt++) {
            StringBuilder sb = new StringBuilder(TOKEN_LENGTH);
            for (int i = 0; i < TOKEN_LENGTH; i++) {
                sb.append(TOKEN_ALPHABET[TOKEN_RANDOM.nextInt(TOKEN_ALPHABET.length)]);
            }
            String token = sb.toString();
            Long count = projectMapper.selectCount(
                    new LambdaQueryWrapper<CanvasProjectDO>().eq(CanvasProjectDO::getUrlToken, token));
            if (count == null || count == 0) {
                return token;
            }
        }
        // 连续冲突的兜底：退化为更长的唯一串
        return cn.hutool.core.util.IdUtil.fastSimpleUUID().substring(0, 16);
    }

    private ProjectVO toProjectVO(CanvasProjectDO project) {
        ProjectVO vo = new ProjectVO();
        BeanUtils.copyProperties(project, vo);
        vo.setOwnerId(project.getUserId()); // 字段名不同，需显式设置
        vo.setIsPublic(project.getIsPublic() == 1);
        return vo;
    }
}

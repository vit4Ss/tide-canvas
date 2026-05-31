package com.tidecanvas.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.ResultCode;
import com.tidecanvas.enums.AiTaskStatusEnum;
import com.tidecanvas.enums.PointsTransactionTypeEnum;
import com.tidecanvas.exception.BusinessException;
import com.tidecanvas.mapper.AiHandlerConfigMapper;
import com.tidecanvas.mapper.AiModelMapper;
import com.tidecanvas.mapper.AiTaskMapper;
import com.tidecanvas.model.dto.AiGenerateDTO;
import com.tidecanvas.model.entity.AiHandlerConfigDO;
import com.tidecanvas.model.entity.AiModelDO;
import com.tidecanvas.model.entity.AiTaskDO;
import com.tidecanvas.model.query.AiTaskQuery;
import com.tidecanvas.model.vo.AiHandlerVO;
import com.tidecanvas.model.vo.AiModelVO;
import com.tidecanvas.model.vo.AiTaskVO;
import com.tidecanvas.service.AiService;
import com.tidecanvas.service.PointsService;
import com.tidecanvas.service.ai.AiHandler;
import com.tidecanvas.service.ai.AiHandlerRegistry;
import com.tidecanvas.service.ai.AiHandlerResult;
import com.tidecanvas.service.ai.AiTaskRunner;
import com.tidecanvas.service.ai.GenerationLogContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.util.List;

/**
 * AI服务实现类
 *
 * @author tidecanvas
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AiServiceImpl implements AiService {

    private final AiTaskMapper taskMapper;
    private final AiModelMapper modelMapper;
    private final AiHandlerConfigMapper handlerConfigMapper;
    private final AiHandlerRegistry handlerRegistry;
    private final ObjectMapper objectMapper;
    private final PointsService pointsService;
    private final AiTaskRunner aiTaskRunner;

    /** 默认积分消耗 */
    private static final int DEFAULT_POINT_COST = 10;

    @Override
    public AiTaskVO generate(Long userId, AiGenerateDTO dto) {
        AiHandler handler = handlerRegistry.getHandler(dto.getHandler());
        handler.validate(dto.getInput());

        // 积分消耗：优先按「画质×清晰度」差异化定价，其次模型固定价 / Handler 配置 / 默认值
        int pointCost = resolvePointCost(dto.getModelId(), dto.getHandler(), dto.getInput());

        // 创建任务记录
        AiTaskDO task = new AiTaskDO();
        task.setUserId(userId);
        task.setProjectId(dto.getProjectId());
        task.setHandlerName(dto.getHandler());
        task.setStatus(AiTaskStatusEnum.PROCESSING.getCode());
        task.setProgress(0);
        task.setDeleted(0);
        try {
            task.setInputParams(objectMapper.writeValueAsString(dto.getInput()));
        } catch (Exception e) {
            task.setInputParams("{}");
        }
        taskMapper.insert(task);

        // 使用积分系统扣减积分（替代原有apiQuota扣减）
        pointsService.deductPoints(userId, pointCost, PointsTransactionTypeEnum.AI_CONSUME,
                task.getId(), "AI生成: " + dto.getHandler());

        if (handler.isAsync()) {
            // 通过独立 Bean 调用，确保 @Async 经 Spring 代理真正异步执行（不能自调用）
            aiTaskRunner.run(task.getId(), handler, dto.getModelId(), dto.getInput(), pointCost);
        } else {
            executeSync(task, handler, dto.getModelId(), dto.getInput(), pointCost);
        }

        return toTaskVO(task);
    }

    private void executeSync(AiTaskDO task, AiHandler handler, String modelId, java.util.Map<String, Object> input, int pointCost) {
        GenerationLogContext.set(task.getId(), task.getUserId(), task.getProjectId(), task.getHandlerName());
        boolean failed = false;
        try {
            AiHandlerResult result = handler.execute(modelId, input);
            failed = !result.isSuccess();
            task.setStatus(result.isSuccess() ? AiTaskStatusEnum.SUCCESS.getCode() : AiTaskStatusEnum.FAILED.getCode());
            task.setResultUrl(result.getResultUrl());
            task.setResultMeta(result.getResultMeta());
            task.setErrorMsg(result.getErrorMsg());
            task.setProgress(100);
            task.setCompleteTime(LocalDateTime.now());
        } catch (Exception e) {
            failed = true;
            task.setStatus(AiTaskStatusEnum.FAILED.getCode());
            task.setErrorMsg(e.getMessage());
            task.setCompleteTime(LocalDateTime.now());
        } finally {
            GenerationLogContext.clear();
        }
        taskMapper.updateById(task);
        if (failed) {
            refundPoints(task.getUserId(), pointCost, task.getId());
        }
    }

    /**
     * 解析积分消耗：优先按所选模型价格（每个模型价格不同），其次按 Handler(能力) 配置，最后默认值
     */
    private int resolvePointCost(String modelId, String handlerName, java.util.Map<String, Object> input) {
        if (StringUtils.hasText(modelId) && !"default".equals(modelId)) {
            AiModelDO model = modelMapper.selectOne(
                    new LambdaQueryWrapper<AiModelDO>().eq(AiModelDO::getModelId, modelId));
            if (model != null) {
                // 1) 画质×清晰度差异化定价（config.pricing[quality][clarity]）
                Integer matrix = pricingFromConfig(model.getConfig(), input);
                if (matrix != null) {
                    return matrix;
                }
                // 2) 模型固定积分
                if (model.getPointCost() != null) {
                    return model.getPointCost();
                }
            }
        }
        AiHandlerConfigDO handlerConfig = handlerConfigMapper.selectOne(
                new LambdaQueryWrapper<AiHandlerConfigDO>().eq(AiHandlerConfigDO::getHandlerName, handlerName));
        if (handlerConfig != null && handlerConfig.getPointCost() != null) {
            return handlerConfig.getPointCost();
        }
        return DEFAULT_POINT_COST;
    }

    /** 从模型 config.pricing 按 input 的 quality/clarity 取差异化积分；未配置/未命中返回 null */
    private Integer pricingFromConfig(String config, java.util.Map<String, Object> input) {
        if (!StringUtils.hasText(config) || input == null) {
            return null;
        }
        try {
            JsonNode pricing = objectMapper.readTree(config).path("pricing");
            if (!pricing.isObject()) {
                return null;
            }
            String quality = String.valueOf(input.getOrDefault("quality", ""));
            String clarity = String.valueOf(input.getOrDefault("clarity", ""));
            JsonNode cell = pricing.path(quality).path(clarity);
            if (cell.isNumber()) {
                return cell.asInt();
            }
        } catch (Exception e) {
            log.warn("解析模型差异化定价失败: {}", e.getMessage());
        }
        return null;
    }

    /**
     * 生成失败时返还已扣减的积分
     */
    private void refundPoints(Long userId, int pointCost, Long taskId) {
        if (pointCost <= 0) {
            return;
        }
        try {
            pointsService.addPoints(userId, pointCost, PointsTransactionTypeEnum.AI_REFUND,
                    taskId, "AI生成失败返还");
            log.info("AI生成失败已返还积分: userId={}, taskId={}, points={}", userId, taskId, pointCost);
        } catch (Exception e) {
            log.error("返还积分失败: taskId={}", taskId, e);
        }
    }

    @Override
    public AiTaskVO getTask(Long userId, Long taskId) {
        AiTaskDO task = taskMapper.selectById(taskId);
        if (task == null || !task.getUserId().equals(userId)) {
            throw new BusinessException(ResultCode.NOT_FOUND, "任务不存在");
        }
        return toTaskVO(task);
    }

    @Override
    public void cancelTask(Long userId, Long taskId) {
        AiTaskDO task = taskMapper.selectById(taskId);
        if (task == null || !task.getUserId().equals(userId)) {
            throw new BusinessException(ResultCode.NOT_FOUND, "任务不存在");
        }
        if (task.getStatus() == AiTaskStatusEnum.PROCESSING.getCode()) {
            task.setStatus(AiTaskStatusEnum.CANCELLED.getCode());
            task.setCompleteTime(LocalDateTime.now());
            taskMapper.updateById(task);
        }
    }

    @Override
    public PageResult<AiTaskVO> listTasks(Long userId, AiTaskQuery query) {
        Page<AiTaskDO> page = new Page<>(query.getPageNum(), query.getPageSize());
        LambdaQueryWrapper<AiTaskDO> wrapper = new LambdaQueryWrapper<AiTaskDO>()
                .eq(AiTaskDO::getUserId, userId)
                .eq(StringUtils.hasText(query.getHandler()), AiTaskDO::getHandlerName, query.getHandler())
                .eq(query.getStatus() != null, AiTaskDO::getStatus, query.getStatus())
                .eq(query.getProjectId() != null, AiTaskDO::getProjectId, query.getProjectId())
                .orderByDesc(AiTaskDO::getCreateTime);
        taskMapper.selectPage(page, wrapper);
        List<AiTaskVO> records = page.getRecords().stream().map(this::toTaskVO).toList();
        return PageResult.of(records, page);
    }

    @Override
    public List<AiModelVO> listModels() {
        List<AiModelDO> models = modelMapper.selectList(
                new LambdaQueryWrapper<AiModelDO>().eq(AiModelDO::getStatus, 1));
        return models.stream().map(m -> {
            AiModelVO vo = new AiModelVO();
            BeanUtils.copyProperties(m, vo);
            return vo;
        }).toList();
    }

    @Override
    public List<AiHandlerVO> listHandlers() {
        List<AiHandlerConfigDO> configs = handlerConfigMapper.selectList(
                new LambdaQueryWrapper<AiHandlerConfigDO>().eq(AiHandlerConfigDO::getStatus, 1)
                        .orderByAsc(AiHandlerConfigDO::getSortOrder));
        return configs.stream().map(c -> {
            AiHandlerVO vo = new AiHandlerVO();
            BeanUtils.copyProperties(c, vo);
            return vo;
        }).toList();
    }

    private AiTaskVO toTaskVO(AiTaskDO task) {
        AiTaskVO vo = new AiTaskVO();
        BeanUtils.copyProperties(task, vo);
        return vo;
    }
}

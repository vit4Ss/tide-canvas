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
import com.tidecanvas.mapper.AiGenerationLogMapper;
import com.tidecanvas.mapper.AiHandlerConfigMapper;
import com.tidecanvas.mapper.AiModelMapper;
import com.tidecanvas.mapper.AiTaskMapper;
import com.tidecanvas.mapper.CanvasProjectMapper;
import com.tidecanvas.model.dto.AiGenerateDTO;
import com.tidecanvas.model.entity.AiGenerationLogDO;
import com.tidecanvas.model.entity.AiHandlerConfigDO;
import com.tidecanvas.model.entity.AiModelDO;
import com.tidecanvas.model.entity.AiTaskDO;
import com.tidecanvas.model.entity.CanvasProjectDO;
import com.tidecanvas.model.query.AiTaskQuery;
import com.tidecanvas.model.vo.AiHandlerVO;
import com.tidecanvas.model.vo.AiModelVO;
import com.tidecanvas.model.vo.AiTaskVO;
import com.tidecanvas.service.AiService;
import com.tidecanvas.service.PointsService;
import com.tidecanvas.service.TeamService;
import com.tidecanvas.service.ai.AiHandler;
import com.tidecanvas.service.ai.AiHandlerRegistry;
import com.tidecanvas.service.ai.AiHandlerResult;
import com.tidecanvas.service.ai.AiTaskRunner;
import com.tidecanvas.service.ai.GenerationLogContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class AiServiceImpl implements AiService {

    private final AiTaskMapper taskMapper;
    private final AiModelMapper modelMapper;
    private final AiHandlerConfigMapper handlerConfigMapper;
    private final AiGenerationLogMapper logMapper;
    private final CanvasProjectMapper projectMapper;
    private final AiHandlerRegistry handlerRegistry;
    private final ObjectMapper objectMapper;
    private final PointsService pointsService;
    private final TeamService teamService;
    private final AiTaskRunner aiTaskRunner;
    private final TransactionTemplate transactionTemplate;

    private static final java.math.BigDecimal DEFAULT_POINT_COST = java.math.BigDecimal.TEN;

    @Override
    public AiTaskVO generate(Long userId, AiGenerateDTO dto) {
        assertProjectOwned(userId, dto.getProjectId());
        AiHandler handler = handlerRegistry.getHandler(dto.getHandler());
        handler.validate(dto.getInput());

        AiModelDO selectedModel = findModel(dto.getModelId());
        // 单价支持小数（Runware 等按 USD 计价的供应商换算后常为小数积分），
        // 总价 = 单价 × 张数 × 团队系数，最后一步向上取整为整数积分（积分账本为整数，且不收 0 积分单）。
        java.math.BigDecimal unitCost = resolvePointCost(selectedModel, dto.getHandler(), dto.getInput());
        java.math.BigDecimal teamFactor = teamService.getPriceFactor(userId);
        java.math.BigDecimal total = unitCost
                .multiply(java.math.BigDecimal.valueOf(batchCountOf(dto.getInput())))
                .multiply(teamFactor);
        // 须在 lambda 之前算出最终值（pointCost 被 lambda 捕获，需 effectively final）。
        int pointCost = total.signum() <= 0 ? 0 : total.setScale(0, java.math.RoundingMode.CEILING).intValue();

        AiTaskDO task = transactionTemplate.execute(status -> {
            AiTaskDO created = new AiTaskDO();
            created.setUserId(userId);
            created.setProjectId(dto.getProjectId());
            created.setHandlerName(dto.getHandler());
            created.setModelId(selectedModel == null ? null : selectedModel.getId());
            created.setStatus(AiTaskStatusEnum.PROCESSING.getCode());
            created.setProgress(0);
            created.setCost(java.math.BigDecimal.valueOf(pointCost));
            created.setDeleted(0);
            try {
                created.setInputParams(objectMapper.writeValueAsString(dto.getInput()));
            } catch (Exception e) {
                created.setInputParams("{}");
            }
            taskMapper.insert(created);

            if (pointCost > 0) {
                pointsService.deductPoints(userId, pointCost, PointsTransactionTypeEnum.AI_CONSUME,
                        created.getId(), "AI生成: " + dto.getHandler());
            }
            return created;
        });

        if (handler.isAsync()) {
            aiTaskRunner.run(task.getId(), handler, dto.getModelId(), dto.getInput(), pointCost);
        } else {
            executeSync(task, handler, dto.getModelId(), dto.getInput(), pointCost);
        }

        return toTaskVO(task);
    }

    private void assertProjectOwned(Long userId, Long projectId) {
        if (projectId == null) {
            return;
        }
        // 团队共享：成员可在队友的项目内生成（计费仍扣本人积分）
        Long count = projectMapper.selectCount(new LambdaQueryWrapper<CanvasProjectDO>()
                .eq(CanvasProjectDO::getId, projectId)
                .in(CanvasProjectDO::getUserId, teamService.getTeamMemberIds(userId)));
        if (count == null || count == 0) {
            throw new BusinessException(ResultCode.FORBIDDEN, "无权在该项目下创建任务");
        }
    }

    private void executeSync(AiTaskDO task, AiHandler handler, String modelId, Map<String, Object> input, int pointCost) {
        GenerationLogContext.set(task.getId(), task.getUserId(), task.getProjectId(), task.getHandlerName());
        long startMs = System.currentTimeMillis();
        boolean failed = false;
        String resultUrl = null;
        String errorMsg = null;
        try {
            AiHandlerResult result = handler.execute(modelId, input);
            failed = !result.isSuccess();
            resultUrl = result.getResultUrl();
            errorMsg = result.getErrorMsg();
            task.setStatus(result.isSuccess() ? AiTaskStatusEnum.SUCCESS.getCode() : AiTaskStatusEnum.FAILED.getCode());
            task.setResultUrl(resultUrl);
            task.setResultMeta(result.getResultMeta());
            task.setErrorMsg(errorMsg);
            task.setProgress(100);
            task.setCompleteTime(LocalDateTime.now());
        } catch (Exception e) {
            failed = true;
            errorMsg = e.getMessage();
            task.setStatus(AiTaskStatusEnum.FAILED.getCode());
            task.setErrorMsg(errorMsg);
            task.setCompleteTime(LocalDateTime.now());
        } finally {
            if (!GenerationLogContext.isRecorded()) {
                recordSummarySyncLog(task, !failed, resultUrl, errorMsg, startMs);
            }
            GenerationLogContext.clear();
        }
        taskMapper.updateById(task);
        if (failed) {
            refundPoints(task.getUserId(), pointCost, task.getId());
        }
    }

    private void recordSummarySyncLog(AiTaskDO task, boolean success, String resultUrl, String errorMsg, long startMs) {
        try {
            AiGenerationLogDO lg = new AiGenerationLogDO();
            lg.setTaskId(task.getId());
            lg.setUserId(task.getUserId());
            lg.setProjectId(task.getProjectId());
            lg.setHandlerName(task.getHandlerName());
            lg.setOperationType("ai_generate");
            lg.setSuccess(success ? 1 : 0);
            lg.setResultUrl(StringUtils.hasText(resultUrl) ? resultUrl : null);
            lg.setErrorMsg(StringUtils.hasText(errorMsg) ? errorMsg : null);
            lg.setDurationMs(System.currentTimeMillis() - startMs);
            lg.setCreateTime(LocalDateTime.now());
            logMapper.insert(lg);
        } catch (Exception e) {
            log.warn("Failed to record sync AI log: taskId={}", task.getId(), e);
        }
    }

    private AiModelDO findModel(String modelId) {
        if (!StringUtils.hasText(modelId) || "default".equals(modelId)) {
            return null;
        }
        return modelMapper.selectOne(new LambdaQueryWrapper<AiModelDO>().eq(AiModelDO::getModelId, modelId));
    }

    private java.math.BigDecimal resolvePointCost(AiModelDO model, String handlerName, Map<String, Object> input) {
        if (model != null) {
            java.math.BigDecimal matrix = pricingFromConfig(model.getConfig(), input, model.getType());
            if (matrix != null) {
                return matrix;
            }
            if (model.getPointCost() != null) {
                return model.getPointCost();
            }
        }
        AiHandlerConfigDO handlerConfig = handlerConfigMapper.selectOne(
                new LambdaQueryWrapper<AiHandlerConfigDO>().eq(AiHandlerConfigDO::getHandlerName, handlerName));
        if (handlerConfig != null && handlerConfig.getPointCost() != null) {
            return java.math.BigDecimal.valueOf(handlerConfig.getPointCost());
        }
        return DEFAULT_POINT_COST;
    }

    private int batchCountOf(Map<String, Object> input) {
        if (input == null) {
            return 1;
        }
        Object bc = input.getOrDefault("batchCount", input.get("n"));
        if (bc == null) {
            return 1;
        }
        try {
            return Math.max(1, Math.min(4, Integer.parseInt(String.valueOf(bc).trim())));
        } catch (NumberFormatException e) {
            return 1;
        }
    }

    private java.math.BigDecimal pricingFromConfig(String config, Map<String, Object> input, String modelType) {
        if (!StringUtils.hasText(config) || input == null) {
            return null;
        }
        try {
            JsonNode pricing = objectMapper.readTree(config).path("pricing");
            if (!pricing.isObject()) {
                return null;
            }
            String rowKey;
            String colKey;
            if ("video".equals(modelType)) {
                rowKey = String.valueOf(input.getOrDefault("resolution", ""));
                colKey = String.valueOf(input.getOrDefault("duration", ""));
            } else {
                rowKey = String.valueOf(input.getOrDefault("quality", ""));
                colKey = String.valueOf(input.getOrDefault("clarity", ""));
            }
            JsonNode cell = pricing.path(rowKey).path(colKey);
            if (cell.isNumber()) {
                return cell.decimalValue();
            }
        } catch (Exception e) {
            log.warn("Failed to parse AI pricing config: {}", e.getMessage());
        }
        return null;
    }

    private void refundPoints(Long userId, int pointCost, Long taskId) {
        if (pointCost <= 0) {
            return;
        }
        try {
            pointsService.addPoints(userId, pointCost, PointsTransactionTypeEnum.AI_REFUND,
                    taskId, "AI生成失败返还");
            log.info("AI points refunded: userId={}, taskId={}, points={}", userId, taskId, pointCost);
        } catch (Exception e) {
            log.error("Failed to refund AI points: taskId={}", taskId, e);
        }
    }

    @Override
    public AiTaskVO getTask(Long userId, Long taskId) {
        AiTaskDO task = taskMapper.selectById(taskId);
        // 团队共享：成员可查看/轮询队友任务结果
        if (task == null || !teamService.getTeamMemberIds(userId).contains(task.getUserId())) {
            throw new BusinessException(ResultCode.NOT_FOUND, "任务不存在");
        }
        return toTaskVO(task);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void cancelTask(Long userId, Long taskId) {
        AiTaskDO task = taskMapper.selectById(taskId);
        if (task == null || !task.getUserId().equals(userId)) {
            throw new BusinessException(ResultCode.NOT_FOUND, "任务不存在");
        }
        int updated = taskMapper.cancelIfProcessing(
                taskId, userId, AiTaskStatusEnum.PROCESSING.getCode(), AiTaskStatusEnum.CANCELLED.getCode());
        if (updated > 0) {
            int pointCost = task.getCost() == null ? 0 : task.getCost().intValue();
            refundPoints(userId, pointCost, taskId);
        }
    }

    @Override
    public PageResult<AiTaskVO> listTasks(Long userId, AiTaskQuery query) {
        Page<AiTaskDO> page = new Page<>(query.getPageNum(), query.getPageSize());
        LambdaQueryWrapper<AiTaskDO> wrapper = new LambdaQueryWrapper<AiTaskDO>()
                .in(AiTaskDO::getUserId, teamService.getTeamMemberIds(userId))
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
            // 上游成本价为商业敏感信息，仅管理端可见，用户侧脱敏
            vo.setCostPerCall(null);
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

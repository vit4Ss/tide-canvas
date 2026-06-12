package com.tidecanvas.controller.admin;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.Result;
import com.tidecanvas.common.ResultCode;
import com.tidecanvas.exception.BusinessException;
import com.tidecanvas.mapper.AiGenerationLogMapper;
import com.tidecanvas.mapper.AiHandlerConfigMapper;
import com.tidecanvas.mapper.AiModelMapper;
import com.tidecanvas.mapper.AiProviderMapper;
import com.tidecanvas.mapper.AiTaskMapper;
import com.tidecanvas.mapper.CanvasProjectMapper;
import com.tidecanvas.mapper.SysUserMapper;
import com.tidecanvas.model.entity.AiGenerationLogDO;
import com.tidecanvas.model.entity.AiHandlerConfigDO;
import com.tidecanvas.model.entity.AiModelDO;
import com.tidecanvas.model.entity.AiProviderDO;
import com.tidecanvas.model.entity.AiTaskDO;
import com.tidecanvas.model.entity.CanvasProjectDO;
import com.tidecanvas.model.entity.SysUserDO;
import com.tidecanvas.model.query.AiGenerationLogQuery;
import com.tidecanvas.model.vo.AiGenerationLogVO;
import com.tidecanvas.model.vo.AiHandlerVO;
import com.tidecanvas.model.vo.AiModelVO;
import com.tidecanvas.model.vo.AiProviderVO;
import com.tidecanvas.service.ai.AiMediaGateway;
import com.tidecanvas.service.ai.RunwareClient;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.BeanUtils;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClient;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Tag(name = "管理后台-AI管理")
@RestController
@RequestMapping("/api/admin/ai")
@RequiredArgsConstructor
public class AdminAiController {

    private final AiProviderMapper providerMapper;
    private final AiModelMapper modelMapper;
    private final AiHandlerConfigMapper handlerConfigMapper;
    private final AiGenerationLogMapper logMapper;
    private final SysUserMapper userMapper;
    private final CanvasProjectMapper projectMapper;
    private final AiTaskMapper taskMapper;
    private final ObjectMapper objectMapper;
    private final RunwareClient runwareClient;

    // ========== Provider ==========

    @Operation(summary = "供应商列表")
    @GetMapping("/providers")
    public Result<List<AiProviderVO>> listProviders() {
        List<AiProviderDO> list = providerMapper.selectList(
                new LambdaQueryWrapper<AiProviderDO>().orderByAsc(AiProviderDO::getPriority));
        return Result.success(list.stream().map(p -> {
            AiProviderVO vo = new AiProviderVO();
            BeanUtils.copyProperties(p, vo);
            // 脱敏：不返回真实 API Key，仅保留前4位+后4位用于识别
            if (vo.getApiKey() != null && vo.getApiKey().length() > 8) {
                vo.setApiKey(vo.getApiKey().substring(0, 4) + "****" + vo.getApiKey().substring(vo.getApiKey().length() - 4));
            } else if (vo.getApiKey() != null) {
                vo.setApiKey("****");
            }
            return vo;
        }).toList());
    }

    @Operation(summary = "新增供应商")
    @PostMapping("/providers")
    public Result<AiProviderVO> createProvider(@RequestBody Map<String, Object> body) {
        AiProviderDO provider = new AiProviderDO();
        provider.setName((String) body.get("name"));
        provider.setProviderType((String) body.get("providerType"));
        provider.setApiKey((String) body.get("apiKey"));
        provider.setBaseUrl((String) body.get("baseUrl"));
        provider.setStatus(1);
        provider.setPriority(body.containsKey("priority") ? (Integer) body.get("priority") : 0);
        provider.setRateLimit(body.containsKey("rateLimit") ? (Integer) body.get("rateLimit") : 60);
        provider.setDeleted(0);
        providerMapper.insert(provider);
        AiProviderVO vo = new AiProviderVO();
        BeanUtils.copyProperties(provider, vo);
        return Result.success(vo);
    }

    @Operation(summary = "从供应商拉取可用模型列表（runware 走 modelSearch，可带 search 关键词）")
    @GetMapping("/providers/{id}/models")
    public Result<List<String>> listRemoteModels(@PathVariable Long id,
                                                 @RequestParam(required = false) String search) {
        AiProviderDO provider = providerMapper.selectById(id);
        if (provider == null) {
            throw new BusinessException(ResultCode.NOT_FOUND);
        }
        if (!StringUtils.hasText(provider.getBaseUrl()) || !StringUtils.hasText(provider.getApiKey())) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "供应商未配置 baseUrl 或 apiKey");
        }
        // Runware 无 OpenAI 风格 /models，走原生 modelSearch（AIR 标识，name 拼进展示文本由前端截取）
        if (AiMediaGateway.isRunware(provider)) {
            try {
                return Result.success(runwareClient.searchModels(provider, search).stream()
                        .map(m -> m.get("air"))
                        .sorted(String::compareToIgnoreCase)
                        .toList());
            } catch (Exception e) {
                throw new BusinessException(ResultCode.SERVER_ERROR, "拉取模型失败：" + e.getMessage());
            }
        }
        String endpoint = provider.getBaseUrl().replaceAll("/+$", "") + "/models";
        try {
            SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
            factory.setConnectTimeout(10_000);
            factory.setReadTimeout(20_000);
            String resp = RestClient.builder().requestFactory(factory).build()
                    .get()
                    .uri(endpoint)
                    .header("Authorization", "Bearer " + provider.getApiKey())
                    .retrieve()
                    .body(String.class);
            JsonNode root = objectMapper.readTree(resp);
            // 兼容 OpenAI 风格 { "data": [ {"id": "..."} ] } 与直接返回数组
            JsonNode data = root.isArray() ? root : root.path("data");
            List<String> ids = new ArrayList<>();
            if (data.isArray()) {
                for (JsonNode m : data) {
                    String mid = m.path("id").asText(null);
                    if (StringUtils.hasText(mid)) {
                        ids.add(mid);
                    }
                }
            }
            ids.sort(String::compareToIgnoreCase);
            return Result.success(ids);
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            throw new BusinessException(ResultCode.SERVER_ERROR, "拉取模型失败：" + e.getMessage());
        }
    }

    @Operation(summary = "更新供应商")
    @PutMapping("/providers/{id}")
    public Result<Void> updateProvider(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        AiProviderDO provider = providerMapper.selectById(id);
        if (provider == null) {
            throw new BusinessException(ResultCode.NOT_FOUND);
        }
        if (body.containsKey("name")) {
            provider.setName((String) body.get("name"));
        }
        if (body.containsKey("providerType")) {
            provider.setProviderType((String) body.get("providerType"));
        }
        if (body.containsKey("apiKey")) {
            provider.setApiKey((String) body.get("apiKey"));
        }
        if (body.containsKey("baseUrl")) {
            provider.setBaseUrl((String) body.get("baseUrl"));
        }
        if (body.containsKey("status")) {
            provider.setStatus((Integer) body.get("status"));
        }
        if (body.containsKey("priority")) {
            provider.setPriority((Integer) body.get("priority"));
        }
        providerMapper.updateById(provider);
        return Result.success();
    }

    @Operation(summary = "删除供应商")
    @DeleteMapping("/providers/{id}")
    public Result<Void> deleteProvider(@PathVariable Long id) {
        providerMapper.deleteById(id);
        return Result.success();
    }

    // ========== Model ==========

    @Operation(summary = "模型列表")
    @GetMapping("/models")
    public Result<List<AiModelVO>> listModels() {
        List<AiModelDO> list = modelMapper.selectList(null);
        Map<Long, String> providerNames = providerMapper.selectList(null).stream()
                .collect(Collectors.toMap(AiProviderDO::getId, AiProviderDO::getName, (a, b) -> a));
        return Result.success(list.stream().map(m -> {
            AiModelVO vo = new AiModelVO();
            BeanUtils.copyProperties(m, vo);
            if (m.getProviderId() != null) {
                vo.setProviderName(providerNames.get(m.getProviderId()));
            }
            return vo;
        }).toList());
    }

    @Operation(summary = "新增模型")
    @PostMapping("/models")
    public Result<AiModelVO> createModel(@RequestBody Map<String, Object> body) {
        AiModelDO model = new AiModelDO();
        model.setProviderId(Long.valueOf(body.get("providerId").toString()));
        model.setName((String) body.get("name"));
        model.setModelId((String) body.get("modelId"));
        model.setType((String) body.get("type"));
        if (body.containsKey("icon")) {
            model.setIcon((String) body.get("icon"));
        }
        if (body.containsKey("config") && body.get("config") != null) {
            model.setConfig(body.get("config").toString());
        }
        if (body.containsKey("pointCost")) {
            model.setPointCost(new java.math.BigDecimal(body.get("pointCost").toString()));
        }
        if (body.containsKey("costPerCall") && body.get("costPerCall") != null) {
            model.setCostPerCall(new java.math.BigDecimal(body.get("costPerCall").toString()));
        }
        model.setStatus(1);
        model.setDeleted(0);
        modelMapper.insert(model);
        AiModelVO vo = new AiModelVO();
        BeanUtils.copyProperties(model, vo);
        return Result.success(vo);
    }

    @Operation(summary = "更新模型")
    @PutMapping("/models/{id}")
    public Result<Void> updateModel(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        AiModelDO model = modelMapper.selectById(id);
        if (model == null) {
            throw new BusinessException(ResultCode.NOT_FOUND);
        }
        if (body.containsKey("name")) {
            model.setName((String) body.get("name"));
        }
        if (body.containsKey("modelId")) {
            model.setModelId((String) body.get("modelId"));
        }
        if (body.containsKey("type")) {
            model.setType((String) body.get("type"));
        }
        if (body.containsKey("icon")) {
            model.setIcon((String) body.get("icon"));
        }
        if (body.containsKey("config") && body.get("config") != null) {
            model.setConfig(body.get("config").toString());
        }
        if (body.containsKey("pointCost")) {
            model.setPointCost(new java.math.BigDecimal(body.get("pointCost").toString()));
        }
        if (body.containsKey("costPerCall") && body.get("costPerCall") != null) {
            model.setCostPerCall(new java.math.BigDecimal(body.get("costPerCall").toString()));
        }
        if (body.containsKey("providerId")) {
            model.setProviderId(Long.valueOf(body.get("providerId").toString()));
        }
        if (body.containsKey("status")) {
            model.setStatus((Integer) body.get("status"));
        }
        modelMapper.updateById(model);
        return Result.success();
    }

    @Operation(summary = "删除模型")
    @DeleteMapping("/models/{id}")
    public Result<Void> deleteModel(@PathVariable Long id) {
        modelMapper.deleteById(id);
        return Result.success();
    }

    // ========== Handler ==========

    @Operation(summary = "Handler列表")
    @GetMapping("/handlers")
    public Result<List<AiHandlerVO>> listHandlers() {
        List<AiHandlerConfigDO> list = handlerConfigMapper.selectList(
                new LambdaQueryWrapper<AiHandlerConfigDO>().orderByAsc(AiHandlerConfigDO::getSortOrder));
        return Result.success(list.stream().map(h -> {
            AiHandlerVO vo = new AiHandlerVO();
            BeanUtils.copyProperties(h, vo);
            return vo;
        }).toList());
    }

    @Operation(summary = "更新Handler配置")
    @PutMapping("/handlers/{name}")
    public Result<Void> updateHandler(@PathVariable String name, @RequestBody Map<String, Object> body) {
        AiHandlerConfigDO config = handlerConfigMapper.selectOne(
                new LambdaQueryWrapper<AiHandlerConfigDO>().eq(AiHandlerConfigDO::getHandlerName, name));
        if (config == null) {
            throw new BusinessException(ResultCode.HANDLER_NOT_FOUND);
        }
        if (body.containsKey("status")) {
            config.setStatus((Integer) body.get("status"));
        }
        if (body.containsKey("defaultModelId")) {
            config.setDefaultModelId(Long.valueOf(body.get("defaultModelId").toString()));
        }
        if (body.containsKey("pointCost")) {
            config.setPointCost(Integer.valueOf(body.get("pointCost").toString()));
        }
        handlerConfigMapper.updateById(config);
        return Result.success();
    }

    // ========== 生成日志 ==========

    @Operation(summary = "操作日志列表")
    @GetMapping("/logs")
    public Result<PageResult<AiGenerationLogVO>> listLogs(AiGenerationLogQuery query) {
        Page<AiGenerationLogDO> page = new Page<>(query.getPageNum(), query.getPageSize());
        logMapper.selectPage(page, logFilter(query).orderByDesc("id"));
        List<AiGenerationLogVO> records = page.getRecords().stream().map(this::toLogVO).collect(Collectors.toList());
        enrich(records);
        return Result.success(PageResult.of(records, page));
    }

    @Operation(summary = "操作日志上游成本汇总(USD)：按当前筛选条件统计全部匹配记录")
    @GetMapping("/logs/cost-sum")
    public Result<java.math.BigDecimal> logsCostSum(AiGenerationLogQuery query) {
        List<Object> rows = logMapper.selectObjs(logFilter(query).select("COALESCE(SUM(cost),0)"));
        Object v = rows.isEmpty() ? null : rows.get(0);
        return Result.success(v == null ? java.math.BigDecimal.ZERO : new java.math.BigDecimal(v.toString()));
    }

    /** 构建操作日志查询条件（列表与成本汇总共用，保证两处筛选完全一致） */
    private com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<AiGenerationLogDO> logFilter(AiGenerationLogQuery query) {
        return new com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<AiGenerationLogDO>()
                .eq(query.getTaskId() != null, "task_id", query.getTaskId())
                .eq(query.getUserId() != null, "user_id", query.getUserId())
                .eq(query.getProjectId() != null, "project_id", query.getProjectId())
                .eq(StringUtils.hasText(query.getHandlerName()), "handler_name", query.getHandlerName())
                .eq(StringUtils.hasText(query.getOperationType()), "operation_type", query.getOperationType())
                .eq(query.getSuccess() != null, "success", query.getSuccess());
    }

    @Operation(summary = "操作日志详情")
    @GetMapping("/logs/{id}")
    public Result<AiGenerationLogVO> getLog(@PathVariable Long id) {
        AiGenerationLogDO logDO = logMapper.selectById(id);
        if (logDO == null) {
            throw new BusinessException(ResultCode.NOT_FOUND);
        }
        List<AiGenerationLogVO> single = new ArrayList<>(List.of(toLogVO(logDO)));
        enrich(single);
        AiGenerationLogVO vo = single.get(0);
        // 回填用户输入参数,与上游请求体对照排查(前端→后端 vs 后端→供应商)
        if (logDO.getTaskId() != null) {
            AiTaskDO task = taskMapper.selectById(logDO.getTaskId());
            if (task != null) {
                vo.setInputParams(task.getInputParams());
            }
        }
        return Result.success(vo);
    }

    private AiGenerationLogVO toLogVO(AiGenerationLogDO d) {
        AiGenerationLogVO vo = new AiGenerationLogVO();
        BeanUtils.copyProperties(d, vo);
        return vo;
    }

    /**
     * 批量回填关联展示字段（用户名 / 画布名 / 任务状态），按本页 id 集合一次性查询，避免逐行 N+1。
     */
    private void enrich(List<AiGenerationLogVO> list) {
        if (list.isEmpty()) {
            return;
        }
        Set<Long> userIds = list.stream().map(AiGenerationLogVO::getUserId).filter(id -> id != null).collect(Collectors.toSet());
        Set<Long> projectIds = list.stream().map(AiGenerationLogVO::getProjectId).filter(id -> id != null).collect(Collectors.toSet());
        Set<Long> taskIds = list.stream().map(AiGenerationLogVO::getTaskId).filter(id -> id != null).collect(Collectors.toSet());

        Map<Long, String> userNames = new HashMap<>();
        if (!userIds.isEmpty()) {
            for (SysUserDO u : userMapper.selectBatchIds(userIds)) {
                userNames.put(u.getId(), StringUtils.hasText(u.getUsername()) ? u.getUsername() : u.getNickname());
            }
        }
        Map<Long, String> projectNames = new HashMap<>();
        if (!projectIds.isEmpty()) {
            for (CanvasProjectDO p : projectMapper.selectBatchIds(projectIds)) {
                projectNames.put(p.getId(), p.getName());
            }
        }
        Map<Long, Integer> taskStatuses = new HashMap<>();
        if (!taskIds.isEmpty()) {
            for (AiTaskDO t : taskMapper.selectBatchIds(taskIds)) {
                taskStatuses.put(t.getId(), t.getStatus());
            }
        }

        for (AiGenerationLogVO vo : list) {
            if (vo.getUserId() != null) {
                vo.setUserName(userNames.get(vo.getUserId()));
            }
            if (vo.getProjectId() != null) {
                vo.setProjectName(projectNames.get(vo.getProjectId()));
            }
            if (vo.getTaskId() != null) {
                vo.setTaskStatus(taskStatuses.get(vo.getTaskId()));
            }
        }
    }
}

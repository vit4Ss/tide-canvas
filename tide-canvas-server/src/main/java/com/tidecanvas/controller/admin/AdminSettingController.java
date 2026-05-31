package com.tidecanvas.controller.admin;

import com.tidecanvas.common.Result;
import com.tidecanvas.mapper.SysConfigMapper;
import com.tidecanvas.model.entity.SysConfigDO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Tag(name = "管理后台-系统设置")
@RestController
@RequestMapping("/api/admin/settings")
@RequiredArgsConstructor
public class AdminSettingController {

    private final SysConfigMapper configMapper;

    @Operation(summary = "获取系统配置")
    @GetMapping
    public Result<Map<String, String>> get() {
        List<SysConfigDO> configs = configMapper.selectList(null);
        Map<String, String> result = new HashMap<>();
        for (SysConfigDO config : configs) {
            result.put(config.getConfigKey(), config.getConfigValue());
        }
        return Result.success(result);
    }

    @Operation(summary = "更新系统配置")
    @PutMapping
    public Result<Void> update(@RequestBody Map<String, String> settings) {
        for (Map.Entry<String, String> entry : settings.entrySet()) {
            SysConfigDO config = configMapper.selectOne(
                    new com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<SysConfigDO>()
                            .eq(SysConfigDO::getConfigKey, entry.getKey()));
            if (config != null) {
                config.setConfigValue(entry.getValue());
                configMapper.updateById(config);
            }
        }
        return Result.success();
    }
}

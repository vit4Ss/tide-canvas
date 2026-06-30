package com.tidecanvas.controller.admin;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.Result;
import com.tidecanvas.annotation.RequiresPermission;
import com.tidecanvas.mapper.SysFileMapper;
import com.tidecanvas.model.entity.SysFileDO;
import com.tidecanvas.model.vo.FileVO;
import com.tidecanvas.service.storage.StorageStrategy;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.BeanUtils;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@Tag(name = "管理后台-文件管理")
@RestController
@RequestMapping("/api/admin/files")
@RequiredArgsConstructor
public class AdminFileController {

    private final SysFileMapper fileMapper;
    private final StorageStrategy storageStrategy;

    @Operation(summary = "文件列表")
    @RequiresPermission("file:view")
    @GetMapping
    public Result<PageResult<FileVO>> list(
            @RequestParam(defaultValue = "1") Integer pageNum,
            @RequestParam(defaultValue = "20") Integer pageSize,
            @RequestParam(required = false) String fileType,
            @RequestParam(required = false) String keyword) {
        Page<SysFileDO> page = new Page<>(pageNum, pageSize);
        LambdaQueryWrapper<SysFileDO> wrapper = new LambdaQueryWrapper<SysFileDO>()
                .eq(StringUtils.hasText(fileType), SysFileDO::getFileType, fileType)
                .like(StringUtils.hasText(keyword), SysFileDO::getOriginalName, keyword)
                .orderByDesc(SysFileDO::getCreateTime);
        fileMapper.selectPage(page, wrapper);
        List<FileVO> records = page.getRecords().stream().map(f -> {
            FileVO vo = new FileVO();
            BeanUtils.copyProperties(f, vo);
            return vo;
        }).toList();
        return Result.success(PageResult.of(records, page));
    }

    @Operation(summary = "删除文件")
    @RequiresPermission("file:delete")
    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        SysFileDO file = fileMapper.selectById(id);
        if (file != null) {
            storageStrategy.delete(file.getFilePath());
            fileMapper.deleteById(id);
        }
        return Result.success();
    }
}

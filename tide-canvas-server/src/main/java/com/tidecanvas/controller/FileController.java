package com.tidecanvas.controller;

import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.Result;
import com.tidecanvas.model.query.FileQuery;
import com.tidecanvas.model.vo.FileVO;
import com.tidecanvas.security.SecurityUtils;
import com.tidecanvas.service.FileService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;

@Tag(name = "文件管理")
@RestController
@RequestMapping("/api/files")
@RequiredArgsConstructor
public class FileController {

    private final FileService fileService;

    @Operation(summary = "单文件上传")
    @PostMapping("/upload")
    public Result<FileVO> upload(@RequestParam("file") MultipartFile file) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(fileService.upload(userId, file));
    }

    @Operation(summary = "批量上传")
    @PostMapping("/upload/batch")
    public Result<List<FileVO>> uploadBatch(@RequestParam("files") MultipartFile[] files) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(fileService.uploadBatch(userId, files));
    }

    @Operation(summary = "从URL保存为素材")
    @PostMapping("/save-from-url")
    public Result<FileVO> saveFromUrl(@RequestBody Map<String, Object> body) {
        Long userId = SecurityUtils.getCurrentUserId();
        String url = body.get("url") == null ? null : String.valueOf(body.get("url"));
        String fileType = body.get("fileType") == null ? null : String.valueOf(body.get("fileType"));
        String originalName = body.get("originalName") == null ? null : String.valueOf(body.get("originalName"));
        return Result.success(fileService.saveFromUrl(userId, url, fileType, originalName));
    }

    @Operation(summary = "文件列表")
    @GetMapping
    public Result<PageResult<FileVO>> list(FileQuery query) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(fileService.listFiles(userId, query));
    }

    @Operation(summary = "文件详情")
    @GetMapping("/{id}")
    public Result<FileVO> get(@PathVariable Long id) {
        return Result.success(fileService.getFile(id));
    }

    @Operation(summary = "删除文件")
    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        Long userId = SecurityUtils.getCurrentUserId();
        fileService.deleteFile(userId, id);
        return Result.success();
    }
}

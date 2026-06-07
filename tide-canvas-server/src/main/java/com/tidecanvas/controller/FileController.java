package com.tidecanvas.controller;

import com.tidecanvas.annotation.LimitDimension;
import com.tidecanvas.annotation.RateLimit;
import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.Result;
import com.tidecanvas.model.dto.FilePresignDTO;
import com.tidecanvas.model.dto.FileRegisterDTO;
import com.tidecanvas.model.query.FileQuery;
import com.tidecanvas.model.vo.FilePresignVO;
import com.tidecanvas.model.vo.FileVO;
import com.tidecanvas.security.SecurityUtils;
import com.tidecanvas.service.FileService;
import com.tidecanvas.util.SafeUrl;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import jakarta.servlet.http.HttpServletResponse;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;

@Tag(name = "文件管理")
@RestController
@RequestMapping("/api/files")
@RequiredArgsConstructor
public class FileController {

    private final FileService fileService;

    @Operation(summary = "单文件上传（服务器中转）")
    @RateLimit(name = "file_upload", limit = 30, period = 60, dimension = LimitDimension.USER, banThreshold = 5, banSeconds = 600)
    @PostMapping("/upload")
    public Result<FileVO> upload(@RequestParam("file") MultipartFile file) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(fileService.upload(userId, file));
    }

    @Operation(summary = "申请前端直传凭据（OSS；本地存储返回 direct=false）")
    @RateLimit(name = "file_presign", limit = 60, period = 60, dimension = LimitDimension.USER, banThreshold = 5, banSeconds = 600)
    @PostMapping("/presign")
    public Result<FilePresignVO> presign(@Valid @RequestBody FilePresignDTO dto) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(fileService.presignDirectUpload(userId, dto));
    }

    @Operation(summary = "前端直传完成后登记文件")
    @PostMapping("/register")
    public Result<FileVO> register(@Valid @RequestBody FileRegisterDTO dto) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(fileService.registerDirectUpload(userId, dto));
    }

    /** 代理下载最大体积，防滥用 */
    private static final long MAX_DOWNLOAD_BYTES = 200L * 1024 * 1024;

    @Operation(summary = "下载图片（服务端代理，规避前端跨域，强制 attachment）")
    @GetMapping("/download")
    public void download(@RequestParam String url,
                         @RequestParam(required = false) String name,
                         HttpServletResponse response) {
        // 防 SSRF：仅允许 http/https 公网地址，拒绝内网/环回/云元数据等
        try {
            SafeUrl.assertPublicHttp(url);
        } catch (Exception e) {
            response.setStatus(HttpServletResponse.SC_FORBIDDEN);
            return;
        }
        String filename = ((name == null || name.isBlank()) ? "image" : name) + ".png";
        try {
            HttpClient client = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(10))
                    .followRedirects(HttpClient.Redirect.NEVER) // 禁止跟随重定向，防绕过 SSRF 校验跳内网
                    .build();
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(60))
                    .GET()
                    .build();
            HttpResponse<InputStream> upstream = client.send(req, HttpResponse.BodyHandlers.ofInputStream());
            if (upstream.statusCode() >= 400) {
                response.setStatus(HttpServletResponse.SC_BAD_GATEWAY);
                return;
            }
            response.setContentType("application/octet-stream");
            response.setHeader("Content-Disposition",
                    "attachment; filename*=UTF-8''" + URLEncoder.encode(filename, StandardCharsets.UTF_8).replace("+", "%20"));
            try (InputStream in = upstream.body(); OutputStream out = response.getOutputStream()) {
                byte[] buf = new byte[8192];
                long total = 0;
                int n;
                while ((n = in.read(buf)) != -1) {
                    total += n;
                    if (total > MAX_DOWNLOAD_BYTES) {
                        break;
                    }
                    out.write(buf, 0, n);
                }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
        } catch (Exception e) {
            response.setStatus(HttpServletResponse.SC_BAD_GATEWAY);
        }
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
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(fileService.getFile(userId, id));
    }

    @Operation(summary = "删除文件")
    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        Long userId = SecurityUtils.getCurrentUserId();
        fileService.deleteFile(userId, id);
        return Result.success();
    }
}

package com.tidecanvas.service.storage;

import com.tidecanvas.config.StorageProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/** 本地磁盘存储（默认）。注意：返回相对地址 /uploads/...，不可被外部中转站获取，仅适合本机预览。 */
@Slf4j
@Component
@ConditionalOnProperty(name = "storage.kind", havingValue = "local", matchIfMissing = true)
@RequiredArgsConstructor
public class LocalStorageStrategy implements StorageStrategy {

    private final StorageProperties props;

    @Override
    public String upload(MultipartFile file, String directory) {
        try {
            Path dirPath = Paths.get(props.getLocalDir(), directory);
            Files.createDirectories(dirPath);
            String fileName = System.currentTimeMillis() + "_" + sanitize(file.getOriginalFilename());
            Path filePath = resolveSafely(dirPath, fileName);
            file.transferTo(filePath.toFile());
            return directory + "/" + fileName;
        } catch (IOException e) {
            log.error("文件上传失败", e);
            throw new RuntimeException("文件上传失败", e);
        }
    }

    @Override
    public String uploadBytes(byte[] data, String filename, String contentType, String directory) {
        try {
            Path dirPath = Paths.get(props.getLocalDir(), directory);
            Files.createDirectories(dirPath);
            String fileName = System.currentTimeMillis() + "_" + sanitize(filename);
            Path filePath = resolveSafely(dirPath, fileName);
            Files.write(filePath, data);
            return directory + "/" + fileName;
        } catch (IOException e) {
            log.error("文件上传失败", e);
            throw new RuntimeException("文件上传失败", e);
        }
    }

    /** 文件名安全化：剥离目录部分、上跳与特殊字符，避免路径穿越/覆盖 */
    private String sanitize(String name) {
        if (!StringUtils.hasText(name)) {
            return "file";
        }
        String base = name.replace('\\', '/');
        int slash = base.lastIndexOf('/');
        if (slash >= 0) {
            base = base.substring(slash + 1);
        }
        base = base.replaceAll("[^a-zA-Z0-9._-]", "_");
        if (base.isEmpty() || ".".equals(base) || "..".equals(base)) {
            return "file";
        }
        return base;
    }

    /** 落地路径必须落在目标目录内（防御性，sanitize 后正常已无穿越可能） */
    private Path resolveSafely(Path dir, String fileName) {
        Path resolved = dir.resolve(fileName).normalize();
        if (!resolved.startsWith(dir.normalize())) {
            throw new RuntimeException("非法文件名");
        }
        return resolved;
    }

    @Override
    public void delete(String filePath) {
        try {
            Path path = Paths.get(props.getLocalDir(), filePath);
            Files.deleteIfExists(path);
        } catch (IOException e) {
            log.error("文件删除失败: {}", filePath, e);
        }
    }

    @Override
    public String getAccessUrl(String filePath) {
        return "/uploads/" + filePath;
    }

    @Override
    public String type() {
        return "local";
    }
}

package com.tidecanvas.service.storage;

import com.tidecanvas.config.StorageProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
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
            String fileName = System.currentTimeMillis() + "_" + file.getOriginalFilename();
            Path filePath = dirPath.resolve(fileName);
            file.transferTo(filePath.toFile());
            return directory + "/" + fileName;
        } catch (IOException e) {
            log.error("文件上传失败", e);
            throw new RuntimeException("文件上传失败", e);
        }
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

package com.tidecanvas.service.storage;

import com.aliyun.oss.HttpMethod;
import com.aliyun.oss.OSS;
import com.aliyun.oss.OSSClientBuilder;
import com.aliyun.oss.model.CannedAccessControlList;
import com.aliyun.oss.model.GeneratePresignedUrlRequest;
import com.aliyun.oss.model.ObjectMetadata;
import com.tidecanvas.config.StorageProperties;
import jakarta.annotation.PreDestroy;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.Date;
import java.util.UUID;

/**
 * 阿里云 OSS 存储。
 * <p>
 * 上传文件写入公网可读的对象存储，{@link #getAccessUrl} 返回公网 HTTPS 地址，
 * 供图生图/视频参考等场景把源图作为 image_urls 交给中转站拉取（中转站要求公网可达 URL）。
 * 仅当 {@code storage.kind=oss} 时启用。
 *
 * @author tidecanvas
 */
@Slf4j
@Component
@ConditionalOnProperty(name = "storage.kind", havingValue = "oss")
@RequiredArgsConstructor
public class OssStorageStrategy implements StorageStrategy {

    private final StorageProperties props;
    private volatile OSS client;

    /** 懒加载 OSS 客户端（线程安全双检锁） */
    private OSS client() {
        if (client == null) {
            synchronized (this) {
                if (client == null) {
                    client = new OSSClientBuilder().build(
                            props.getOssEndpoint(), props.getOssAccessKeyId(), props.getOssAccessKeySecret());
                }
            }
        }
        return client;
    }

    @Override
    public String upload(MultipartFile file, String directory) {
        String fileName = System.currentTimeMillis() + "_" + sanitize(file.getOriginalFilename());
        String key = prefix() + directory + "/" + fileName;
        try (InputStream in = file.getInputStream()) {
            ObjectMetadata meta = new ObjectMetadata();
            meta.setContentLength(file.getSize());
            if (StringUtils.hasText(file.getContentType())) {
                meta.setContentType(file.getContentType());
            }
            client().putObject(props.getOssBucket(), key, in, meta);
            // 尽力将对象设为公网可读，确保中转站能直接拉取（桶禁用对象 ACL 时忽略失败）
            try {
                client().setObjectAcl(props.getOssBucket(), key, CannedAccessControlList.PublicRead);
            } catch (Exception aclEx) {
                log.warn("设置对象 public-read 失败（请确保桶为公共读）: {}", key, aclEx);
            }
            return key;
        } catch (Exception e) {
            log.error("OSS 上传失败: {}", key, e);
            throw new RuntimeException("文件上传失败", e);
        }
    }

    @Override
    public String uploadBytes(byte[] data, String filename, String contentType, String directory) {
        String fileName = System.currentTimeMillis() + "_" + sanitize(filename);
        String key = prefix() + directory + "/" + fileName;
        try (InputStream in = new ByteArrayInputStream(data)) {
            ObjectMetadata meta = new ObjectMetadata();
            meta.setContentLength(data.length);
            if (StringUtils.hasText(contentType)) {
                meta.setContentType(contentType);
            }
            client().putObject(props.getOssBucket(), key, in, meta);
            try {
                client().setObjectAcl(props.getOssBucket(), key, CannedAccessControlList.PublicRead);
            } catch (Exception aclEx) {
                log.warn("设置对象 public-read 失败（请确保桶为公共读）: {}", key, aclEx);
            }
            return key;
        } catch (Exception e) {
            log.error("OSS 字节上传失败: {}", key, e);
            throw new RuntimeException("文件上传失败", e);
        }
    }

    @Override
    public void delete(String filePath) {
        try {
            client().deleteObject(props.getOssBucket(), filePath);
        } catch (Exception e) {
            log.error("OSS 删除失败: {}", filePath, e);
        }
    }

    @Override
    public String getAccessUrl(String filePath) {
        if (StringUtils.hasText(props.getOssCdnDomain())) {
            return props.getOssCdnDomain().replaceAll("/+$", "") + "/" + filePath;
        }
        String host = props.getOssEndpoint().replaceFirst("^https?://", "").replaceAll("/+$", "");
        return "https://" + props.getOssBucket() + "." + host + "/" + filePath;
    }

    @Override
    public String type() {
        return "oss";
    }

    @Override
    public boolean supportsDirectUpload() {
        return true;
    }

    @Override
    public DirectUploadTicket presignDirectUpload(String originalName, String contentType, String directory, long expireSeconds) {
        String fileName = System.currentTimeMillis() + "_" + UUID.randomUUID().toString().substring(0, 8) + "_" + sanitize(originalName);
        String key = prefix() + directory + "/" + fileName;
        Date expiration = new Date(System.currentTimeMillis() + expireSeconds * 1000L);
        GeneratePresignedUrlRequest req = new GeneratePresignedUrlRequest(props.getOssBucket(), key, HttpMethod.PUT);
        req.setExpiration(expiration);
        if (StringUtils.hasText(contentType)) {
            // 绑定 Content-Type 进签名：前端 PUT 时必须发送相同的 Content-Type，否则签名不匹配
            req.setContentType(contentType);
        }
        String uploadUrl = client().generatePresignedUrl(req).toString();
        return new DirectUploadTicket(key, uploadUrl, getAccessUrl(key));
    }

    @Override
    public long finalizeDirectUpload(String key, String contentType) {
        // 校验对象确已上传（不存在会抛异常），并取真实大小
        ObjectMetadata meta = client().getObjectMetadata(props.getOssBucket(), key);
        // 尽力设为公网可读，确保中转站可拉取（桶禁用对象 ACL 时忽略失败）
        try {
            client().setObjectAcl(props.getOssBucket(), key, CannedAccessControlList.PublicRead);
        } catch (Exception aclEx) {
            log.warn("设置对象 public-read 失败（请确保桶为公共读）: {}", key, aclEx);
        }
        return meta.getContentLength();
    }

    /** 规范化对象键前缀：非空时确保以 / 结尾 */
    private String prefix() {
        String p = props.getOssPrefix();
        if (!StringUtils.hasText(p)) {
            return "";
        }
        return p.endsWith("/") ? p : p + "/";
    }

    /** 文件名安全化：仅保留字母数字与 . _ -，避免非法对象键 */
    private String sanitize(String name) {
        if (!StringUtils.hasText(name)) {
            return "file";
        }
        return name.replaceAll("[^a-zA-Z0-9._-]", "_");
    }

    @PreDestroy
    public void shutdown() {
        if (client != null) {
            client.shutdown();
        }
    }
}

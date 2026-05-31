package com.tidecanvas.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

import java.util.List;

/**
 * 文件存储配置（prefix=storage）。
 * <p>
 * kind=local 时落本地磁盘（仅本机预览）；kind=oss 时落阿里云 OSS，返回公网 HTTPS 地址，
 * 供图生图源图被中转站拉取（中转站要求公网可达 URL）。
 *
 * @author tidecanvas
 */
@Data
@Configuration
@ConfigurationProperties(prefix = "storage")
public class StorageProperties {

    /** 存储方式：local / oss */
    private String kind = "local";

    /** 本地存储目录（kind=local） */
    private String localDir = "./uploads";

    /** OSS 地域节点，如 https://oss-cn-shanghai.aliyuncs.com */
    private String ossEndpoint;

    private String ossAccessKeyId;

    private String ossAccessKeySecret;

    /** 存储桶名称 */
    private String ossBucket;

    /** 桶内对象键前缀（目录），如 uploads/ */
    private String ossPrefix = "uploads/";

    /** 可选 CDN 自定义域名，如 https://cdn.example.com；留空按 https://{bucket}.{endpoint} 拼接 */
    private String ossCdnDomain;

    /** 上传大小上限（字节） */
    private long maxSize = 52428800L;

    /** 允许的 MIME 类型 */
    private List<String> allowedTypes;
}

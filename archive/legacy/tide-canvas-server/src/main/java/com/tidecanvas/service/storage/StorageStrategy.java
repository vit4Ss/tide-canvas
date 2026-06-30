package com.tidecanvas.service.storage;

import org.springframework.web.multipart.MultipartFile;

public interface StorageStrategy {

    String upload(MultipartFile file, String directory);

    /**
     * 上传内存字节数据（服务端生成 / 裁剪的图片等），返回存储相对路径（key）。
     *
     * @param data        字节内容
     * @param filename    文件名（含扩展名）
     * @param contentType MIME 类型，可空
     * @param directory   子目录
     */
    String uploadBytes(byte[] data, String filename, String contentType, String directory);

    void delete(String filePath);

    String getAccessUrl(String filePath);

    /** 存储类型标识（local / oss），写入文件记录 */
    String type();

    /** 是否支持前端直传（端直传到对象存储）。仅 OSS 支持，本地存储不支持 */
    default boolean supportsDirectUpload() {
        return false;
    }

    /**
     * 生成前端直传凭据：在 {@code directory} 下为 {@code originalName} 生成对象键，
     * 返回绑定 {@code contentType}、{@code expireSeconds} 内有效的预签名 PUT 地址与最终公网地址。
     */
    default DirectUploadTicket presignDirectUpload(String originalName, String contentType, String directory, long expireSeconds) {
        throw new UnsupportedOperationException("当前存储不支持前端直传");
    }

    /**
     * 直传完成后收尾：校验对象确已上传、设为公网可读，返回对象真实大小（字节）。
     * 对象不存在应抛异常。
     */
    default long finalizeDirectUpload(String key, String contentType) {
        throw new UnsupportedOperationException("当前存储不支持前端直传");
    }
}

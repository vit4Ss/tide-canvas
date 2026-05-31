package com.tidecanvas.service.storage;

import org.springframework.web.multipart.MultipartFile;

public interface StorageStrategy {

    String upload(MultipartFile file, String directory);

    void delete(String filePath);

    String getAccessUrl(String filePath);

    /** 存储类型标识（local / oss），写入文件记录 */
    String type();
}

package com.tidecanvas.service;

import com.tidecanvas.common.PageResult;
import com.tidecanvas.model.query.FileQuery;
import com.tidecanvas.model.vo.FileVO;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

public interface FileService {

    FileVO upload(Long userId, MultipartFile file);

    List<FileVO> uploadBatch(Long userId, MultipartFile[] files);

    /** 将一个已存在的公网 URL（如节点生成图）记录为当前用户的素材；同 URL 已存在则直接返回 */
    FileVO saveFromUrl(Long userId, String url, String fileType, String originalName);

    PageResult<FileVO> listFiles(Long userId, FileQuery query);

    FileVO getFile(Long id);

    void deleteFile(Long userId, Long id);
}

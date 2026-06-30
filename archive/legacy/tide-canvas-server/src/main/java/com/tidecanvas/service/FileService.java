package com.tidecanvas.service;

import com.tidecanvas.common.PageResult;
import com.tidecanvas.model.dto.FilePresignDTO;
import com.tidecanvas.model.dto.FileRegisterDTO;
import com.tidecanvas.model.query.FileQuery;
import com.tidecanvas.model.vo.FilePresignVO;
import com.tidecanvas.model.vo.FileVO;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

public interface FileService {

    FileVO upload(Long userId, MultipartFile file);

    List<FileVO> uploadBatch(Long userId, MultipartFile[] files);

    /** 申请前端直传凭据（OSS）；本地存储返回 direct=false，前端应回退服务器中转上传 */
    FilePresignVO presignDirectUpload(Long userId, FilePresignDTO dto);

    /** 前端直传完成后登记文件记录（校验对象存在、取真实大小、设公网可读） */
    FileVO registerDirectUpload(Long userId, FileRegisterDTO dto);

    /** 将一个已存在的公网 URL（如节点生成图）记录为当前用户的素材；同 URL 已存在则直接返回 */
    FileVO saveFromUrl(Long userId, String url, String fileType, String originalName);

    PageResult<FileVO> listFiles(Long userId, FileQuery query);

    FileVO getFile(Long userId, Long id);

    void deleteFile(Long userId, Long id);
}

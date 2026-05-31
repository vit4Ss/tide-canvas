package com.tidecanvas.service.impl;

import cn.hutool.crypto.digest.DigestUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.ResultCode;
import com.tidecanvas.config.StorageProperties;
import com.tidecanvas.enums.FileTypeEnum;
import com.tidecanvas.exception.BusinessException;
import com.tidecanvas.mapper.SysFileMapper;
import com.tidecanvas.model.entity.SysFileDO;
import com.tidecanvas.model.query.FileQuery;
import com.tidecanvas.model.vo.FileVO;
import com.tidecanvas.service.FileService;
import com.tidecanvas.service.storage.StorageStrategy;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.BeanUtils;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class FileServiceImpl implements FileService {

    private final SysFileMapper fileMapper;
    private final StorageStrategy storageStrategy;
    private final StorageProperties storageProperties;

    @Override
    public FileVO upload(Long userId, MultipartFile file) {
        validateFile(file);

        String originalName = file.getOriginalFilename();
        String mimeType = file.getContentType();
        String fileType = FileTypeEnum.fromMimeType(mimeType).getCode();
        String storedName = UUID.randomUUID() + getExtension(originalName);
        String directory = fileType + "/" + LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy/MM/dd"));
        String filePath = storageStrategy.upload(file, directory);
        String fileUrl = storageStrategy.getAccessUrl(filePath);
        String hash = computeHash(file);

        SysFileDO fileDO = new SysFileDO();
        fileDO.setUserId(userId);
        fileDO.setOriginalName(originalName);
        fileDO.setStoredName(storedName);
        fileDO.setFilePath(filePath);
        fileDO.setFileUrl(fileUrl);
        fileDO.setFileSize(file.getSize());
        fileDO.setFileType(fileType);
        fileDO.setMimeType(mimeType);
        fileDO.setHash(hash);
        fileDO.setStorageType(storageStrategy.type());
        fileDO.setDeleted(0);
        fileMapper.insert(fileDO);

        return toFileVO(fileDO);
    }

    @Override
    public FileVO saveFromUrl(Long userId, String url, String fileType, String originalName) {
        if (!StringUtils.hasText(url)) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "素材地址不能为空");
        }
        // 去重：同用户同 URL 已存在则直接返回
        SysFileDO exist = fileMapper.selectOne(new LambdaQueryWrapper<SysFileDO>()
                .eq(SysFileDO::getUserId, userId)
                .eq(SysFileDO::getFileUrl, url)
                .last("LIMIT 1"));
        if (exist != null) {
            return toFileVO(exist);
        }
        String type = StringUtils.hasText(fileType) ? fileType : guessTypeFromUrl(url);
        String name = StringUtils.hasText(originalName) ? originalName : extractNameFromUrl(url);
        SysFileDO fileDO = new SysFileDO();
        fileDO.setUserId(userId);
        fileDO.setOriginalName(name);
        fileDO.setStoredName(name);
        fileDO.setFilePath(url);
        fileDO.setFileUrl(url);
        fileDO.setFileSize(0L);
        fileDO.setFileType(type);
        fileDO.setMimeType("video".equals(type) ? "video/mp4" : "image/png");
        fileDO.setHash("");
        fileDO.setStorageType(url.startsWith("http") ? "oss" : "local");
        fileDO.setDeleted(0);
        fileMapper.insert(fileDO);
        return toFileVO(fileDO);
    }

    private String guessTypeFromUrl(String url) {
        String low = url.toLowerCase();
        if (low.endsWith(".mp4") || low.endsWith(".webm") || low.endsWith(".mov")) {
            return "video";
        }
        return "image";
    }

    private String extractNameFromUrl(String url) {
        try {
            String path = url.split("\\?")[0];
            int slash = path.lastIndexOf('/');
            String name = slash >= 0 ? path.substring(slash + 1) : path;
            return StringUtils.hasText(name) ? name : "素材";
        } catch (Exception e) {
            return "素材";
        }
    }

    @Override
    public List<FileVO> uploadBatch(Long userId, MultipartFile[] files) {
        List<FileVO> result = new ArrayList<>();
        for (MultipartFile file : files) {
            result.add(upload(userId, file));
        }
        return result;
    }

    @Override
    public PageResult<FileVO> listFiles(Long userId, FileQuery query) {
        Page<SysFileDO> page = new Page<>(query.getPageNum(), query.getPageSize());
        LambdaQueryWrapper<SysFileDO> wrapper = new LambdaQueryWrapper<SysFileDO>()
                .eq(SysFileDO::getUserId, userId)
                .eq(StringUtils.hasText(query.getFileType()), SysFileDO::getFileType, query.getFileType())
                .like(StringUtils.hasText(query.getKeyword()), SysFileDO::getOriginalName, query.getKeyword())
                .orderByDesc(SysFileDO::getCreateTime);
        fileMapper.selectPage(page, wrapper);
        List<FileVO> records = page.getRecords().stream().map(this::toFileVO).toList();
        return PageResult.of(records, page);
    }

    @Override
    public FileVO getFile(Long id) {
        SysFileDO file = fileMapper.selectById(id);
        if (file == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "文件不存在");
        }
        return toFileVO(file);
    }

    @Override
    public void deleteFile(Long userId, Long id) {
        SysFileDO file = fileMapper.selectById(id);
        if (file == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "文件不存在");
        }
        if (!file.getUserId().equals(userId)) {
            throw new BusinessException(ResultCode.FORBIDDEN, "无权删除该文件");
        }
        storageStrategy.delete(file.getFilePath());
        fileMapper.deleteById(id);
    }

    private void validateFile(MultipartFile file) {
        if (file.isEmpty()) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "文件不能为空");
        }
        if (file.getSize() > storageProperties.getMaxSize()) {
            throw new BusinessException(ResultCode.FILE_SIZE_EXCEEDED);
        }
        if (storageProperties.getAllowedTypes() != null && !storageProperties.getAllowedTypes().contains(file.getContentType())) {
            throw new BusinessException(ResultCode.FILE_TYPE_NOT_ALLOWED);
        }
    }

    private String getExtension(String filename) {
        if (filename == null || !filename.contains(".")) {
            return "";
        }
        return filename.substring(filename.lastIndexOf("."));
    }

    private String computeHash(MultipartFile file) {
        try {
            return DigestUtil.sha256Hex(file.getInputStream()).substring(0, 16);
        } catch (IOException e) {
            return "";
        }
    }

    private FileVO toFileVO(SysFileDO file) {
        FileVO vo = new FileVO();
        BeanUtils.copyProperties(file, vo);
        return vo;
    }
}

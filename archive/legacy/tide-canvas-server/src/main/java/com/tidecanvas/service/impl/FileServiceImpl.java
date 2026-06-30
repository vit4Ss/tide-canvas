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
import com.tidecanvas.model.dto.FilePresignDTO;
import com.tidecanvas.model.dto.FileRegisterDTO;
import com.tidecanvas.model.entity.SysFileDO;
import com.tidecanvas.model.query.FileQuery;
import com.tidecanvas.model.vo.FilePresignVO;
import com.tidecanvas.model.vo.FileVO;
import com.tidecanvas.service.FileService;
import com.tidecanvas.service.TeamService;
import com.tidecanvas.service.ai.GenerationLogRecorder;
import com.tidecanvas.service.storage.DirectUploadTicket;
import com.tidecanvas.service.storage.StorageStrategy;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.BeanUtils;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

@Service
@RequiredArgsConstructor
public class FileServiceImpl implements FileService {

    private final SysFileMapper fileMapper;
    private final StorageStrategy storageStrategy;
    private final StorageProperties storageProperties;
    private final GenerationLogRecorder generationLogRecorder;
    private final RedisTemplate<String, Object> redisTemplate;
    private final TeamService teamService;

    /** 直传预签名 URL 有效期（秒）：仅约束 PUT 请求发起时刻，足够覆盖 presign 到上传开始的间隔 */
    private static final long PRESIGN_EXPIRE_SECONDS = 3600L;
    /** 直传票据前缀：记录某 key 由哪个用户申请、其内容类型，登记时闭环校验 */
    private static final String PRESIGN_TICKET_PREFIX = "presign:";

    @Override
    public FileVO upload(Long userId, MultipartFile file) {
        String originalName = file.getOriginalFilename();
        try {
            validateFile(file);

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

            generationLogRecorder.recordOperation("file_upload", userId, null, originalName, true, fileUrl, null);
            return toFileVO(fileDO);
        } catch (RuntimeException e) {
            // 失败也落一条操作日志（大小超限/类型不允许/OSS异常等），便于后台排查；随后原样抛出由全局处理返回客户端
            generationLogRecorder.recordOperation("file_upload", userId, null, originalName, false, null, e.getMessage());
            throw e;
        }
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
        generationLogRecorder.recordOperation("asset_save", userId, null, name, true, url, null);
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
    public FilePresignVO presignDirectUpload(Long userId, FilePresignDTO dto) {
        FilePresignVO vo = new FilePresignVO();
        // 本地存储不支持直传 → 返回 direct=false，前端回退中转上传
        if (!storageStrategy.supportsDirectUpload()) {
            vo.setDirect(false);
            return vo;
        }
        String contentType = StringUtils.hasText(dto.getContentType()) ? dto.getContentType() : "application/octet-stream";
        // 类型白名单：不允许的类型直接拒签（与中转上传 validateFile 一致）
        assertTypeAllowed(contentType);
        String fileType = StringUtils.hasText(dto.getFileType()) ? dto.getFileType() : FileTypeEnum.fromMimeType(contentType).getCode();
        String directory = fileType + "/" + LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy/MM/dd"));
        String name = StringUtils.hasText(dto.getFilename()) ? dto.getFilename() : "file";
        DirectUploadTicket ticket = storageStrategy.presignDirectUpload(name, contentType, directory, PRESIGN_EXPIRE_SECONDS);
        // 存票据（key → 申请用户 | 内容类型 | 文件大类），供 register 闭环校验；有效期略大于预签名
        redisTemplate.opsForValue().set(PRESIGN_TICKET_PREFIX + ticket.key(),
                userId + "|" + contentType + "|" + fileType, PRESIGN_EXPIRE_SECONDS + 600, TimeUnit.SECONDS);
        vo.setDirect(true);
        vo.setUploadUrl(ticket.uploadUrl());
        vo.setKey(ticket.key());
        vo.setFileUrl(ticket.fileUrl());
        vo.setContentType(contentType);
        return vo;
    }

    @Override
    public FileVO registerDirectUpload(Long userId, FileRegisterDTO dto) {
        String key = dto.getKey();
        // 闭环校验①：该 key 必须由本用户申请过预签名（防伪造/冒用他人 key）
        Object ticketObj = redisTemplate.opsForValue().get(PRESIGN_TICKET_PREFIX + key);
        if (ticketObj == null) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "上传凭据无效或已过期");
        }
        String[] parts = ticketObj.toString().split("\\|", 3);
        if (parts.length < 3 || !parts[0].equals(String.valueOf(userId))) {
            throw new BusinessException(ResultCode.FORBIDDEN, "无权登记该文件");
        }
        // 类型以票据为准（不信任 register 传入的 contentType/fileType，防绕过白名单）
        String contentType = parts[1];
        String fileType = parts[2];
        String originalName = StringUtils.hasText(dto.getOriginalName()) ? dto.getOriginalName() : keyFileName(key);

        long size;
        try {
            // 校验对象确已上传、取真实大小、设公网可读
            size = storageStrategy.finalizeDirectUpload(key, contentType);
        } catch (Exception e) {
            generationLogRecorder.recordOperation("file_upload", userId, null, originalName, false, null, "直传对象校验失败:" + e.getMessage());
            throw new BusinessException(ResultCode.BAD_REQUEST, "文件未完成上传或不存在");
        }
        // 闭环校验②：用 OSS 上报的真实大小卡上限；超限则删对象 + 作废票据
        if (size > storageProperties.getMaxSize()) {
            storageStrategy.delete(key);
            redisTemplate.delete(PRESIGN_TICKET_PREFIX + key);
            generationLogRecorder.recordOperation("file_upload", userId, null, originalName, false, null, "文件超出大小限制");
            throw new BusinessException(ResultCode.FILE_SIZE_EXCEEDED);
        }
        // 闭环校验③：类型白名单兜底
        assertTypeAllowed(contentType);

        String fileUrl = storageStrategy.getAccessUrl(key);
        SysFileDO fileDO = new SysFileDO();
        fileDO.setUserId(userId);
        fileDO.setOriginalName(originalName);
        fileDO.setStoredName(keyFileName(key));
        fileDO.setFilePath(key);
        fileDO.setFileUrl(fileUrl);
        fileDO.setFileSize(size);
        fileDO.setFileType(fileType);
        fileDO.setMimeType(contentType);
        fileDO.setHash("");
        fileDO.setStorageType(storageStrategy.type());
        fileDO.setDeleted(0);
        fileMapper.insert(fileDO);

        // 一次性票据：登记后作废，防重复登记
        redisTemplate.delete(PRESIGN_TICKET_PREFIX + key);
        generationLogRecorder.recordOperation("file_upload", userId, null, originalName, true, fileUrl, null);
        return toFileVO(fileDO);
    }

    /** 从对象键取末段作为存储文件名 */
    private String keyFileName(String key) {
        int slash = key == null ? -1 : key.lastIndexOf('/');
        return slash >= 0 ? key.substring(slash + 1) : (key == null ? "file" : key);
    }

    @Override
    public PageResult<FileVO> listFiles(Long userId, FileQuery query) {
        Page<SysFileDO> page = new Page<>(query.getPageNum(), query.getPageSize());
        LambdaQueryWrapper<SysFileDO> wrapper = new LambdaQueryWrapper<SysFileDO>()
                .in(SysFileDO::getUserId, teamService.getTeamMemberIds(userId)) // 团队共享素材库
                .eq(StringUtils.hasText(query.getFileType()), SysFileDO::getFileType, query.getFileType())
                .like(StringUtils.hasText(query.getKeyword()), SysFileDO::getOriginalName, query.getKeyword())
                .orderByDesc(SysFileDO::getCreateTime);
        fileMapper.selectPage(page, wrapper);
        List<FileVO> records = page.getRecords().stream().map(this::toFileVO).toList();
        return PageResult.of(records, page);
    }

    @Override
    public FileVO getFile(Long userId, Long id) {
        SysFileDO file = fileMapper.selectById(id);
        if (file == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "文件不存在");
        }
        // 越权防护：本人或同团队成员可访问
        if (file.getUserId() == null || !teamService.getTeamMemberIds(userId).contains(file.getUserId())) {
            throw new BusinessException(ResultCode.FORBIDDEN, "无权访问该文件");
        }
        return toFileVO(file);
    }

    @Override
    public void deleteFile(Long userId, Long id) {
        SysFileDO file = fileMapper.selectById(id);
        if (file == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "文件不存在");
        }
        // 删除仅限所有者或团队管理员（成员只能用/看队友素材，不能删）
        if (!file.getUserId().equals(userId) && !teamService.isTeamAdminOf(userId, file.getUserId())) {
            throw new BusinessException(ResultCode.FORBIDDEN, "无权删除该文件");
        }
        storageStrategy.delete(file.getFilePath());
        fileMapper.deleteById(id);
        generationLogRecorder.recordOperation("file_delete", userId, null, file.getOriginalName(), true, file.getFileUrl(), null);
    }

    private void validateFile(MultipartFile file) {
        if (file.isEmpty()) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "文件不能为空");
        }
        if (file.getSize() > storageProperties.getMaxSize()) {
            throw new BusinessException(ResultCode.FILE_SIZE_EXCEEDED);
        }
        assertTypeAllowed(file.getContentType());
    }

    /** 内容类型白名单校验（allowedTypes 未配置则不限制） */
    private void assertTypeAllowed(String contentType) {
        if (storageProperties.getAllowedTypes() != null && !storageProperties.getAllowedTypes().contains(contentType)) {
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
        vo.setOwnerId(file.getUserId()); // 字段名不同，需显式设置
        return vo;
    }
}

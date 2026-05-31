package com.tidecanvas.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.tidecanvas.common.ResultCode;
import com.tidecanvas.exception.BusinessException;
import com.tidecanvas.mapper.SysUserMapper;
import com.tidecanvas.model.dto.RefreshTokenDTO;
import com.tidecanvas.model.dto.UpdatePasswordDTO;
import com.tidecanvas.model.dto.UserLoginDTO;
import com.tidecanvas.model.dto.UserRegisterDTO;
import com.tidecanvas.model.entity.SysUserDO;
import com.tidecanvas.model.vo.LoginVO;
import com.tidecanvas.model.vo.UserVO;
import com.tidecanvas.security.JwtTokenProvider;
import com.tidecanvas.service.AuthService;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.BeanUtils;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

@Service
@RequiredArgsConstructor
public class AuthServiceImpl implements AuthService {

    private final SysUserMapper userMapper;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider jwtTokenProvider;

    private static final int DEFAULT_API_QUOTA = 100;
    private static final long DEFAULT_STORAGE_QUOTA = 1073741824L;

    @Override
    public UserVO register(UserRegisterDTO dto) {
        Long usernameCount = userMapper.selectCount(
                new LambdaQueryWrapper<SysUserDO>().eq(SysUserDO::getUsername, dto.getUsername()));
        if (usernameCount > 0) {
            throw new BusinessException(ResultCode.USERNAME_EXISTS);
        }

        Long emailCount = userMapper.selectCount(
                new LambdaQueryWrapper<SysUserDO>().eq(SysUserDO::getEmail, dto.getEmail()));
        if (emailCount > 0) {
            throw new BusinessException(ResultCode.EMAIL_EXISTS);
        }

        SysUserDO user = new SysUserDO();
        user.setUsername(dto.getUsername());
        user.setEmail(dto.getEmail());
        user.setPassword(passwordEncoder.encode(dto.getPassword()));
        user.setNickname(dto.getNickname() != null ? dto.getNickname() : dto.getUsername());
        user.setPhone(dto.getPhone());
        user.setRole(0);
        user.setStatus(1);
        user.setApiQuota(DEFAULT_API_QUOTA);
        user.setPoints(DEFAULT_API_QUOTA);
        user.setIsAuthor(0);
        user.setStorageQuota(DEFAULT_STORAGE_QUOTA);
        user.setDeleted(0);
        userMapper.insert(user);

        return toUserVO(user);
    }

    @Override
    public LoginVO login(UserLoginDTO dto) {
        SysUserDO user = userMapper.selectByAccount(dto.getAccount());
        if (user == null) {
            throw new BusinessException(ResultCode.ACCOUNT_NOT_FOUND);
        }
        if (user.getStatus() == 0) {
            throw new BusinessException(ResultCode.ACCOUNT_DISABLED);
        }
        if (!passwordEncoder.matches(dto.getPassword(), user.getPassword())) {
            throw new BusinessException(ResultCode.PASSWORD_INCORRECT);
        }

        user.setLastLoginTime(LocalDateTime.now());
        userMapper.updateById(user);

        String accessToken = jwtTokenProvider.generateAccessToken(user.getId(), user.getUsername(), user.getRole());
        String refreshToken = jwtTokenProvider.generateRefreshToken(user.getId());

        LoginVO vo = new LoginVO();
        vo.setAccessToken(accessToken);
        vo.setRefreshToken(refreshToken);
        vo.setExpiresIn(jwtTokenProvider.getAccessTokenExpiration());
        vo.setUserInfo(toUserVO(user));
        return vo;
    }

    @Override
    public LoginVO refreshToken(RefreshTokenDTO dto) {
        if (!jwtTokenProvider.validateToken(dto.getRefreshToken())) {
            throw new BusinessException(ResultCode.UNAUTHORIZED, "RefreshToken无效或已过期");
        }

        Long userId = jwtTokenProvider.getUserIdFromToken(dto.getRefreshToken());
        SysUserDO user = userMapper.selectById(userId);
        if (user == null || user.getStatus() == 0) {
            throw new BusinessException(ResultCode.UNAUTHORIZED);
        }

        String accessToken = jwtTokenProvider.generateAccessToken(user.getId(), user.getUsername(), user.getRole());
        String refreshToken = jwtTokenProvider.generateRefreshToken(user.getId());

        LoginVO vo = new LoginVO();
        vo.setAccessToken(accessToken);
        vo.setRefreshToken(refreshToken);
        vo.setExpiresIn(jwtTokenProvider.getAccessTokenExpiration());
        vo.setUserInfo(toUserVO(user));
        return vo;
    }

    @Override
    public UserVO getCurrentUser(Long userId) {
        SysUserDO user = userMapper.selectById(userId);
        if (user == null) {
            throw new BusinessException(ResultCode.ACCOUNT_NOT_FOUND);
        }
        return toUserVO(user);
    }

    @Override
    public void updatePassword(Long userId, UpdatePasswordDTO dto) {
        SysUserDO user = userMapper.selectById(userId);
        if (user == null) {
            throw new BusinessException(ResultCode.ACCOUNT_NOT_FOUND);
        }
        if (!passwordEncoder.matches(dto.getOldPassword(), user.getPassword())) {
            throw new BusinessException(ResultCode.PASSWORD_INCORRECT, "原密码不正确");
        }
        user.setPassword(passwordEncoder.encode(dto.getNewPassword()));
        userMapper.updateById(user);
    }

    private UserVO toUserVO(SysUserDO user) {
        UserVO vo = new UserVO();
        BeanUtils.copyProperties(user, vo);
        return vo;
    }
}

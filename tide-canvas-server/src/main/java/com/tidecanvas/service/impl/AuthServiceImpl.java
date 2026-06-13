package com.tidecanvas.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.tidecanvas.common.ResultCode;
import com.tidecanvas.exception.BusinessException;
import com.tidecanvas.mapper.LoginLogMapper;
import com.tidecanvas.mapper.SysUserMapper;
import com.tidecanvas.model.dto.RefreshTokenDTO;
import com.tidecanvas.model.dto.UpdatePasswordDTO;
import com.tidecanvas.model.dto.UserLoginDTO;
import com.tidecanvas.model.dto.UserRegisterDTO;
import com.tidecanvas.model.entity.LoginLogDO;
import com.tidecanvas.model.entity.SysUserDO;
import com.tidecanvas.model.vo.LoginVO;
import com.tidecanvas.model.vo.UserVO;
import com.tidecanvas.security.JwtTokenProvider;
import com.tidecanvas.service.AuthService;
import com.tidecanvas.service.TeamService;
import com.tidecanvas.service.security.VerificationCodeService;
import com.tidecanvas.util.IpUtil;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.BeanUtils;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.concurrent.ThreadLocalRandom;

@Service
@RequiredArgsConstructor
public class AuthServiceImpl implements AuthService {

    private final SysUserMapper userMapper;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider jwtTokenProvider;
    private final VerificationCodeService verificationCodeService;
    private final TeamService teamService;
    private final LoginLogMapper loginLogMapper;

    private static final int DEFAULT_API_QUOTA = 100;
    private static final long DEFAULT_STORAGE_QUOTA = 1073741824L;
    private static final ZoneId BEIJING_ZONE = ZoneId.of("Asia/Shanghai");
    private static final int MAX_UA = 500;

    @Override
    public void sendEmailCode(String email) {
        verificationCodeService.sendEmailCode(email);
    }

    @Override
    public UserVO register(UserRegisterDTO dto) {
        // 先校验邮箱验证码
        verificationCodeService.verifyEmailCode(dto.getEmail(), dto.getCode());

        Long emailCount = userMapper.selectCount(
                new LambdaQueryWrapper<SysUserDO>().eq(SysUserDO::getEmail, dto.getEmail()));
        if (emailCount > 0) {
            throw new BusinessException(ResultCode.EMAIL_EXISTS);
        }

        // 用户名：显式提供则校验唯一；未提供则由邮箱前缀推导唯一用户名
        String username;
        if (StringUtils.hasText(dto.getUsername())) {
            Long usernameCount = userMapper.selectCount(
                    new LambdaQueryWrapper<SysUserDO>().eq(SysUserDO::getUsername, dto.getUsername()));
            if (usernameCount > 0) {
                throw new BusinessException(ResultCode.USERNAME_EXISTS);
            }
            username = dto.getUsername();
        } else {
            username = deriveUsername(dto.getEmail());
        }

        SysUserDO user = new SysUserDO();
        user.setUsername(username);
        user.setEmail(dto.getEmail());
        user.setPassword(passwordEncoder.encode(dto.getPassword()));
        user.setNickname(StringUtils.hasText(dto.getNickname()) ? dto.getNickname() : username);
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
            recordLogin(dto.getAccount(), null, null, false, "账号不存在");
            throw new BusinessException(ResultCode.ACCOUNT_NOT_FOUND);
        }
        if (user.getStatus() == 0) {
            recordLogin(dto.getAccount(), user.getId(), user.getUsername(), false, "账号已禁用");
            throw new BusinessException(ResultCode.ACCOUNT_DISABLED);
        }
        if (!passwordEncoder.matches(dto.getPassword(), user.getPassword())) {
            recordLogin(dto.getAccount(), user.getId(), user.getUsername(), false, "密码错误");
            throw new BusinessException(ResultCode.PASSWORD_INCORRECT);
        }

        user.setLastLoginTime(LocalDateTime.now(BEIJING_ZONE));
        userMapper.updateById(user);
        recordLogin(dto.getAccount(), user.getId(), user.getUsername(), true, null);

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
        // 只接受 refresh token：access token 不能用于刷新（令牌分层）
        if (!jwtTokenProvider.validateToken(dto.getRefreshToken())
                || !jwtTokenProvider.isRefreshToken(dto.getRefreshToken())) {
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

    /** 由邮箱前缀推导唯一用户名（冲突则追加随机数字） */
    private String deriveUsername(String email) {
        String base = email.contains("@") ? email.substring(0, email.indexOf('@')) : email;
        base = base.replaceAll("[^a-zA-Z0-9_]", "");
        if (base.length() < 3) {
            base = "user" + base;
        }
        if (base.length() > 50) {
            base = base.substring(0, 50);
        }
        String candidate = base;
        int tries = 0;
        while (tries < 20 && userMapper.selectCount(
                new LambdaQueryWrapper<SysUserDO>().eq(SysUserDO::getUsername, candidate)) > 0) {
            candidate = base + ThreadLocalRandom.current().nextInt(1000, 10000);
            tries++;
        }
        return candidate;
    }

    /** 记录登录日志(成功/失败),失败不影响主流程。account 为用户尝试输入的账号,账号不存在时用它兜底 username */
    private void recordLogin(String account, Long userId, String username, boolean success, String failReason) {
        try {
            LoginLogDO logDO = new LoginLogDO();
            logDO.setUserId(userId);
            logDO.setUsername(StringUtils.hasText(username) ? username : account);
            logDO.setStatus(success ? 1 : 0);
            logDO.setFailReason(failReason);
            ServletRequestAttributes attrs = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
            if (attrs != null) {
                HttpServletRequest request = attrs.getRequest();
                logDO.setIp(IpUtil.getClientIp(request));
                String ua = request.getHeader("User-Agent");
                logDO.setUserAgent(ua != null && ua.length() > MAX_UA ? ua.substring(0, MAX_UA) : ua);
            }
            logDO.setCreateTime(LocalDateTime.now(BEIJING_ZONE));
            loginLogMapper.insert(logDO);
        } catch (Exception ignore) {
            // 登录日志记录失败不影响登录
        }
    }

    private UserVO toUserVO(SysUserDO user) {
        UserVO vo = new UserVO();
        BeanUtils.copyProperties(user, vo); // teamId 同名自动拷贝
        boolean inTeam = user.getTeamId() != null;
        vo.setInTeam(inTeam);
        // 仅团队用户多查一次配置；非团队用户系数恒为 1，避免额外查询
        vo.setTeamPriceFactor(inTeam ? teamService.getPriceFactor(user.getId()) : BigDecimal.ONE);
        return vo;
    }
}

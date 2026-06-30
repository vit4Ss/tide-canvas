package com.tidecanvas.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tidecanvas.common.Result;
import com.tidecanvas.common.ResultCode;
import com.tidecanvas.exception.BusinessException;
import com.tidecanvas.mapper.SysUserMapper;
import com.tidecanvas.model.entity.SysUserDO;
import com.tidecanvas.model.vo.LoginVO;
import com.tidecanvas.model.vo.UserVO;
import com.tidecanvas.security.JwtTokenProvider;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Slf4j
@Tag(name = "第三方登录")
@RestController
@RequestMapping("/api/auth/oauth")
@RequiredArgsConstructor
public class OAuthController {

    private final SysUserMapper userMapper;
    private final JwtTokenProvider jwtTokenProvider;
    private final PasswordEncoder passwordEncoder;
    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate = new RestTemplate();

    @Value("${oauth.github.client-id:}")
    private String githubClientId;
    @Value("${oauth.github.client-secret:}")
    private String githubClientSecret;

    @Value("${oauth.google.client-id:}")
    private String googleClientId;
    @Value("${oauth.google.client-secret:}")
    private String googleClientSecret;

    @Value("${oauth.wechat.app-id:}")
    private String wechatAppId;
    @Value("${oauth.wechat.app-secret:}")
    private String wechatAppSecret;

    // ==================== GitHub ====================

    @Operation(summary = "GitHub OAuth 回调")
    @PostMapping("/github")
    public Result<LoginVO> githubCallback(@RequestBody Map<String, String> body) {
        String code = requireCode(body);
        requireConfig(githubClientId, githubClientSecret, "GitHub");

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setAccept(List.of(MediaType.APPLICATION_JSON));

        Map<String, String> tokenBody = Map.of(
                "client_id", githubClientId,
                "client_secret", githubClientSecret,
                "code", code
        );
        String accessToken = exchangeToken(
                "https://github.com/login/oauth/access_token",
                new HttpEntity<>(tokenBody, headers),
                "access_token", "GitHub"
        );

        HttpHeaders userHeaders = new HttpHeaders();
        userHeaders.setBearerAuth(accessToken);
        JsonNode userJson = fetchUserInfo("https://api.github.com/user", userHeaders, "GitHub");

        String login = userJson.get("login").asText();
        String email = userJson.has("email") && !userJson.get("email").isNull()
                ? userJson.get("email").asText() : login + "@github.tidecanvas.com";
        String avatar = textOrNull(userJson, "avatar_url");
        String nickname = textOrNull(userJson, "name");

        SysUserDO user = findOrCreateOAuthUser("gh_" + login, email, nickname != null ? nickname : login, avatar);
        return Result.success(buildLoginVO(user));
    }

    // ==================== Google ====================

    @Operation(summary = "Google OAuth 回调")
    @PostMapping("/google")
    public Result<LoginVO> googleCallback(@RequestBody Map<String, String> body) {
        String code = requireCode(body);
        String redirectUri = body.getOrDefault("redirectUri", "");
        requireConfig(googleClientId, googleClientSecret, "Google");

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

        MultiValueMap<String, String> tokenBody = new LinkedMultiValueMap<>();
        tokenBody.add("code", code);
        tokenBody.add("client_id", googleClientId);
        tokenBody.add("client_secret", googleClientSecret);
        tokenBody.add("redirect_uri", redirectUri);
        tokenBody.add("grant_type", "authorization_code");

        String accessToken = exchangeToken(
                "https://oauth2.googleapis.com/token",
                new HttpEntity<>(tokenBody, headers),
                "access_token", "Google"
        );

        HttpHeaders userHeaders = new HttpHeaders();
        userHeaders.setBearerAuth(accessToken);
        JsonNode userJson = fetchUserInfo("https://www.googleapis.com/oauth2/v2/userinfo", userHeaders, "Google");

        String googleId = userJson.get("id").asText();
        String email = textOrNull(userJson, "email");
        String nickname = textOrNull(userJson, "name");
        String avatar = textOrNull(userJson, "picture");

        if (email == null) {
            email = googleId + "@google.tidecanvas.com";
        }

        SysUserDO user = findOrCreateOAuthUser("gg_" + googleId, email, nickname != null ? nickname : googleId, avatar);
        return Result.success(buildLoginVO(user));
    }

    // ==================== WeChat ====================

    @Operation(summary = "微信 OAuth 回调")
    @PostMapping("/wechat")
    public Result<LoginVO> wechatCallback(@RequestBody Map<String, String> body) {
        String code = requireCode(body);
        requireConfig(wechatAppId, wechatAppSecret, "微信");

        String tokenUrl = String.format(
                "https://api.weixin.qq.com/sns/oauth2/access_token?appid=%s&secret=%s&code=%s&grant_type=authorization_code",
                wechatAppId, wechatAppSecret, code
        );
        JsonNode tokenJson = getForJson(tokenUrl, "微信");

        if (tokenJson.has("errcode") && tokenJson.get("errcode").asInt() != 0) {
            throw new BusinessException(ResultCode.SERVER_ERROR, "微信授权失败: " + tokenJson.get("errmsg").asText());
        }

        String wxAccessToken = tokenJson.get("access_token").asText();
        String openid = tokenJson.get("openid").asText();

        String userUrl = String.format(
                "https://api.weixin.qq.com/sns/userinfo?access_token=%s&openid=%s&lang=zh_CN",
                wxAccessToken, openid
        );
        JsonNode userJson = getForJson(userUrl, "微信");

        String nickname = textOrNull(userJson, "nickname");
        String avatar = textOrNull(userJson, "headimgurl");
        String unionid = textOrNull(userJson, "unionid");

        String uniqueId = unionid != null ? unionid : openid;

        SysUserDO user = findOrCreateOAuthUser(
                "wx_" + uniqueId,
                uniqueId + "@wechat.tidecanvas.com",
                nickname != null ? nickname : "微信用户",
                avatar
        );
        return Result.success(buildLoginVO(user));
    }

    // ==================== 公共方法 ====================

    private String requireCode(Map<String, String> body) {
        String code = body.get("code");
        if (code == null || code.isBlank()) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "code不能为空");
        }
        return code;
    }

    private void requireConfig(String clientId, String secret, String provider) {
        if (clientId.isBlank() || secret.isBlank()) {
            throw new BusinessException(ResultCode.SERVER_ERROR, provider + " OAuth未配置，请联系管理员");
        }
    }

    private String exchangeToken(String url, HttpEntity<?> entity, String tokenField, String provider) {
        try {
            ResponseEntity<String> resp = restTemplate.postForEntity(url, entity, String.class);
            JsonNode json = objectMapper.readTree(resp.getBody());
            if (json.has(tokenField)) {
                return json.get(tokenField).asText();
            }
            log.error("{} token exchange response: {}", provider, resp.getBody());
            throw new BusinessException(ResultCode.SERVER_ERROR, provider + "授权失败");
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            log.error("{} token exchange failed", provider, e);
            throw new BusinessException(ResultCode.SERVER_ERROR, provider + "授权失败");
        }
    }

    private JsonNode fetchUserInfo(String url, HttpHeaders headers, String provider) {
        try {
            ResponseEntity<String> resp = restTemplate.exchange(url, HttpMethod.GET, new HttpEntity<>(headers), String.class);
            return objectMapper.readTree(resp.getBody());
        } catch (Exception e) {
            log.error("{} user info fetch failed", provider, e);
            throw new BusinessException(ResultCode.SERVER_ERROR, "获取" + provider + "用户信息失败");
        }
    }

    private JsonNode getForJson(String url, String provider) {
        try {
            String resp = restTemplate.getForObject(url, String.class);
            return objectMapper.readTree(resp);
        } catch (Exception e) {
            log.error("{} API call failed: {}", provider, url, e);
            throw new BusinessException(ResultCode.SERVER_ERROR, provider + "接口调用失败");
        }
    }

    private String textOrNull(JsonNode node, String field) {
        return node.has(field) && !node.get(field).isNull() ? node.get(field).asText() : null;
    }

    private SysUserDO findOrCreateOAuthUser(String oauthUsername, String email, String nickname, String avatar) {
        SysUserDO user = userMapper.selectByAccount(oauthUsername);
        if (user == null) {
            user = userMapper.selectByAccount(email);
        }
        if (user == null) {
            user = new SysUserDO();
            user.setUsername(oauthUsername);
            user.setEmail(email);
            user.setPassword(passwordEncoder.encode(UUID.randomUUID().toString()));
            user.setNickname(nickname);
            user.setAvatar(avatar);
            user.setRole(0);
            user.setStatus(1);
            user.setApiQuota(100);
            user.setStorageQuota(1073741824L);
            user.setDeleted(0);
            userMapper.insert(user);
        } else {
            if (avatar != null) {
                user.setAvatar(avatar);
            }
            user.setLastLoginTime(LocalDateTime.now());
            userMapper.updateById(user);
        }
        return user;
    }

    private LoginVO buildLoginVO(SysUserDO user) {
        LoginVO vo = new LoginVO();
        vo.setAccessToken(jwtTokenProvider.generateAccessToken(user.getId(), user.getUsername(), user.getRole()));
        vo.setRefreshToken(jwtTokenProvider.generateRefreshToken(user.getId()));
        vo.setExpiresIn(jwtTokenProvider.getAccessTokenExpiration());
        UserVO userVO = new UserVO();
        BeanUtils.copyProperties(user, userVO);
        vo.setUserInfo(userVO);
        return vo;
    }
}

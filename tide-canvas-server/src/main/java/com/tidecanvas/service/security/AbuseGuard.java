package com.tidecanvas.service.security;

import com.tidecanvas.annotation.LimitDimension;
import com.tidecanvas.common.ResultCode;
import com.tidecanvas.config.SecurityRateLimitProperties;
import com.tidecanvas.exception.BusinessException;
import com.tidecanvas.model.vo.BanInfoVO;
import com.tidecanvas.service.ai.GenerationLogRecorder;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/**
 * 反刷流核心：固定窗口计数 + 违规累计 + 冷却封禁 + 告警记录 + 后台手动封/解封。
 * <p>
 * Redis key：{@code rl:{name}:{actor}} 计数（窗口 TTL）、{@code rlv:{name}:{actor}} 违规累计
 * （封禁窗口 TTL）、{@code rlban:{actor}} 封禁（冷却 TTL，跨接口全局生效）。
 * actor 形如 {@code u{userId}} 或 {@code ip{ip}}。被封禁期间所有受保护接口直接拒绝。
 *
 * @author tidecanvas
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AbuseGuard {

    private final RedisTemplate<String, Object> redisTemplate;
    private final GenerationLogRecorder generationLogRecorder;
    private final SecurityRateLimitProperties props;

    private static final String BAN_PREFIX = "rlban:";

    /** 按维度执行限流；超限抛 {@link ResultCode#RATE_LIMIT}，并按需累计违规、触发冷却封禁。 */
    public void enforce(String name, Long userId, String ip, LimitDimension dim,
                        int limit, int period, int banThreshold, int banSeconds) {
        if (!props.isEnabled()) {
            return;
        }
        List<Actor> actors = actorsFor(dim, userId, ip);
        if (actors.isEmpty()) {
            return; // 无法判定维度（匿名且无 IP）→ 放行，避免误伤
        }
        // 1) 已封禁直接拒绝
        for (Actor a : actors) {
            if (isBanned(a.key())) {
                throw new BusinessException(ResultCode.RATE_LIMIT, "操作过于频繁，已被暂时限制，请稍后再试");
            }
        }
        // 2) 计数
        for (Actor a : actors) {
            String counterKey = "rl:" + name + ":" + a.key();
            Long count = redisTemplate.opsForValue().increment(counterKey);
            if (count != null && count == 1L) {
                redisTemplate.expire(counterKey, period, TimeUnit.SECONDS);
            }
            if (count != null && count > limit) {
                onViolation(name, a, userId, ip, banThreshold, banSeconds);
                throw new BusinessException(ResultCode.RATE_LIMIT);
            }
        }
    }

    /** 超限一次：累计违规；达到阈值则冷却封禁并记录告警（仅在封禁那一刻记录，避免刷屏）。 */
    private void onViolation(String name, Actor a, Long userId, String ip, int banThreshold, int banSeconds) {
        if (banThreshold <= 0) {
            return;
        }
        String vk = "rlv:" + name + ":" + a.key();
        Long v = redisTemplate.opsForValue().increment(vk);
        if (v != null && v == 1L) {
            redisTemplate.expire(vk, props.getBanWindowSeconds(), TimeUnit.SECONDS);
        }
        if (v != null && v >= banThreshold && !isBanned(a.key())) {
            String reason = "接口[" + name + "] " + props.getBanWindowSeconds() + "s 内违规 " + v + " 次，自动封禁 " + banSeconds + "s";
            doBan(a.key(), banSeconds, reason);
            recordAbuse(userId, a, ip, name, reason);
            log.warn("反刷流封禁: actor={}, name={}, ip={}, reason={}", a.key(), name, ip, reason);
        }
    }

    public boolean isBanned(String actorKey) {
        return Boolean.TRUE.equals(redisTemplate.hasKey(BAN_PREFIX + actorKey));
    }

    private void doBan(String actorKey, long seconds, String reason) {
        redisTemplate.opsForValue().set(BAN_PREFIX + actorKey, reason, seconds, TimeUnit.SECONDS);
    }

    private void recordAbuse(Long userId, Actor a, String ip, String name, String reason) {
        String op = "[" + name + "] " + a.type() + ":" + a.value() + (StringUtils.hasText(ip) ? " ip=" + ip : "");
        generationLogRecorder.recordOperation("abuse_block", userId, null, op, false, null, reason);
    }

    // ===== 后台：列出 / 手动封禁 / 解封 =====

    public List<BanInfoVO> listBans() {
        List<BanInfoVO> out = new ArrayList<>();
        Set<String> keys = redisTemplate.keys(BAN_PREFIX + "*");
        if (keys == null) {
            return out;
        }
        for (String k : keys) {
            String actor = k.substring(BAN_PREFIX.length());
            Object reason = redisTemplate.opsForValue().get(k);
            Long ttl = redisTemplate.getExpire(k, TimeUnit.SECONDS);
            BanInfoVO vo = new BanInfoVO();
            vo.setActor(actor);
            if (actor.startsWith("ip")) {
                vo.setType("ip");
                vo.setValue(actor.substring(2));
            } else if (actor.startsWith("u")) {
                vo.setType("user");
                vo.setValue(actor.substring(1));
            } else {
                vo.setType("other");
                vo.setValue(actor);
            }
            vo.setReason(reason == null ? null : reason.toString());
            vo.setExpireSeconds(ttl == null ? 0 : ttl);
            out.add(vo);
        }
        return out;
    }

    public void manualBan(String type, String value, Long seconds, String reason) {
        Actor a = new Actor(type, value);
        long secs = seconds != null && seconds > 0 ? seconds : props.getDefaultBanSeconds();
        String r = StringUtils.hasText(reason) ? "管理员封禁:" + reason : "管理员手动封禁";
        doBan(a.key(), secs, r);
        Long uid = "user".equals(type) ? parseLong(value) : null;
        recordAbuse(uid, a, null, "manual", r);
        log.warn("管理员手动封禁: actor={}, seconds={}, reason={}", a.key(), secs, r);
    }

    public void unban(String actor) {
        if (StringUtils.hasText(actor)) {
            redisTemplate.delete(BAN_PREFIX + actor);
        }
    }

    private List<Actor> actorsFor(LimitDimension dim, Long userId, String ip) {
        List<Actor> list = new ArrayList<>(2);
        boolean wantUser = dim == LimitDimension.USER || dim == LimitDimension.USER_AND_IP;
        boolean wantIp = dim == LimitDimension.IP || dim == LimitDimension.USER_AND_IP;
        if (wantUser && userId != null) {
            list.add(new Actor("user", userId.toString()));
        }
        if (wantIp && StringUtils.hasText(ip)) {
            list.add(new Actor("ip", ip));
        }
        // USER 维度但匿名（无 userId）→ 退化为 IP，避免无维度放行被绕过
        if (list.isEmpty() && StringUtils.hasText(ip)) {
            list.add(new Actor("ip", ip));
        }
        return list;
    }

    private static Long parseLong(String s) {
        try {
            return Long.valueOf(s);
        } catch (Exception e) {
            return null;
        }
    }

    /** 限流主体；key 形如 u123 / ip1.2.3.4 */
    private record Actor(String type, String value) {
        String key() {
            return "ip".equals(type) ? "ip" + value : "u" + value;
        }
    }
}

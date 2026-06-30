-- =============================================================
-- Migration 008 | 2026-06-30 | Password reset flow
-- -------------------------------------------------------------
-- 功能 : 新增 password_reset_token 表，并内置 password_reset 邮件模板。
-- 依赖 : baseline 已存在 sys_user / email_template。
-- 幂等 : 是。表使用 CREATE TABLE IF NOT EXISTS；模板按 template_code UPSERT。
-- 可重复执行 : 可以。
-- =============================================================
USE tide_canvas;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `password_reset_token` (
    `id`          BIGINT       NOT NULL COMMENT '主键(雪花ID,应用层生成)',
    `user_id`     BIGINT       NOT NULL COMMENT '用户ID(sys_user.id)',
    `email`       VARCHAR(128) NOT NULL COMMENT '请求重置的邮箱快照',
    `token_hash`  CHAR(64)     CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL COMMENT 'SHA-256(token)十六进制摘要,不保存明文token',
    `expires_at`  DATETIME     NOT NULL COMMENT '过期时间',
    `used_at`     DATETIME     DEFAULT NULL COMMENT '使用/作废时间;NULL表示未使用',
    `request_ip`  VARCHAR(64)  DEFAULT NULL COMMENT '请求IP',
    `user_agent`  VARCHAR(500) DEFAULT NULL COMMENT '请求User-Agent',
    `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_token_hash` (`token_hash`),
    KEY `idx_user_unused` (`user_id`, `used_at`, `expires_at`),
    KEY `idx_expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='密码重置令牌表';

INSERT INTO `email_template` (`id`, `template_code`, `template_name`, `subject`, `content`, `variables`, `enabled`, `remark`, `deleted`) VALUES
(202606300008, 'password_reset', '密码重置', '{{siteName}} 密码重置',
'<div style="margin:0;padding:24px;background-color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e5;">
    <div style="background:#171717;padding:20px 28px;">
      <span style="color:#ffffff;font-size:18px;font-weight:700;">{{siteName}}</span>
    </div>
    <div style="padding:28px;">
      <p style="margin:0 0 8px;font-size:16px;color:#171717;font-weight:600;">您好，</p>
      <p style="margin:0 0 20px;font-size:14px;color:#525252;line-height:1.6;">您正在重置 {{siteName}} 账号（{{email}}）的登录密码。</p>
      <p style="margin:0 0 22px;text-align:center;">
        <a href="{{resetUrl}}" style="display:inline-block;padding:12px 24px;background:#171717;border-radius:8px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;">重置密码</a>
      </p>
      <p style="margin:0;font-size:13px;color:#737373;line-height:1.6;">链接 {{ttlMinutes}} 分钟内有效。如果按钮无法打开，请复制以下链接到浏览器：</p>
      <p style="margin:10px 0 0;word-break:break-all;font-size:12px;color:#525252;line-height:1.6;">{{resetUrl}}</p>
    </div>
    <div style="padding:16px 28px;background:#fafafa;border-top:1px solid #f0f0f0;">
      <p style="margin:0;font-size:12px;color:#a3a3a3;">如非本人操作，请忽略本邮件。此邮件由系统自动发送，请勿直接回复。</p>
    </div>
  </div>
</div>',
'[{"name":"siteName","description":"站点名称","sample":"TideCanvas"},{"name":"resetUrl","description":"密码重置链接","sample":"https://example.com/reset-password?token=xxx"},{"name":"ttlMinutes","description":"有效期(分钟)","sample":"30"},{"name":"email","description":"收件人邮箱","sample":"user@example.com"}]',
1, '用户忘记密码时发送的一次性重置链接邮件', 0)
ON DUPLICATE KEY UPDATE
    `template_name` = VALUES(`template_name`),
    `subject` = VALUES(`subject`),
    `content` = VALUES(`content`),
    `variables` = VALUES(`variables`),
    `remark` = VALUES(`remark`),
    `deleted` = 0;

-- ============================================================
-- 增量迁移:易支付配置 + 邮件模板(2026-06)
-- 适用:已用旧版 init.sql 初始化的存量库;幂等,可重复执行。
-- 新库无需执行(init.sql 已包含全部内容)。
-- ============================================================

-- 1. 易支付配置项(依赖 uk_config_key 唯一键,已存在则跳过)
INSERT IGNORE INTO `sys_config` (`id`, `config_key`, `config_value`, `description`, `deleted`) VALUES
(12, 'pay.epay.enabled',              'false',               '易支付:是否启用在线支付',                                          0),
(13, 'pay.epay.gateway',              'https://api.ndow.cn', '易支付:网关地址',                                                 0),
(14, 'pay.epay.pid',                  '',                    '易支付:商户ID',                                                   0),
(15, 'pay.epay.merchant_private_key', '',                    '易支付:商户RSA私钥(商户后台生成,Base64,可带PEM头尾)',              0),
(16, 'pay.epay.platform_public_key',  '',                    '易支付:平台RSA公钥(用于回调验签)',                                 0),
(17, 'pay.epay.notify_url',           '',                    '易支付:异步通知地址(公网可达,如 https://你的域名/api/orders/notify/epay)', 0),
(18, 'pay.epay.return_url',           '',                    '易支付:支付完成跳转地址(如 https://你的域名/user/orders)',          0),
(19, 'pay.epay.pay_types',            'alipay,wxpay',        '易支付:启用的支付方式(逗号分隔)',                                  0);

-- 2. 邮件模板表
CREATE TABLE IF NOT EXISTS `email_template` (
    `id`            BIGINT        NOT NULL COMMENT '主键',
    `template_code` VARCHAR(64)   NOT NULL COMMENT '模板编码(系统内置)',
    `template_name` VARCHAR(64)   NOT NULL COMMENT '模板名称',
    `subject`       VARCHAR(256)  NOT NULL COMMENT '邮件主题(支持{{变量}})',
    `content`       MEDIUMTEXT    NOT NULL COMMENT '邮件正文HTML(支持{{变量}})',
    `variables`     VARCHAR(1024) DEFAULT NULL COMMENT '可用变量JSON[{name,description,sample}]',
    `enabled`       TINYINT       NOT NULL DEFAULT 1 COMMENT '是否启用(0停用时回退内置文案)',
    `remark`        VARCHAR(256)  DEFAULT NULL COMMENT '备注',
    `create_time`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted`       TINYINT       NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_template_code` (`template_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='邮件模板表';

-- 3. 预置注册验证码模板(依赖 uk_template_code,已存在则跳过)
INSERT IGNORE INTO `email_template` (`id`, `template_code`, `template_name`, `subject`, `content`, `variables`, `enabled`, `remark`, `deleted`) VALUES
(1, 'register_code', '注册验证码', '{{siteName}} 注册验证码',
'<div style="margin:0;padding:24px;background-color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e5;">
    <div style="background:#171717;padding:20px 28px;">
      <span style="color:#ffffff;font-size:18px;font-weight:700;">{{siteName}}</span>
    </div>
    <div style="padding:28px;">
      <p style="margin:0 0 8px;font-size:16px;color:#171717;font-weight:600;">您好，</p>
      <p style="margin:0 0 20px;font-size:14px;color:#525252;line-height:1.6;">您正在注册 {{siteName}} 账号（{{email}}），本次验证码为：</p>
      <div style="text-align:center;margin:0 0 20px;">
        <span style="display:inline-block;padding:12px 32px;background:#fafafa;border:1px dashed #d4d4d4;border-radius:8px;font-size:30px;font-weight:700;letter-spacing:8px;color:#171717;">{{code}}</span>
      </div>
      <p style="margin:0;font-size:13px;color:#737373;line-height:1.6;">验证码 {{ttlMinutes}} 分钟内有效，请勿泄露给他人。如非本人操作，请忽略本邮件。</p>
    </div>
    <div style="padding:16px 28px;background:#fafafa;border-top:1px solid #f0f0f0;">
      <p style="margin:0;font-size:12px;color:#a3a3a3;">此邮件由系统自动发送，请勿直接回复。</p>
    </div>
  </div>
</div>',
'[{"name":"code","description":"6位数字验证码","sample":"123456"},{"name":"siteName","description":"站点名称","sample":"TideCanvas"},{"name":"ttlMinutes","description":"有效期(分钟)","sample":"5"},{"name":"email","description":"收件人邮箱","sample":"user@example.com"}]',
1, '用户注册时发送的邮箱验证码邮件', 0);

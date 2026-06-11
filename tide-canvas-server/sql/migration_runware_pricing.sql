-- =============================================================
-- Runware 供应商接入 + 定价格式升级
-- 执行对象：已有存量库（新库直接用 init.sql 即可，无需本脚本）
-- =============================================================

-- 1. 模型积分定价支持小数（Runware 等按 USD 计价的供应商换算后常为小数积分）。
--    结算规则不变处：仍为「单价 × 张数 × 团队系数」，最后总价向上取整为整数积分入账。
ALTER TABLE `ai_model`
    MODIFY COLUMN `point_cost` DECIMAL(10,2) NOT NULL DEFAULT 10.00 COMMENT '每次调用消耗积分(支持小数,结算按总价向上取整)';

-- 2.（说明）`ai_model.cost_per_call` DECIMAL(10,4) 既有列启用为「上游成本价(USD)」参考字段：
--    管理后台模型表单可录入，仅管理端接口返回，用户侧已脱敏。无需结构变更。

-- 3.（说明）`ai_provider.provider_type` 新增取值 'runware'：
--    该类型供应商走 Runware 原生任务数组协议（baseUrl 配 https://api.runware.ai/v1），
--    其余类型仍走中转站统一协议。无需结构变更。
--
--    示例：
--    INSERT INTO `ai_provider` (`id`, `name`, `provider_type`, `api_key`, `base_url`, `status`, `priority`, `rate_limit`, `deleted`)
--    VALUES (你的雪花ID, 'Runware', 'runware', '你的APIKey', 'https://api.runware.ai/v1', 1, 10, 60, 0);

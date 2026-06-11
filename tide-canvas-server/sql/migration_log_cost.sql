-- =============================================================
-- 任务执行记录：上游成本(USD)结构化
-- 执行对象：已有存量库（新库直接用 init.sql 即可，无需本脚本）
-- =============================================================
-- 背景：Runware 等供应商在请求里带 includeCost=true 后，响应会返回每次调用的实际美元成本。
--       此前该值只保留在 ai_generation_log.response_body 的 JSON 文本里，无法排序/汇总/对账。
--       新增独立 cost 列，由 RunwareClient 解析响应 data[].cost 求和后写入；
--       中转站(OpenAI 风格)响应无 cost 字段，该列留空，前端展示为「-」。

ALTER TABLE `ai_generation_log`
    ADD COLUMN `cost` DECIMAL(10,4) DEFAULT NULL
    COMMENT '上游成本(USD,如Runware includeCost返回;中转站无此字段则为空)'
    AFTER `duration_ms`;

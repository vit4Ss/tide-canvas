-- rewrite-cdn-urls-prod.sql
-- 生产库历史 URL 清洗:测试桶/历史加速域名 → 生产 CDN,单遍完成。
-- 前提:历史桶对象已按原 key 复制到当前生产桶(替换后 = 生产 CDN → 生产桶)。
-- 已在生产库实跑验证;含 utf8mb4 排序规则冲突修复(COLLATE utf8mb4_bin,
-- 兼容 unicode_ci 与 0900_ai_ci 混存的导入库)。
-- 可重入;回滚 = @oldN/@new 对调重跑。
--
-- 执行: mysql -h127.0.0.1 -uroot -p canvas < rewrite-cdn-urls-prod.sql

SET @new  = 'https://cdn.mbfczzzz.top';
SET @old1 = 'https://flowlinght-test.oss-cn-shanghai.aliyuncs.com';
SET @old2 = 'https://scaecrowtoken-test.oss-accelerate.aliyuncs.com';
-- 还有别的老 host 就在每条 REPLACE 链上照样续一段,并在 WHERE 里 OR 一个条件。

START TRANSACTION;

UPDATE users SET avatar = REPLACE(REPLACE(avatar, @old1, @new), @old2, @new)
 WHERE avatar LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin
    OR avatar LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;

UPDATE files SET file_url = REPLACE(REPLACE(file_url, @old1, @new), @old2, @new)
 WHERE file_url LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin
    OR file_url LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;

UPDATE projects SET canvas_data = REPLACE(REPLACE(canvas_data, @old1, @new), @old2, @new)
 WHERE canvas_data LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin
    OR canvas_data LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;

UPDATE ai_tasks SET input = REPLACE(REPLACE(input, @old1, @new), @old2, @new)
 WHERE input LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin OR input LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;
UPDATE ai_tasks SET result_url = REPLACE(REPLACE(result_url, @old1, @new), @old2, @new)
 WHERE result_url LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin OR result_url LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;
UPDATE ai_tasks SET result_meta = REPLACE(REPLACE(result_meta, @old1, @new), @old2, @new)
 WHERE result_meta LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin OR result_meta LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;

UPDATE ai_generation_logs SET request_url = REPLACE(REPLACE(request_url, @old1, @new), @old2, @new)
 WHERE request_url LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin OR request_url LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;
UPDATE ai_generation_logs SET request_body = REPLACE(REPLACE(request_body, @old1, @new), @old2, @new)
 WHERE request_body LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin OR request_body LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;
UPDATE ai_generation_logs SET input_params = REPLACE(REPLACE(input_params, @old1, @new), @old2, @new)
 WHERE input_params LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin OR input_params LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;
UPDATE ai_generation_logs SET response_body = REPLACE(REPLACE(response_body, @old1, @new), @old2, @new)
 WHERE response_body LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin OR response_body LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;
UPDATE ai_generation_logs SET result_url = REPLACE(REPLACE(result_url, @old1, @new), @old2, @new)
 WHERE result_url LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin OR result_url LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;

UPDATE model_call_log SET request_body = REPLACE(REPLACE(request_body, @old1, @new), @old2, @new)
 WHERE request_body LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin OR request_body LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;
UPDATE model_call_log SET response_body = REPLACE(REPLACE(response_body, @old1, @new), @old2, @new)
 WHERE response_body LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin OR response_body LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;

UPDATE im_message SET content = REPLACE(REPLACE(content, @old1, @new), @old2, @new)
 WHERE content LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin OR content LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;
UPDATE im_message SET params = REPLACE(REPLACE(params, @old1, @new), @old2, @new)
 WHERE params LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin OR params LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;

UPDATE community_post SET cover_url = REPLACE(REPLACE(cover_url, @old1, @new), @old2, @new)
 WHERE cover_url LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin OR cover_url LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;
UPDATE community_post SET content = REPLACE(REPLACE(content, @old1, @new), @old2, @new)
 WHERE content LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin OR content LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;

UPDATE blog_post SET cover_url = REPLACE(REPLACE(cover_url, @old1, @new), @old2, @new)
 WHERE cover_url LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin OR cover_url LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;
UPDATE blog_post SET content = REPLACE(REPLACE(content, @old1, @new), @old2, @new)
 WHERE content LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin OR content LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;

UPDATE market_model SET cover_url = REPLACE(REPLACE(cover_url, @old1, @new), @old2, @new)
 WHERE cover_url LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin OR cover_url LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;
UPDATE market_model SET config = REPLACE(REPLACE(config, @old1, @new), @old2, @new)
 WHERE config LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin OR config LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;

UPDATE skill SET cover_url = REPLACE(REPLACE(cover_url, @old1, @new), @old2, @new)
 WHERE cover_url LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin OR cover_url LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;
UPDATE style_preset SET cover_url = REPLACE(REPLACE(cover_url, @old1, @new), @old2, @new)
 WHERE cover_url LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin OR cover_url LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;
UPDATE collection SET cover_url = REPLACE(REPLACE(cover_url, @old1, @new), @old2, @new)
 WHERE cover_url LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin OR cover_url LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;
UPDATE prompt_lib SET cover_url = REPLACE(REPLACE(cover_url, @old1, @new), @old2, @new)
 WHERE cover_url LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin OR cover_url LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;

UPDATE sys_config SET config_value = REPLACE(REPLACE(config_value, @old1, @new), @old2, @new)
 WHERE config_value LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin OR config_value LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;

UPDATE notification SET content = REPLACE(REPLACE(content, @old1, @new), @old2, @new)
 WHERE content LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin OR content LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;
UPDATE notification SET link_url = REPLACE(REPLACE(link_url, @old1, @new), @old2, @new)
 WHERE link_url LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin OR link_url LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;

COMMIT;

-- 验证(各行 c 应全为 0)
SELECT 'files' t, COUNT(*) c FROM files
 WHERE file_url LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin
    OR file_url LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin
UNION ALL
SELECT 'ai_tasks', COUNT(*) FROM ai_tasks
 WHERE result_url LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin
    OR result_url LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin
UNION ALL
SELECT 'projects', COUNT(*) FROM projects
 WHERE canvas_data LIKE CONCAT('%', @old1, '%') COLLATE utf8mb4_bin
    OR canvas_data LIKE CONCAT('%', @old2, '%') COLLATE utf8mb4_bin;

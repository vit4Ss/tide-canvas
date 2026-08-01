-- rewrite-cdn-urls.sql
-- 【通用版】把全库文本列里的旧存储域名改写为新域名(不限定具体 host)。
--
-- 适用:换 CDN 域名 / 换桶后的历史数据清洗。自 middleware.DisplayURL +
-- storage.ossLegacyHosts 上线后,网页展示在读时会自动改写,本脚本仅用于:
--   - 让 DB 存量保持整洁(直连 DB 的其它消费者/导出场景)
--   - 一次性对齐历史数据
-- 不跑也不影响线上展示。含 utf8mb4 排序规则冲突修复(COLLATE utf8mb4_bin)。
--
-- 用法:
--   1) 按实际改 @old / @new;不确定旧 host 就先跑 ① 查出来
--   2) 跑 ② 生成 UPDATE 语句,确认后执行生成的语句
--   3) 跑 ③ 验证残留为 0
-- 可回滚:把 @old/@new 对调再跑一遍即可。

-- ① 先看库里实际出现了哪些存储 host(以 file_url 为样本)
-- SELECT SUBSTRING_INDEX(SUBSTRING_INDEX(file_url, '/', 3), '/', -1) AS host,
--        COUNT(*) c FROM files WHERE file_url LIKE 'http%' GROUP BY host ORDER BY c DESC;

SET @old = 'https://flowlinght-test.oss-cn-shanghai.aliyuncs.com';  -- TODO: 改成实际的旧 host
SET @new = 'https://cdn.mbfczzzz.top';                              -- TODO: 改成目标域名

-- ② 生成改写语句(覆盖所有文本列,含 canvas_data / 博客正文 / 附件 JSON 里的内嵌 URL)
SELECT CONCAT(
  'UPDATE `', table_name, '` SET `', column_name,
  '` = REPLACE(`', column_name, '`, ''', @old, ''', ''', @new,
  ''') WHERE `', column_name, '` LIKE CONCAT(''%'', ''', @old, ''', ''%'') COLLATE utf8mb4_bin;'
) AS stmt
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND data_type IN ('char','varchar','tinytext','text','mediumtext','longtext')
ORDER BY table_name, column_name;

-- 把上面查询输出的 stmt 列整体复制执行(注意:命中 sys_config 里 storage.*
-- 配置项本身的那几条跳过——配置值请去后台「配置管理」改)。

-- ③ 验证:对重点表逐列统计残留,应全为 0(其它列可仿照追加)
-- SELECT 'files.file_url' t, COUNT(*) c FROM files WHERE file_url LIKE CONCAT('%', @old, '%') COLLATE utf8mb4_bin
-- UNION ALL SELECT 'ai_tasks.result_url', COUNT(*) FROM ai_tasks WHERE result_url LIKE CONCAT('%', @old, '%') COLLATE utf8mb4_bin
-- UNION ALL SELECT 'ai_tasks.request_url', COUNT(*) FROM ai_tasks WHERE input LIKE CONCAT('%', @old, '%') COLLATE utf8mb4_bin
-- UNION ALL SELECT 'projects.canvas_data', COUNT(*) FROM projects WHERE canvas_data LIKE CONCAT('%', @old, '%') COLLATE utf8mb4_bin
-- UNION ALL SELECT 'blog_post.cover_url', COUNT(*) FROM blog_post WHERE cover_url LIKE CONCAT('%', @old, '%') COLLATE utf8mb4_bin
-- UNION ALL SELECT 'blog_post.content', COUNT(*) FROM blog_post WHERE content LIKE CONCAT('%', @old, '%') COLLATE utf8mb4_bin
-- UNION ALL SELECT 'community_post.cover_url', COUNT(*) FROM community_post WHERE cover_url LIKE CONCAT('%', @old, '%') COLLATE utf8mb4_bin;

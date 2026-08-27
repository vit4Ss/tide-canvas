-- 排查：全能参考(multi_ref)的参考素材数量上限，哪些视频模型没配。
-- 用法（生产/测试服务器上执行，只读）：
--   mysql -uroot -p canvas < check-omniref-limits.sql
--
-- 背景：refLimits 没有任何自动写入——relay 同步只写 maxRefImages（取自
-- params_schema.edit_images.max），omniRef.*Count 只能在后台「模型管理」手填。
-- 没填(NULL 或 0) = 不限制，只能靠上游 relay 的 400 兜底：先扣分、再退款。

-- 1) 所有视频模型的 omniRef 数量/大小配置一览。
--    supports_omni 用与服务端 videoHandlersFromMetadata 同样宽松的口径判定，
--    避免 relay 报 multi_ref 时被漏掉。
SELECT
  m.name                                                          AS 模型,
  m.model_key                                                     AS 上游模型ID,
  JSON_UNQUOTE(JSON_EXTRACT(m.config, '$.refLimits."omniRef.imageCount"'))  AS 图片数量上限,
  JSON_UNQUOTE(JSON_EXTRACT(m.config, '$.refLimits."omniRef.videoCount"'))  AS 视频数量上限,
  JSON_UNQUOTE(JSON_EXTRACT(m.config, '$.refLimits."omniRef.audioCount"'))  AS 音频数量上限,
  JSON_UNQUOTE(JSON_EXTRACT(m.config, '$.refLimits."omniRef.imageSizeMB"')) AS 图片大小上限MB,
  JSON_UNQUOTE(JSON_EXTRACT(m.config, '$.modes'))                  AS 顶层modes,
  JSON_UNQUOTE(JSON_EXTRACT(m.config, '$.paramsSchema.modes'))     AS relay上报modes,
  m.status                                                        AS 状态
FROM market_model m
WHERE m.type = 'video'
  AND (
       LOWER(m.config) LIKE '%omni_ref%'
    OR LOWER(m.config) LIKE '%multi_ref%'
    OR LOWER(m.config) LIKE '%reference%'
  )
ORDER BY (JSON_EXTRACT(m.config, '$.refLimits."omniRef.imageCount"') IS NULL) DESC,
         m.name;

-- 2) 只列出「支持全能参考但图片数量没配」的——这些就是仍会先扣分再退款的模型。
SELECT
  m.name        AS 待配置模型,
  m.model_key   AS 上游模型ID
FROM market_model m
WHERE m.type = 'video'
  AND (
       LOWER(m.config) LIKE '%omni_ref%'
    OR LOWER(m.config) LIKE '%multi_ref%'
    OR LOWER(m.config) LIKE '%reference%'
  )
  AND COALESCE(JSON_EXTRACT(m.config, '$.refLimits."omniRef.imageCount"'), 0) = 0
ORDER BY m.name;

-- 3) 这次出事的那几个 Seedance，看完整 config（确认 modes 到底是 omni_ref 还是 multi_ref）。
SELECT m.name, m.model_key, m.config
FROM market_model m
WHERE m.name LIKE '%Seedance%' OR m.model_key LIKE '%seedance%';

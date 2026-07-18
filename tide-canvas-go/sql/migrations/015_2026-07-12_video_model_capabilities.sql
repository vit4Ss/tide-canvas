-- Video model capability and per-second pricing migration.
-- Corresponding code: per-model video capabilities and second-pricing rollout.
-- Depends on: baseline ai_model table.
-- Idempotency: no. Run once after migration 014.
-- Existing video models are deliberately disabled and their legacy pricing is
-- removed; administrators must configure secondPricing before re-enabling.

UPDATE `ai_model`
SET
    `config` = JSON_SET(
        JSON_REMOVE(COALESCE(`config`, JSON_OBJECT()), '$.pricing', '$.secondPricing'),
        '$.ratios', COALESCE(
            JSON_EXTRACT(`config`, '$.ratios'),
            JSON_ARRAY('auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16')
        ),
        '$.resolutions', COALESCE(
            JSON_EXTRACT(`config`, '$.resolutions'),
            JSON_ARRAY('480P', '720P', '1080P')
        ),
        '$.durations', COALESCE(
            JSON_EXTRACT(`config`, '$.durations'),
            JSON_ARRAY(5, 10)
        ),
        '$.audio', COALESCE(
            JSON_EXTRACT(`config`, '$.audio'),
            JSON_EXTRACT('true', '$')
        )
    ),
    `point_cost` = 0,
    `status` = 0
WHERE `type` = 'video' AND `deleted` = 0;

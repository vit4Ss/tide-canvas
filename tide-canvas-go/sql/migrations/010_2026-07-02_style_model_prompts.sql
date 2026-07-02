-- =============================================================
-- Migration 010 | 2026-07-02 | Style model scoped prompts
-- -------------------------------------------------------------
-- Adds multi-model availability and per-model prompt overrides for style presets.
-- Existing model_id remains for backward compatibility.
-- =============================================================
USE tide_canvas;
SET NAMES utf8mb4;

ALTER TABLE `style_preset`
    ADD COLUMN `model_ids` JSON DEFAULT NULL COMMENT 'Optional logical model id list; empty means all image models' AFTER `model_id`,
    ADD COLUMN `model_prompts` JSON DEFAULT NULL COMMENT 'Prompt overrides keyed by logical model id' AFTER `model_ids`;
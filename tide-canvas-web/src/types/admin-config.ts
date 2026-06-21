// ============================================================================
// Admin config (g5_config.go) wire types.
//
// Mirrors the backend VO/DTO in
//   tide-canvas-server/internal/handler/admin/g5_config.go
//   GET /api/admin/config  -> ConfigVO[]
//   PUT /api/admin/config  { items: ConfigItemDTO[] } -> ConfigVO[]
//
// IDs serialize as quoted decimal STRINGS (idgen.ID). PUT upserts by configKey;
// the response is the full reloaded config list.
// ============================================================================

/** One system config entry (model.SysConfig). */
export interface ConfigVO {
  id: string;
  configKey: string;
  configValue: string;
  /** Logical group (maps to db column config_group). */
  group: string;
  description: string;
}

/** A single config key to upsert. */
export interface ConfigItemDTO {
  configKey: string;
  configValue?: string;
  group?: string;
  description?: string;
}

/** PUT body — the handler also accepts a bare array or a flat map, but we send
 *  the canonical { items } shape. */
export interface ConfigUpsertDTO {
  items: ConfigItemDTO[];
}

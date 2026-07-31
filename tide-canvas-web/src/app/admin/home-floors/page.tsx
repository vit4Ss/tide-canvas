"use client";

/* ============================================================================
   /admin/home-floors — 首页楼层.

   Wired to the REAL admin API (/api/admin/home/floors). These rows drive the
   public home layout. Keeps the liuguang admin markup/classes + shared
   components (Panel / SwitchToggle / AdminModal / FormCard / FormGrid / Field /
   FormSection / MChips).

   The .floor list reorders by ⋮⋮ handle drag-drop AND 上移/下移 buttons — both
   persist via PUT /home/floors/order. The 启用 toggle, 编辑/删除, and the modal
   CRUD all hit the real endpoints and refresh.

   The 楼层全局配置 panel (背景流光 / 首屏 CTA) persists to sys_config
   `home.global` via PUT /api/admin/config and is served to the public home by
   GET /api/site/home-config (背景着色器预设/强度/用户切换 + hero 主按钮).

   Client component (modals + toggles + reorder).
   ============================================================================ */

import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical, Plus, RefreshCw, Save } from "lucide-react";
import {
  AdminAlert,
  AdminEmptyState,
  AdminModal,
  Field,
  FormCard,
  FormGrid,
  FormSection,
  MChips,
  Panel,
  SwitchToggle,
  ListSkeleton,
} from "@/components/admin";
import {
  FLOOR_SOURCE_OPTIONS,
  FLOOR_TYPE_OPTIONS,
  WORKS_FLOOR_TYPES,
} from "@/components/admin/admin-constants";
import { HOME_CTA_TARGETS } from "@/lib/flux-presets";
import { useAuthStore } from "@/stores/use-auth-store";
import { adminHomeFloorsApi } from "@/lib/admin-home-floors-api";
import { adminConfigApi } from "@/lib/admin-config-api";
import { confirmDialog } from "@/components/shared/confirm";
import { toast } from "@/components/shared/toast";
import type { HomeFloorVO } from "@/types/admin-home-floors";

// 内容源 键↔标签映射（存库用 key，展示用 label）。
const SOURCE_LABELS = FLOOR_SOURCE_OPTIONS.map((o) => o.label);
const KEY_TO_LABEL: Record<string, string> = Object.fromEntries(
  FLOOR_SOURCE_OPTIONS.map((o) => [o.key, o.label]),
);
const LABEL_TO_KEY: Record<string, string> = Object.fromEntries(
  FLOOR_SOURCE_OPTIONS.map((o) => [o.label, o.key]),
);

/** 解析已存的 content_source（"hot,latest"，含遗留 auto/manual）为展示用标签数组。
 *  作品流楼层为空时默认「实时热度」，与后端 parseFloorSources 的兜底一致。 */
function sourceKeysToLabels(raw?: string): string[] {
  const labels = (raw || "")
    .split(",")
    .map((s) => s.trim())
    .map((s) => (s === "auto" ? "hot" : s === "manual" ? "latest" : s))
    .filter((k) => KEY_TO_LABEL[k])
    .map((k) => KEY_TO_LABEL[k]);
  const uniq = Array.from(new Set(labels));
  return uniq.length ? uniq : [KEY_TO_LABEL.hot];
}

export default function AdminHomeFloorsPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);

  const [floors, setFloors] = useState<HomeFloorVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ floor: HomeFloorVO | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await ensureSession();
      const res = await adminHomeFloorsApi.list();
      if (res.success && res.data) setFloors(res.data);
      else setError(res.message || "加载失败");
    } catch {
      setError("加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [ensureSession]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const openNew = () => {
    setError(null);
    setModal({ floor: null });
  };
  const openEdit = (floor: HomeFloorVO) => {
    setError(null);
    setModal({ floor });
  };
  const close = () => setModal(null);

  const toggleEnabled = async (floor: HomeFloorVO, next: boolean) => {
    const res = await adminHomeFloorsApi.update(floor.id, { enabled: next });
    if (res.success) load();
    else {
      toast.error(res.message || "更新楼层状态失败");
      load();
    }
  };

  const removeFloor = async (floor: HomeFloorVO) => {
    if (
      !(await confirmDialog({
        title: "删除楼层",
        message: `确定删除楼层「${floor.name}」？`,
        confirmText: "删除",
      }))
    )
      return;
    const res = await adminHomeFloorsApi.remove(floor.id);
    if (res.success) load();
    else setError(res.message || "删除失败");
  };

  // Persist a new ordering (shared by 上移/下移 buttons and ⋮⋮ drag-drop).
  const applyOrder = useCallback(
    async (next: HomeFloorVO[]) => {
      setFloors(next); // optimistic
      const res = await adminHomeFloorsApi.reorder({ ids: next.map((f) => f.id) });
      if (!res.success) {
        toast.error(res.message || "保存楼层顺序失败");
        load(); // revert from server truth
      }
    },
    [load],
  );

  // Move floor at index `from` to `from+dir`.
  const move = (from: number, dir: -1 | 1) => {
    const to = from + dir;
    if (to < 0 || to >= floors.length) return;
    const next = [...floors];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    applyOrder(next);
  };

  // ⋮⋮ 拖拽排序：只允许从手柄起拖（dragFromHandle 门闩），行整体作为放置目标；
  // 松手把被拖行插到目标行位置，与上移/下移共用 applyOrder 持久化。
  const [dragIx, setDragIx] = useState<number | null>(null);
  const [overIx, setOverIx] = useState<number | null>(null);
  const dragFromHandle = useRef(false);

  const endDrag = () => {
    dragFromHandle.current = false;
    setDragIx(null);
    setOverIx(null);
  };

  const dropTo = (to: number) => {
    const from = dragIx;
    endDrag();
    if (from == null || to === from) return;
    const next = [...floors];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    applyOrder(next);
  };

  const f = modal?.floor ?? null;

  return (
    <div className="adm-page">
      {/* 首页楼层管理 */}
      <Panel
        title="楼层编排"
        sub={`共 ${floors.length} 个楼层 · 启用、排序与内容源会同步到公开首页`}
        tools={
          <button type="button" className="adm-btn" onClick={openNew}>
            <Plus aria-hidden size={15} />
            新增楼层
          </button>
        }
      >
        <div style={{ padding: "16px 18px" }}>
          {loading ? (
            <ListSkeleton rows={5} height={64} />
          ) : error ? (
            <AdminAlert
              tone="error"
              title="首页楼层加载失败"
              action={
                <button type="button" className="adm-btn ghost" onClick={load}>
                  <RefreshCw aria-hidden size={15} />
                  重新加载
                </button>
              }
            >
              {error}
            </AdminAlert>
          ) : floors.length === 0 ? (
            <AdminEmptyState
              title="首页还没有内容楼层"
              description="新建第一个楼层后，可继续调整展示顺序与内容来源。"
              action={
                <button type="button" className="adm-btn" onClick={openNew}>
                  <Plus aria-hidden size={15} />
                  新增楼层
                </button>
              }
            />
          ) : (
            <div role="list" aria-label="首页楼层排序">
              {floors.map((floor, i) => (
                <div
                  className={`floor${dragIx === i ? " dragging" : ""}${
                    overIx === i && dragIx != null && dragIx !== i ? " drop-hint" : ""
                  }`}
                  data-floor={floor.name}
                  key={floor.id}
                  role="listitem"
                  draggable
                  onDragStart={(e) => {
                    if (!dragFromHandle.current) {
                      e.preventDefault(); // 只认手柄起拖，避免误拖行内按钮/开关
                      return;
                    }
                    setDragIx(i);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    if (dragIx == null) return;
                    e.preventDefault();
                    setOverIx(i);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    dropTo(i);
                  }}
                  onDragEnd={endDrag}
                >
                  <button
                    type="button"
                    className="grab"
                    onMouseDown={() => {
                      dragFromHandle.current = true;
                    }}
                    aria-label={`拖动调整 ${floor.name} 顺序`}
                    title="拖动调整顺序"
                  >
                    <GripVertical aria-hidden size={16} />
                  </button>
                  <span className="ix">{i + 1}</span>
                  <div>
                    <div className="nm">{floor.name}</div>
                    <div className="meta">{floor.subtitle || floor.type}</div>
                  </div>
                  <div className="sp" />
                  <SwitchToggle
                    checked={floor.enabled}
                    onChange={(next) => toggleEnabled(floor, next)}
                    aria-label={`${floor.name} 启用`}
                  />
                  <div className="rowacts">
                    <button type="button" disabled={i === 0} onClick={() => move(i, -1)}>
                      上移
                    </button>
                    <button
                      type="button"
                      disabled={i === floors.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      下移
                    </button>
                    <button type="button" onClick={() => openEdit(floor)}>
                      编辑
                    </button>
                    <button type="button" className="danger" onClick={() => removeFloor(floor)}>
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>

      {/* 楼层全局配置（sys_config home.global → 前台 /api/site/home-config） */}
      <GlobalConfigPanel />

      {/* floorModal — 新增/编辑楼层 */}
      {modal != null ? (
        <FloorModal key={f?.id ?? "new"} floor={f} onClose={close} onSaved={() => {
          close();
          load();
        }} />
      ) : null}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   GlobalConfigPanel — 楼层全局配置（背景流光 + 首屏 CTA）。
   读写 sys_config `home.global`（GET/PUT /api/admin/config），保存后公开首页
   下次加载即生效（/api/site/home-config）。脏检测驱动保存按钮。
   ──────────────────────────────────────────────────────────────────────── */

// 表单态。流光背景功能已整体移除（产品定稿：纯黑底，不提供背景配置），
// home.global 只剩首屏 CTA 两项。
interface HomeGlobalForm {
  ctaLabel: string;
  ctaTarget: string;
}

// 出厂默认 — 与后端 model.DefaultHomeGlobalJSON 一致（键缺失/解析失败时兜底）。
const HOME_GLOBAL_DEFAULTS: HomeGlobalForm = {
  ctaLabel: "生成",
  ctaTarget: "studio",
};

const HOME_GLOBAL_KEY = "home.global";

/** 解析已存的 home.global JSON 为表单态；非法值逐字段回退默认。
    旧数据里可能残留 flux* 字段，直接忽略。 */
function parseHomeGlobal(raw: string): HomeGlobalForm {
  try {
    const v = JSON.parse(raw) as Partial<{
      ctaLabel: string;
      ctaTarget: string;
    }>;
    return {
      ctaLabel: v.ctaLabel?.trim() || HOME_GLOBAL_DEFAULTS.ctaLabel,
      ctaTarget:
        v.ctaTarget === "pricing" ? "pricing" : HOME_GLOBAL_DEFAULTS.ctaTarget,
    };
  } catch {
    return { ...HOME_GLOBAL_DEFAULTS };
  }
}

function GlobalConfigPanel() {
  const ensureSession = useAuthStore((s) => s.ensureSession);
  const [form, setForm] = useState<HomeGlobalForm | null>(null);
  const [snapshot, setSnapshot] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      await ensureSession();
      const res = await adminConfigApi.list();
      if (!res.success || !res.data) {
        setLoadError(res.message || "加载失败");
        return;
      }
      const row = res.data.find((it) => it.configKey === HOME_GLOBAL_KEY);
      const next = row ? parseHomeGlobal(row.configValue) : { ...HOME_GLOBAL_DEFAULTS };
      setForm(next);
      setSnapshot(JSON.stringify(next));
    } catch {
      setLoadError("加载失败，请稍后重试");
    }
  }, [ensureSession]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const dirty = form != null && JSON.stringify(form) !== snapshot;

  const patch = (p: Partial<HomeGlobalForm>) =>
    setForm((f) => (f ? { ...f, ...p } : f));

  const save = async () => {
    if (!form || saving) return;
    if (!form.ctaLabel.trim()) {
      toast.error("请填写按钮文案");
      return;
    }
    setSaving(true);
    try {
      const value = JSON.stringify({
        ctaLabel: form.ctaLabel.trim(),
        ctaTarget: form.ctaTarget,
      });
      const res = await adminConfigApi.save([
        {
          configKey: HOME_GLOBAL_KEY,
          configValue: value,
          group: "home",
          description:
            "首页全局配置（首屏 CTA），后台「首页楼层」编辑，前台 /api/site/home-config 读取",
        },
      ]);
      if (res.success) {
        const normalized: HomeGlobalForm = {
          ...form,
          ctaLabel: form.ctaLabel.trim(),
        };
        setForm(normalized);
        setSnapshot(JSON.stringify(normalized));
        toast.success("已保存，首页刷新后生效");
      } else {
        toast.error(res.message || "保存失败");
      }
    } catch {
      toast.error("保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      title="楼层全局配置"
      sub="设置首屏主按钮，保存后刷新首页即可查看"
      tools={
        <button
          type="button"
          className="adm-btn"
          disabled={!dirty || saving}
          onClick={save}
        >
          {!saving ? <Save aria-hidden size={15} /> : null}
          {saving ? "保存中…" : "保存"}
        </button>
      }
    >
      <div style={{ padding: "16px 18px" }}>
        {form == null ? (
          loadError ? (
            <AdminAlert
              tone="error"
              title="全局配置加载失败"
              action={
                <button type="button" className="adm-btn ghost" onClick={load}>
                  <RefreshCw aria-hidden size={15} />
                  重新加载
                </button>
              }
            >
              {loadError}
            </AdminAlert>
          ) : (
            <ListSkeleton rows={2} height={64} />
          )
        ) : (
          <div className="cfg-grid">
            <div className="cfg-card">
              <h3>首屏 CTA</h3>
              <p>英雄区主按钮文案与跳转。</p>
              <div className="cfg-row">
                <span className="lab">按钮文案</span>
                <input
                  type="text"
                  value={form.ctaLabel}
                  onChange={(e) => patch({ ctaLabel: e.target.value })}
                  aria-label="按钮文案"
                />
              </div>
              <div className="cfg-row">
                <span className="lab">跳转</span>
                <select
                  value={form.ctaTarget}
                  onChange={(e) => patch({ ctaTarget: e.target.value })}
                  aria-label="跳转"
                >
                  {HOME_CTA_TARGETS.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   FloorModal — 新增/编辑楼层. Bound to the real home_floor columns.
   ──────────────────────────────────────────────────────────────────────── */

function FloorModal({
  floor,
  onClose,
  onSaved,
}: {
  floor: HomeFloorVO | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(floor?.name ?? "");
  const [subtitle, setSubtitle] = useState(floor?.subtitle ?? "");
  const [type, setType] = useState(floor?.type || FLOOR_TYPE_OPTIONS[0]);
  // 内容源以展示标签数组存于 state，保存时映射回 key；仅作品流楼层生效。
  const [sourceLabels, setSourceLabels] = useState<string[]>(
    sourceKeysToLabels(floor?.contentSource),
  );
  const [count, setCount] = useState(String(floor?.count ?? 10));
  const [sortOrder, setSortOrder] = useState(String(floor?.sortOrder ?? 0));
  const [enabled, setEnabled] = useState(floor ? floor.enabled : true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 仅「吃作品」的楼层（作品流）才有内容源；其余楼层是静态或有固有来源，隐藏该控件。
  const isWorksFloor = (WORKS_FLOOR_TYPES as readonly string[]).includes(type);

  // 校验/接口失败 return false → AdminModal 保持打开(footNote 显示错误)。
  const save = async (): Promise<boolean> => {
    if (!name.trim()) {
      setErr("请填写楼层名称");
      return false;
    }
    setSaving(true);
    setErr(null);
    try {
      // 只有作品流楼层携带内容源；其余楼层不吃作品，存空串。
      const contentSource = isWorksFloor
        ? sourceLabels.map((l) => LABEL_TO_KEY[l]).filter(Boolean).join(",")
        : "";
      const payload = {
        name: name.trim(),
        subtitle: subtitle.trim(),
        type: type.trim(),
        contentSource,
        count: Number(count) || 0,
        sortOrder: Number(sortOrder) || 0,
        enabled,
      };
      const res = floor
        ? await adminHomeFloorsApi.update(floor.id, payload)
        : await adminHomeFloorsApi.create(payload);
      if (res.success) {
        onSaved();
        return true;
      }
      setErr(res.message || "保存失败");
      return false;
    } catch {
      setErr("保存失败，请稍后重试");
      return false;
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminModal
      open
      size="lg"
      title={floor ? `编辑楼层 · ${floor.name}` : "新增楼层"}
      subtitle={floor ? "调整该楼层的展示与内容源" : "新增一个首页楼层"}
      saveLabel={saving ? "保存中…" : "保存"}
      footNote={err ? <span role="alert">{err}</span> : "变更将在保存后生效"}
      onClose={onClose}
      onSave={save}
    >
      <FormCard title="楼层信息">
        <FormGrid>
          <Field
            label="楼层名称"
            required
            span={2}
            error={err === "请填写楼层名称" ? err : undefined}
          >
            <input placeholder="如：本周精选" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="楼层类型" span={2}>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {FLOOR_TYPE_OPTIONS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </Field>
          <Field label="副标题" span={2}>
            <input placeholder="选填" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
          </Field>
          {isWorksFloor ? (
            <Field
              group
              label="内容源"
              span={2}
              hint="可多选，按选择顺序合并去重（如：实时热度 + 最新发布）"
            >
              <MChips
                label="内容源"
                options={SOURCE_LABELS}
                selected={sourceLabels}
                onChange={setSourceLabels}
              />
            </Field>
          ) : null}
          <Field label="展示数量">
            <input value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="排序">
            <input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} inputMode="numeric" />
          </Field>
        </FormGrid>
        <FormSection label="楼层状态">
          <div className="cfg-card flat">
            <div className="cfg-row">
              <span className="lab">启用楼层</span>
              <SwitchToggle checked={enabled} onChange={setEnabled} aria-label="启用楼层" />
            </div>
          </div>
        </FormSection>
      </FormCard>
    </AdminModal>
  );
}

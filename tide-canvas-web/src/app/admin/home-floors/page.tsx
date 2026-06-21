"use client";

/* ============================================================================
   /admin/home-floors — 首页楼层.

   Wired to the REAL admin API (/api/admin/home/floors). These rows drive the
   public home layout. Keeps the liuguang admin markup/classes + shared
   components (Panel / SwitchToggle / AdminModal / FormCard / FormGrid / Field /
   FormSection / MChips).

   The draggable .floor list keeps its ⋮⋮ grab handle (presentational) and adds
   上移/下移 actions that persist order via PUT /home/floors/order. The 启用 toggle,
   编辑/删除, and the modal CRUD all hit the real endpoints and refresh.

   The 楼层全局配置 panel (背景流光 / 首屏 CTA) has no backend table, so it stays
   presentational, matching the design.

   Client component (modals + toggles + reorder).
   ============================================================================ */

import { useCallback, useEffect, useState } from "react";
import {
  AdminModal,
  Field,
  FormCard,
  FormGrid,
  FormSection,
  MChips,
  Panel,
  SwitchToggle,
} from "@/components/admin";
import {
  FLOOR_BG_PRESETS,
  FLOOR_CTA_TARGETS,
  FLOOR_LAYOUT_OPTIONS,
  FLOOR_PLATFORM_OPTIONS,
  FLOOR_SOURCE_OPTIONS,
  FLOOR_TYPE_OPTIONS,
} from "@/mock/admin-home-floors";
import { useAuthStore } from "@/stores/use-auth-store";
import { adminHomeFloorsApi } from "@/lib/admin-home-floors-api";
import type { HomeFloorVO } from "@/types/admin-home-floors";

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
    load();
  }, [load]);

  const openNew = () => setModal({ floor: null });
  const openEdit = (floor: HomeFloorVO) => setModal({ floor });
  const close = () => setModal(null);

  const toggleEnabled = async (floor: HomeFloorVO, next: boolean) => {
    const res = await adminHomeFloorsApi.update(floor.id, { enabled: next });
    if (res.success) load();
    else load();
  };

  const removeFloor = async (floor: HomeFloorVO) => {
    if (typeof window !== "undefined" && !window.confirm(`确定删除楼层「${floor.name}」？`)) return;
    const res = await adminHomeFloorsApi.remove(floor.id);
    if (res.success) load();
    else setError(res.message || "删除失败");
  };

  // Persist a new ordering: move floor at index `from` to `from+dir`.
  const move = async (from: number, dir: -1 | 1) => {
    const to = from + dir;
    if (to < 0 || to >= floors.length) return;
    const next = [...floors];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setFloors(next); // optimistic
    const res = await adminHomeFloorsApi.reorder({ ids: next.map((f) => f.id) });
    if (!res.success) load(); // revert from server truth
  };

  const f = modal?.floor ?? null;

  return (
    <>
      {/* 首页楼层管理 */}
      <Panel
        title="首页楼层管理"
        sub="排序，控制首页各楼层的展示与内容源"
        tools={
          <button type="button" className="adm-btn" onClick={openNew}>
            + 新增楼层
          </button>
        }
      >
        <div style={{ padding: "16px 18px" }}>
          {loading ? (
            <div className="muted" style={{ padding: "24px 0", textAlign: "center" }}>
              加载中…
            </div>
          ) : error ? (
            <div className="muted" style={{ padding: "24px 0", textAlign: "center" }}>
              {error}
              <div style={{ marginTop: 12 }}>
                <button type="button" className="adm-btn ghost" onClick={load}>
                  重试
                </button>
              </div>
            </div>
          ) : floors.length === 0 ? (
            <div className="muted" style={{ padding: "24px 0", textAlign: "center" }}>
              暂无楼层，点击「新增楼层」添加。
            </div>
          ) : (
            floors.map((floor, i) => (
              <div className="floor" data-floor={floor.name} key={floor.id}>
                <span className="grab">⋮⋮</span>
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
            ))
          )}
        </div>
      </Panel>

      {/* 楼层全局配置（无后端表，保持展示态） */}
      <Panel title="楼层全局配置">
        <div style={{ padding: 18 }}>
          <div className="cfg-grid">
            <div className="cfg-card">
              <h3>背景流光</h3>
              <p>首页连续着色器背景的默认预设与强度。</p>
              <div className="cfg-row">
                <span className="lab">默认预设</span>
                <select>
                  {FLOOR_BG_PRESETS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div className="cfg-row">
                <span className="lab">强度</span>
                <input type="number" defaultValue="0.78" />
                <span className="unit">0–1.5</span>
              </div>
              <div className="cfg-row">
                <span className="lab">允许用户切换</span>
                <SwitchToggle defaultChecked aria-label="允许用户切换" />
              </div>
            </div>
            <div className="cfg-card">
              <h3>首屏 CTA</h3>
              <p>英雄区主按钮文案与跳转。</p>
              <div className="cfg-row">
                <span className="lab">按钮文案</span>
                <input type="text" defaultValue="开始创作" />
              </div>
              <div className="cfg-row">
                <span className="lab">跳转</span>
                <select>
                  {FLOOR_CTA_TARGETS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      </Panel>

      {/* floorModal — 新增/编辑楼层 */}
      {modal != null ? (
        <FloorModal key={f?.id ?? "new"} floor={f} onClose={close} onSaved={() => {
          close();
          load();
        }} />
      ) : null}
    </>
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
  const [contentSource, setContentSource] = useState(floor?.contentSource || FLOOR_SOURCE_OPTIONS[0]);
  const [count, setCount] = useState(String(floor?.count ?? 10));
  const [sortOrder, setSortOrder] = useState(String(floor?.sortOrder ?? 0));
  const [layout, setLayout] = useState<string>(floor?.layout || FLOOR_LAYOUT_OPTIONS[0]);
  const [platforms, setPlatforms] = useState<string[]>(
    floor?.platforms ?? [...FLOOR_PLATFORM_OPTIONS],
  );
  const [enabled, setEnabled] = useState(floor ? floor.enabled : true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) {
      setErr("请填写楼层名称");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const payload = {
        name: name.trim(),
        subtitle: subtitle.trim(),
        type: type.trim(),
        contentSource: contentSource.trim(),
        count: Number(count) || 0,
        sortOrder: Number(sortOrder) || 0,
        layout: layout.trim(),
        platforms,
        enabled,
      };
      const res = floor
        ? await adminHomeFloorsApi.update(floor.id, payload)
        : await adminHomeFloorsApi.create(payload);
      if (res.success) onSaved();
      else setErr(res.message || "保存失败");
    } catch {
      setErr("保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminModal
      open
      title={floor ? `编辑楼层 · ${floor.name}` : "新增楼层"}
      subtitle={floor ? "调整该楼层的展示与内容源" : "新增一个首页楼层"}
      saveLabel={saving ? "保存中…" : "保存"}
      footNote={err ?? "变更将在保存后生效"}
      onClose={onClose}
      onSave={save}
    >
      <FormCard title="楼层信息">
        <FormGrid>
          <Field label="楼层名称" required span={2}>
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
          <Field label="内容源" span={2}>
            <select value={contentSource} onChange={(e) => setContentSource(e.target.value)}>
              {FLOOR_SOURCE_OPTIONS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </Field>
          <Field label="展示数量">
            <input value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="排序">
            <input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} inputMode="numeric" />
          </Field>
        </FormGrid>
      </FormCard>

      <FormCard title="展示设置">
        <FormSection label="布局样式">
          <MChips
            options={[...FLOOR_LAYOUT_OPTIONS]}
            selected={[layout]}
            solo
            onChange={(next) => setLayout(next[0] ?? layout)}
          />
        </FormSection>
        <FormSection label="可见端">
          <MChips
            options={[...FLOOR_PLATFORM_OPTIONS]}
            selected={platforms}
            onChange={setPlatforms}
          />
        </FormSection>
        <FormSection label="选项">
          <div className="cfg-card" style={{ boxShadow: "none", padding: "4px 16px" }}>
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

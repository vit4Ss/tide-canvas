"use client";

/* ============================================================================
   /admin/config — 配置管理.

   Faithful port of admin.js V.config()'s 基础配置 block, now wired to the REAL
   backend:
     GET /api/admin/config  -> ConfigVO[]
     PUT /api/admin/config  { items: ConfigItemDTO[] } -> ConfigVO[] (reloaded)

     - KPI strip (服务可用率 / 配置项 / 分组 / 待保存变更) — derived from live data.
     - 基础配置: .cfg-grid of .cfg-card grouped by ConfigVO.group; each row is an
       editable text input bound to configValue. 「保存变更」 PUTs every changed
       item and refreshes.
     - 新建配置 modal: configKey / configValue / group / description → upsert.

   Client component: editable config grid, save, new-item modal, loading/empty.
   ============================================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AdminModal,
  Field,
  FormCard,
  FormGrid,
  Panel,
  StatCardGrid,
  type StatCardProps,
} from "@/components/admin";
import { adminConfigApi } from "@/lib/admin-config-api";
import type { ConfigVO, ConfigItemDTO } from "@/types/admin-config";
import { useAuthStore } from "@/stores/use-auth-store";

export default function AdminConfigPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);

  const [items, setItems] = useState<ConfigVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Edited values keyed by configKey (only changed keys are present).
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [newOpen, setNewOpen] = useState(false);

  const nKeyRef = useRef<HTMLInputElement>(null);
  const nValueRef = useRef<HTMLInputElement>(null);
  const nGroupRef = useRef<HTMLInputElement>(null);
  const nDescRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await ensureSession();
      const res = await adminConfigApi.list();
      if (res.success && res.data) {
        setItems(res.data);
        setEdits({});
      } else {
        setError(res.message || "加载配置失败");
        setItems([]);
      }
    } catch {
      setError("加载配置失败");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [ensureSession]);

  useEffect(() => {
    load();
  }, [load]);

  // group ConfigVO[] by `group` (blank group → 其它)
  const groups = useMemo(() => {
    const map = new Map<string, ConfigVO[]>();
    for (const it of items) {
      const g = it.group?.trim() || "其它";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(it);
    }
    return Array.from(map.entries());
  }, [items]);

  const dirtyCount = Object.keys(edits).length;

  const kpis: StatCardProps[] = useMemo(
    () => [
      { k: "服务可用率", v: "99.98%", d: "近 30 天", dir: "up" },
      { k: "配置项", v: String(items.length), dir: "up" },
      { k: "分组", v: String(groups.length), dir: "up" },
      { k: "待保存变更", v: String(dirtyCount), dir: dirtyCount > 0 ? "down" : "up" },
    ],
    [items.length, groups.length, dirtyCount],
  );

  const valueOf = (it: ConfigVO) => (it.configKey in edits ? edits[it.configKey] : it.configValue);

  const onEdit = (it: ConfigVO, next: string) => {
    setEdits((prev) => {
      const copy = { ...prev };
      if (next === it.configValue) delete copy[it.configKey];
      else copy[it.configKey] = next;
      return copy;
    });
  };

  const save = useCallback(async () => {
    const changed = items.filter((it) => it.configKey in edits);
    if (changed.length === 0) return;
    setSaving(true);
    try {
      await ensureSession();
      const payload: ConfigItemDTO[] = changed.map((it) => ({
        configKey: it.configKey,
        configValue: edits[it.configKey],
        group: it.group,
        description: it.description,
      }));
      const res = await adminConfigApi.save(payload);
      if (res.success && res.data) {
        setItems(res.data);
        setEdits({});
      }
    } finally {
      setSaving(false);
    }
  }, [items, edits, ensureSession]);

  const createItem = useCallback(async () => {
    const key = nKeyRef.current?.value.trim();
    if (!key) return;
    setSaving(true);
    try {
      await ensureSession();
      const payload: ConfigItemDTO[] = [
        {
          configKey: key,
          configValue: nValueRef.current?.value ?? "",
          group: nGroupRef.current?.value ?? "",
          description: nDescRef.current?.value ?? "",
        },
      ];
      const res = await adminConfigApi.save(payload);
      if (res.success && res.data) {
        setItems(res.data);
        setEdits({});
        setNewOpen(false);
      }
    } finally {
      setSaving(false);
    }
  }, [ensureSession]);

  return (
    <>
      <StatCardGrid items={kpis} />

      <Panel
        title="基础配置"
        sub="站点信息与全局开关"
        tools={
          <>
            <button type="button" className="adm-btn ghost" onClick={() => setNewOpen(true)}>
              + 新建配置
            </button>
            <button type="button" className="adm-btn" disabled={dirtyCount === 0 || saving} onClick={save}>
              {saving ? "保存中…" : dirtyCount > 0 ? `保存变更 (${dirtyCount})` : "保存变更"}
            </button>
          </>
        }
      >
        {loading ? (
          <div className="muted" style={{ padding: 32, textAlign: "center" }}>
            加载中…
          </div>
        ) : error ? (
          <div className="muted" style={{ padding: 32, textAlign: "center" }}>
            {error}
          </div>
        ) : items.length === 0 ? (
          <div className="muted" style={{ padding: 32, textAlign: "center" }}>
            暂无配置项，点击「新建配置」添加。
          </div>
        ) : (
          <div style={{ padding: 18 }}>
            <div className="cfg-grid">
              {groups.map(([group, rows]) => (
                <div className="cfg-card" key={group}>
                  <h3>{group}</h3>
                  <p>{rows.length} 项配置</p>
                  {rows.map((it) => (
                    <div className="cfg-row" key={it.configKey}>
                      <span className="lab" title={it.description || it.configKey}>
                        {it.description || it.configKey}
                      </span>
                      <input
                        value={valueOf(it)}
                        onChange={(e) => onEdit(it, e.target.value)}
                        aria-label={it.configKey}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>

      {/* 新建配置 */}
      <AdminModal
        open={newOpen}
        title="新建配置"
        subtitle="新增一项系统配置 (按 configKey 去重)"
        saveLabel={saving ? "保存中…" : "保存"}
        onClose={() => (saving ? undefined : setNewOpen(false))}
        onSave={createItem}
      >
        <FormCard title="配置信息" style={{ marginTop: 0 }}>
          <FormGrid>
            <Field label="配置键 configKey" required span={2}>
              <input ref={nKeyRef} placeholder="如：site.name" />
            </Field>
            <Field label="分组 group" span={2}>
              <input ref={nGroupRef} placeholder="如：站点信息" />
            </Field>
            <Field label="配置值 configValue" span={4}>
              <input ref={nValueRef} placeholder="值" />
            </Field>
            <Field label="说明 description" span={4}>
              <input ref={nDescRef} placeholder="选填" />
            </Field>
          </FormGrid>
        </FormCard>
      </AdminModal>
    </>
  );
}

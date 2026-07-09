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
import Link from "next/link";
import {
  AdminModal,
  Field,
  FormCard,
  FormGrid,
  SectionHeader,
  ListSkeleton,
} from "@/components/admin";
import { adminConfigApi } from "@/lib/admin-config-api";
import type { ConfigVO, ConfigItemDTO } from "@/types/admin-config";
import { useAuthStore } from "@/stores/use-auth-store";
import { toast } from "@/components/shared/toast";

/* 后端 group 是原始键（site/ai/mail…）与中文名（AI 对话/存储配置）混存，
   已知键映射为中文显示名，未知键原样透出；顺序按此表优先、其余按名称排尾。 */
const GROUP_LABEL: Record<string, string> = {
  site: "站点信息",
  ai: "AI 服务",
  "AI 对话": "AI 对话",
  mail: "邮件",
  pricing: "定价页",
  points: "积分",
  存储配置: "存储配置",
};
const GROUP_ORDER = ["site", "ai", "AI 对话", "mail", "pricing", "points", "存储配置"];
const groupLabel = (g: string) => GROUP_LABEL[g] ?? g;
const groupRank = (g: string) => {
  const i = GROUP_ORDER.indexOf(g);
  return i === -1 ? GROUP_ORDER.length : i;
};

/** JSON / 长文本值走整行多行编辑，普通短值保持右对齐单行输入。 */
const isBlockValue = (v: string) => v.length > 60 || /^[\[{]/.test(v.trim());

/* 在别处已有专用图形编辑器的配置：此处不展示 JSON，只挂跳转入口。 */
const MANAGED_ELSEWHERE: Record<string, { hint: string; href: string }> = {
  "pricing.compare": { hint: "在价格管理中编辑", href: "/admin/pricing" },
  "pricing.faq": { hint: "在价格管理中编辑", href: "/admin/pricing" },
};

/* ── 页脚链接（site.footerLinks）结构化编辑 ──────────────────────────── */
interface FooterLink {
  label: string;
  href: string;
}
interface FooterGroup {
  title: string;
  links: FooterLink[];
}

function parseFooterLinks(raw: string): FooterGroup[] {
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.map((g) => {
      const grp = g as { title?: unknown; links?: unknown };
      const links = Array.isArray(grp.links)
        ? grp.links.map((l) => {
            const lnk = l as { label?: unknown; href?: unknown };
            return { label: String(lnk.label ?? ""), href: String(lnk.href ?? "") };
          })
        : [];
      return { title: String(grp.title ?? ""), links };
    });
  } catch {
    return [];
  }
}

function serializeFooterLinks(groups: FooterGroup[]): string {
  const clean = groups
    .map((g) => ({
      title: g.title.trim(),
      links: g.links
        .map((l) => ({ label: l.label.trim(), href: l.href.trim() }))
        .filter((l) => l.label || l.href),
    }))
    .filter((g) => g.title || g.links.length > 0);
  return JSON.stringify(clean);
}

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

  // group ConfigVO[] by `group` (blank group → 其它)，按 GROUP_ORDER 定序
  const groups = useMemo(() => {
    const map = new Map<string, ConfigVO[]>();
    for (const it of items) {
      const g = it.group?.trim() || "其它";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(it);
    }
    return Array.from(map.entries()).sort(
      ([a], [b]) => groupRank(a) - groupRank(b) || a.localeCompare(b, "zh-Hans-CN"),
    );
  }, [items]);

  const dirtyCount = Object.keys(edits).length;

  // 左侧分组导航：滚动跟随高亮（IntersectionObserver 取视口上部命中的分组）
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const groupRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  useEffect(() => {
    if (groups.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActiveGroup((hit.target as HTMLElement).dataset.group ?? null);
      },
      { rootMargin: "-10% 0px -70% 0px" },
    );
    for (const el of groupRefs.current.values()) io.observe(el);
    return () => io.disconnect();
  }, [groups]);

  const jumpTo = (g: string) => {
    setActiveGroup(g);
    groupRefs.current.get(g)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

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

  /* ── 页脚链接编辑弹窗：结构化编辑，保存直接写库（不占用页面 dirty 流程） ── */
  const [flItem, setFlItem] = useState<ConfigVO | null>(null);
  const [flGroups, setFlGroups] = useState<FooterGroup[]>([]);

  const openFooterLinks = (it: ConfigVO) => {
    setFlGroups(parseFooterLinks(it.configKey in edits ? edits[it.configKey] : it.configValue));
    setFlItem(it);
  };
  const patchGroup = (gi: number, patch: Partial<FooterGroup>) =>
    setFlGroups((gs) => gs.map((g, i) => (i === gi ? { ...g, ...patch } : g)));
  const patchLink = (gi: number, li: number, patch: Partial<FooterLink>) =>
    setFlGroups((gs) =>
      gs.map((g, i) =>
        i === gi
          ? { ...g, links: g.links.map((l, j) => (j === li ? { ...l, ...patch } : l)) }
          : g,
      ),
    );

  const saveFooterLinks = useCallback(async () => {
    if (!flItem) return;
    const value = serializeFooterLinks(flGroups);
    setSaving(true);
    try {
      await ensureSession();
      const res = await adminConfigApi.save([
        {
          configKey: flItem.configKey,
          configValue: value,
          group: flItem.group,
          description: flItem.description,
        },
      ]);
      if (res.success && res.data) {
        setItems(res.data);
        // 只清掉本键的未保存草稿，保留用户在其它行的待保存修改
        setEdits((prev) => {
          const copy = { ...prev };
          delete copy[flItem.configKey];
          return copy;
        });
        toast.success("页脚链接已保存");
      } else {
        toast.error(res.message || "保存失败");
      }
    } finally {
      setSaving(false);
    }
  }, [flItem, flGroups, ensureSession]);

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
    <div className="set-page">
      {/* 无外层白面板：标题行 + 白色分组卡直接浮在 #F5F5F7 灰场上（macOS 系统设置的对比关系）；
          set-page 把标题行与内容块一起居中，超宽屏留白对称 */}
      <SectionHeader
        title="基础配置"
        sub={
          loading
            ? "站点信息与全局开关"
            : `站点信息与全局开关 · ${items.length} 项 / ${groups.length} 组，保存后生效`
        }
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
      />

      {loading ? (
        <ListSkeleton rows={3} height={150} gap={16} onField />
      ) : error ? (
        <div className="adm-empty">
          <span className="t">{error}</span>
          <button type="button" className="adm-btn ghost" onClick={load}>
            重试
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="adm-empty">
          <span className="t">暂无配置项</span>
          <span className="s">点击「新建配置」添加第一项。</span>
        </div>
      ) : (
        <div className="set-cols">
          <nav className="set-nav" aria-label="配置分组">
            {groups.map(([group, rows]) => (
              <button
                key={group}
                type="button"
                className={group === (activeGroup ?? groups[0]?.[0]) ? "on" : undefined}
                onClick={() => jumpTo(group)}
              >
                {groupLabel(group)}
                <span className="n">{rows.length}</span>
              </button>
            ))}
          </nav>

          <div className="set-wrap">
            {groups.map(([group, rows]) => (
              <div
                className="set-group"
                key={group}
                data-group={group}
                ref={(el) => {
                  if (el) groupRefs.current.set(group, el);
                  else groupRefs.current.delete(group);
                }}
              >
                <div className="gh">
                  {groupLabel(group)}
                  <small>{rows.length} 项</small>
                </div>
                <div className="set-list">
                  {rows.map((it) => {
                    const managed = MANAGED_ELSEWHERE[it.configKey];
                    const isFooterLinks = it.configKey === "site.footerLinks";
                    const secret = /secret|password|access[_-]?key|api[_-]?key/i.test(it.configKey);
                    const block = !managed && !isFooterLinks && !secret && isBlockValue(it.configValue);
                    const fl = isFooterLinks ? parseFooterLinks(valueOf(it)) : null;
                    return (
                      <div className={`set-row${block ? " block" : ""}`} key={it.configKey}>
                        <div className="lab">
                          {isFooterLinks ? "页脚链接（前台页脚的链接分组）" : it.description || it.configKey}
                          <span className="key">{it.configKey}</span>
                        </div>
                        {managed ? (
                          <Link href={managed.href} className="set-link">
                            {managed.hint} ›
                          </Link>
                        ) : isFooterLinks && fl ? (
                          <>
                            <span className="set-summary">
                              {fl.length} 组 · {fl.reduce((n, g) => n + g.links.length, 0)} 个链接
                            </span>
                            <button
                              type="button"
                              className="adm-btn ghost"
                              onClick={() => openFooterLinks(it)}
                            >
                              编辑
                            </button>
                          </>
                        ) : block ? (
                          <textarea
                            value={valueOf(it)}
                            onChange={(e) => onEdit(it, e.target.value)}
                            aria-label={it.configKey}
                            rows={3}
                            spellCheck={false}
                          />
                        ) : (
                          <input
                            /* 密钥类配置值掩码显示（仍可编辑；聚焦后浏览器行为同密码框） */
                            type={secret ? "password" : "text"}
                            value={valueOf(it)}
                            onChange={(e) => onEdit(it, e.target.value)}
                            aria-label={it.configKey}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {/* 页脚链接结构化编辑（site.footerLinks，替代裸 JSON） */}
      <AdminModal
        open={flItem != null}
        title="编辑页脚链接"
        subtitle="前台页脚的链接分组，保存后即时生效（/api/site/footer）"
        saveLabel={saving ? "保存中…" : "保存"}
        onClose={() => (saving ? undefined : setFlItem(null))}
        onSave={saveFooterLinks}
      >
        {flGroups.map((g, gi) => (
          <FormCard
            key={gi}
            title={
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {g.title.trim() || `分组 ${gi + 1}`}
                <button
                  type="button"
                  className="adm-chip"
                  style={{ marginLeft: "auto" }}
                  onClick={() => setFlGroups((gs) => gs.filter((_, i) => i !== gi))}
                >
                  删除分组
                </button>
              </span>
            }
          >
            <FormGrid>
              <Field label="分组标题" span={2}>
                <input
                  value={g.title}
                  placeholder="如：产品"
                  onChange={(e) => patchGroup(gi, { title: e.target.value })}
                />
              </Field>
            </FormGrid>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              {g.links.map((l, li) => (
                <div key={li} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div className="fld" style={{ flex: 1 }}>
                    <input
                      value={l.label}
                      placeholder="名称（如：图片生成）"
                      onChange={(e) => patchLink(gi, li, { label: e.target.value })}
                    />
                  </div>
                  <div className="fld" style={{ flex: 2 }}>
                    <input
                      value={l.href}
                      placeholder="链接（如：/studio?type=image）"
                      onChange={(e) => patchLink(gi, li, { href: e.target.value })}
                    />
                  </div>
                  <button
                    type="button"
                    className="adm-chip"
                    onClick={() =>
                      patchGroup(gi, { links: g.links.filter((_, j) => j !== li) })
                    }
                  >
                    移除
                  </button>
                </div>
              ))}
              <div>
                <button
                  type="button"
                  className="adm-chip"
                  onClick={() =>
                    patchGroup(gi, { links: [...g.links, { label: "", href: "" }] })
                  }
                >
                  + 添加链接
                </button>
              </div>
            </div>
          </FormCard>
        ))}
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            className="adm-btn ghost"
            onClick={() =>
              setFlGroups((gs) => [...gs, { title: "", links: [{ label: "", href: "" }] }])
            }
          >
            + 添加分组
          </button>
        </div>
      </AdminModal>
    </div>
  );
}

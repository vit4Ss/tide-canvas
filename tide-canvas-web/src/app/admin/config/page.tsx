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
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import {
  AdminModal,
  Field,
  FormCard,
  FormGrid,
  SectionHeader,
  ListSkeleton,
  SwitchToggle,
} from "@/components/admin";
import { adminConfigApi } from "@/lib/admin-config-api";
import type { ConfigVO, ConfigItemDTO } from "@/types/admin-config";
import { useAuthStore } from "@/stores/use-auth-store";
import { confirmDialog } from "@/components/shared/confirm";
import { toast } from "@/components/shared/toast";

/* 后端 group 是原始键（site/ai/mail…）与中文名（AI 对话/存储配置）混存，
   已知键映射为中文显示名，未知键原样透出；顺序按此表优先、其余按名称排尾。 */
const GROUP_LABEL: Record<string, string> = {
  site: "站点信息",
  home: "首页",
  auth: "注册登录",
  ai: "AI 服务",
  "AI 对话": "AI 对话",
  mail: "邮件",
  pricing: "定价页",
  points: "积分",
  供应商余额: "供应商余额",
  内容拆解: "内容拆解",
  存储配置: "存储配置",
};
const GROUP_ORDER = [
  "site",
  "home",
  "auth",
  "ai",
  "AI 对话",
  "mail",
  "pricing",
  "points",
  "供应商余额",
  "内容拆解",
  "存储配置",
];
const GROUP_DESCRIPTION: Record<string, string> = {
  site: "站点名称、品牌信息与公共页面内容",
  home: "首页展示与内容入口",
  auth: "账号注册与登录策略",
  ai: "AI 服务接入与生成参数",
  "AI 对话": "对话模型与会话行为",
  mail: "邮件发送服务与发件身份",
  pricing: "公开定价页的基础信息",
  points: "积分规则与默认额度",
  供应商余额: "供应商接入已收纳到余额监控页，按供应商就地配置开关、凭证与预警线",
  内容拆解: "TikHub 多平台解析服务，用于作品拆解与账号洞察",
  存储配置: "文件存储与访问地址",
};
const groupLabel = (g: string) => GROUP_LABEL[g] ?? g;
const groupDescription = (g: string) => GROUP_DESCRIPTION[g] ?? "系统运行所需的相关配置";
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
  "home.global": { hint: "在首页楼层中编辑", href: "/admin/home-floors" },
  // 积分 4 键的编辑入口收口到积分管理页的「积分全局配置」面板，
  // 避免与本页双入口编辑同一批 sys_config 键。
  "points.checkinDaily": { hint: "在积分管理中编辑", href: "/admin/points" },
  "points.checkinMonthlyCap": { hint: "在积分管理中编辑", href: "/admin/points" },
  "points.inviteReward": { hint: "在积分管理中编辑", href: "/admin/points" },
  "points.signupBonus": { hint: "在积分管理中编辑", href: "/admin/points" },
};

/* 开关型配置键：渲染为切换开关而非自由文本（"1"=开启，其余=关闭），
   附各自的状态文案。存的仍是 "1"/"0" 字符串，与后端读取口径一致。 */
const BOOL_KEYS: Record<string, { on: string; off: string }> = {
  "auth.registerClosed": { on: "已关闭注册：新用户无法自助注册", off: "开放注册：用户可自助注册" },
  "storage.ossAccelerateEnabled": {
    on: "已开启：上传与上游取图使用 OSS 传输加速；重启后端生效",
    off: "已关闭：上传使用地域 OSS，模型取图使用 CDN（未配置则地域 OSS）；重启后端生效",
  },
  "balance.dlapi.enabled": { on: "已启用 DLAPI 余额监控", off: "已停用 DLAPI 余额监控" },
  "balance.mikoto.enabled": { on: "已启用 Mikoto 余额监控", off: "已停用 Mikoto 余额监控" },
  "balance.ccgo.enabled": { on: "已启用 CCGO 余额监控", off: "已停用 CCGO 余额监控" },
  "balance.ccgo2.enabled": { on: "已启用 CCGO2 余额监控", off: "已停用 CCGO2 余额监控" },
  "balance.dimensio.enabled": { on: "已启用 Dimensio 余额监控", off: "已停用 Dimensio 余额监控" },
  "balance.uniart.enabled": { on: "已启用 Uniart 余额监控", off: "已停用 Uniart 余额监控" },
  "balance.wxart.enabled": { on: "已启用 wxart 余额监控", off: "已停用 wxart 余额监控" },
  "balance.secureskill.enabled": { on: "已启用 secure-skill 余额监控", off: "已停用 secure-skill 余额监控" },
  "social.tikhub.enabled": { on: "已启用多平台内容拆解", off: "已停用多平台内容拆解" },
};

const NUMBER_KEYS: Record<string, { min: number; max?: number; step?: number | "any" }> = {
  "ai.userConcurrentLimit": { min: 1, max: 100, step: 1 },
  "balance.dlapi.lowBalance": { min: 0, step: "any" },
  "balance.mikoto.lowBalance": { min: 0, step: "any" },
  "balance.ccgo.lowBalance": { min: 0, step: "any" },
  "balance.ccgo2.lowBalance": { min: 0, step: "any" },
  "balance.dimensio.lowBalance": { min: 0, step: "any" },
  "balance.uniart.lowBalance": { min: 0, step: "any" },
  "balance.wxart.lowBalance": { min: 0, step: "any" },
  "balance.secureskill.lowBalance": { min: 0, step: "any" },
};

const SUPPLIER_BALANCE_SECRET_MASK = "••••••••";
const SUPPLIER_BALANCE_SECRET_KEYS = new Set([
  "balance.dlapi.accessToken",
  "balance.mikoto.accessToken",
  "balance.ccgo.accessToken",
  "balance.ccgo2.accessToken",
  "balance.dimensio.accessToken",
  "balance.uniart.accessToken",
  "balance.wxart.accessToken",
  "balance.secureskill.accessToken",
  "social.tikhub.apiKey",
]);

/* 基线键（页面/策略消费方仍在读，后端同样拒绝删除）——不展示删除入口。
   与 g5_config.go 的 baselineConfigKeys 保持一致。 */
const BASELINE_KEYS = new Set([
  "site.footerLinks",
  "home.global",
  "auth.registerClosed",
  "pricing.compare",
  "pricing.faq",
  "llm.contextTokenLimit",
  "llm.compressAtTokens",
  "market.typeOrder",
  "ai.userConcurrentLimit",
  "points.checkinDaily",
  "points.checkinMonthlyCap",
  "points.inviteReward",
  "points.signupBonus",
  "storage.ossAccelerateEnabled",
  "social.tikhub.enabled",
  "social.tikhub.baseUrl",
  "social.tikhub.apiKey",
  "balance.dlapi.enabled",
  "balance.dlapi.userId",
  "balance.dlapi.accessToken",
  "balance.dlapi.lowBalance",
  "balance.mikoto.enabled",
  "balance.mikoto.email",
  "balance.mikoto.password",
  "balance.mikoto.accessToken",
  "balance.mikoto.lowBalance",
  "balance.ccgo.enabled",
  "balance.ccgo.email",
  "balance.ccgo.password",
  "balance.ccgo.accessToken",
  "balance.ccgo.lowBalance",
  "balance.ccgo2.enabled",
  "balance.ccgo2.email",
  "balance.ccgo2.password",
  "balance.ccgo2.accessToken",
  "balance.ccgo2.lowBalance",
  "balance.dimensio.enabled",
  "balance.dimensio.username",
  "balance.dimensio.password",
  "balance.dimensio.accessToken",
  "balance.dimensio.lowBalance",
  "balance.uniart.enabled",
  "balance.uniart.userId",
  "balance.uniart.accessToken",
  "balance.uniart.lowBalance",
  "balance.wxart.enabled",
  "balance.wxart.userId",
  "balance.wxart.accessToken",
  "balance.wxart.lowBalance",
  "balance.secureskill.enabled",
  "balance.secureskill.email",
  "balance.secureskill.password",
  "balance.secureskill.accessToken",
  "balance.secureskill.lowBalance",
]);

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
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  // Edited values keyed by configKey (only changed keys are present).
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [newOpen, setNewOpen] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);

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
        setFeedback(null);
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
    const frame = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frame);
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
  const groupRefs = useRef<Map<string, HTMLElement>>(new Map());
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
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    groupRefs.current
      .get(g)
      ?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  };

  const valueOf = (it: ConfigVO) => (it.configKey in edits ? edits[it.configKey] : it.configValue);

  const onEdit = (it: ConfigVO, next: string) => {
    setFeedback(null);
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
    setFeedback(null);
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
        const message = `已保存 ${changed.length} 项配置`;
        setFeedback({ tone: "success", message });
        toast.success(message);
      } else {
        const message = res.message || "保存配置失败";
        setFeedback({ tone: "error", message });
        toast.error(message);
      }
    } catch {
      const message = "保存配置失败，请稍后重试";
      setFeedback({ tone: "error", message });
      toast.error(message);
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
    if (!flItem) return false;
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
        return false;
      }
    } catch {
      toast.error("保存失败，请稍后重试");
      return false;
    } finally {
      setSaving(false);
    }
  }, [flItem, flGroups, ensureSession]);

  /* 删除非基线配置键（此前 config 无删除通道，误建键只能进 DB 手清）。 */
  const removeItem = useCallback(
    async (it: ConfigVO) => {
      if (
        !(await confirmDialog({
          title: "删除配置",
          message: `确认删除配置 ${it.configKey}？删除后前台读取该键将回退到默认行为，此操作不可恢复。`,
          confirmText: "确认删除",
          danger: true,
        }))
      ) {
        return;
      }
      setSaving(true);
      try {
        await ensureSession();
        const res = await adminConfigApi.remove(it.id);
        if (res.success) {
          setItems((prev) => prev.filter((row) => row.id !== it.id));
          setEdits((prev) => {
            const copy = { ...prev };
            delete copy[it.configKey];
            return copy;
          });
          toast.success(`配置 ${it.configKey} 已删除`);
        } else {
          toast.error(res.message || "删除配置失败");
        }
      } catch {
        toast.error("删除配置失败，请稍后重试");
      } finally {
        setSaving(false);
      }
    },
    [ensureSession],
  );

  const createItem = useCallback(async () => {
    const key = nKeyRef.current?.value.trim();
    if (!key) {
      setNewError("请输入唯一的配置键");
      nKeyRef.current?.focus();
      return false;
    }
    setNewError(null);
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
        toast.success(`配置 ${key} 已创建`);
      } else {
        const message = res.message || "创建配置失败";
        setNewError(message);
        toast.error(message);
        return false;
      }
    } catch {
      const message = "创建配置失败，请稍后重试";
      setNewError(message);
      toast.error(message);
      return false;
    } finally {
      setSaving(false);
    }
  }, [ensureSession]);

  return (
    <div className="set-page config-admin-page" aria-busy={loading || saving}>
      <SectionHeader
        title="基础配置"
        sub={
          loading
            ? "站点信息、服务接入与全局运行参数"
            : `${items.length} 项配置，分为 ${groups.length} 组 · 修改仅在保存后生效`
        }
        tools={
          <>
            <button
              type="button"
              className="adm-btn ghost"
              aria-label="新建系统配置"
              onClick={() => {
                setNewError(null);
                setNewOpen(true);
              }}
            >
              <Plus aria-hidden size={14} />
              新建配置
            </button>
            <button
              type="button"
              className="adm-btn"
              disabled={dirtyCount === 0 || saving}
              onClick={save}
              aria-label={dirtyCount > 0 ? `保存 ${dirtyCount} 项配置变更` : "当前没有待保存变更"}
            >
              <Save aria-hidden size={14} />
              {saving ? "保存中…" : dirtyCount > 0 ? `保存变更 (${dirtyCount})` : "保存变更"}
            </button>
          </>
        }
      />

      {!loading && (dirtyCount > 0 || feedback) ? (
        <div
          className={`config-save-state ${
            feedback?.tone === "error" ? "is-error" : dirtyCount > 0 ? "is-dirty" : "is-success"
          }`}
          role={feedback?.tone === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          <span className="config-save-state-icon" aria-hidden>
            {feedback?.tone === "error" || dirtyCount > 0 ? (
              <CircleAlert size={17} />
            ) : (
              <CheckCircle2 size={17} />
            )}
          </span>
          <div className="config-save-state-copy">
            <strong>
              {feedback?.tone === "error"
                ? "保存未完成"
                : dirtyCount > 0
                  ? `${dirtyCount} 项修改尚未保存`
                  : "配置已同步"}
            </strong>
            <span>
              {feedback?.tone === "error"
                ? `${feedback.message}${dirtyCount > 0 ? `，${dirtyCount} 项修改仍保留在页面中。` : ""}`
                : dirtyCount > 0
                  ? "继续检查其余分组，确认后统一保存。"
                  : feedback?.message}
            </span>
          </div>
          {dirtyCount > 0 ? (
            <button
              type="button"
              className="config-reset-button"
              onClick={async () => {
                if (
                  !(await confirmDialog({
                    title: "撤销未保存修改",
                    message: `确认撤销当前 ${dirtyCount} 项未保存修改？页面会恢复到最近一次已保存的配置，此操作不可恢复。`,
                    confirmText: "确认撤销",
                    danger: true,
                  }))
                ) {
                  return;
                }
                setEdits({});
                setFeedback(null);
              }}
              aria-label={`撤销全部 ${dirtyCount} 项未保存修改`}
            >
              <RotateCcw aria-hidden size={13} />
              撤销修改
            </button>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <ListSkeleton rows={3} height={150} gap={16} onField />
      ) : error ? (
        <div className="adm-empty config-state-card" role="alert">
          <CircleAlert aria-hidden size={22} />
          <span className="t">配置加载失败</span>
          <span className="s">{error}。请检查网络连接后重试。</span>
          <button type="button" className="adm-btn ghost" onClick={load}>
            重新加载
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="adm-empty config-state-card">
          <span className="t">还没有系统配置</span>
          <span className="s">创建第一项配置后，它会按分组显示在这里。</span>
          <button
            type="button"
            className="adm-btn"
            onClick={() => {
              setNewError(null);
              setNewOpen(true);
            }}
          >
            <Plus aria-hidden size={14} />
            新建配置
          </button>
        </div>
      ) : (
        <div className="set-cols">
          <nav className="set-nav" aria-label="配置分组">
            {groups.map(([group, rows]) => {
              const groupDirty = rows.filter((row) => row.configKey in edits).length;
              return (
                <button
                  key={group}
                  type="button"
                  className={group === (activeGroup ?? groups[0]?.[0]) ? "on" : undefined}
                  onClick={() => jumpTo(group)}
                  aria-current={group === (activeGroup ?? groups[0]?.[0]) ? "location" : undefined}
                >
                  {groupLabel(group)}
                  <span className={`n${groupDirty > 0 ? " has-dirty" : ""}`}>
                    {groupDirty > 0 ? `${groupDirty} 未保存` : rows.length}
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="set-wrap">
            {groups.map(([group, rows], groupIndex) => {
              const groupDirty = rows.filter((row) => row.configKey in edits).length;
              const headingId = `config-group-${groupIndex}`;
              return (
                <section
                  className="set-group"
                  key={group}
                  data-group={group}
                  aria-labelledby={headingId}
                  ref={(el) => {
                    if (el) groupRefs.current.set(group, el);
                    else groupRefs.current.delete(group);
                  }}
                >
                  <div className="gh config-group-heading">
                    <div>
                      <h2 id={headingId}>{groupLabel(group)}</h2>
                      <p>{groupDescription(group)}</p>
                    </div>
                    <span className={groupDirty > 0 ? "config-group-count is-dirty" : "config-group-count"}>
                      {groupDirty > 0 ? `${groupDirty} 项待保存` : `${rows.length} 项`}
                    </span>
                  </div>
                  {group === "供应商余额" ? (
                    /* 供应商接入项数量多且成组出现，收纳为跳转入口：
                       在余额监控页按供应商就地编辑，避免本页 30+ 行的平铺。 */
                    <div className="set-list">
                      <div className="set-row">
                        <div className="lab">
                          <span className="config-label-line">
                            <span>按供应商分组维护开关、凭证与低余额预警线</span>
                          </span>
                          <span className="key">balance.*（{rows.length} 项）</span>
                        </div>
                        <Link href="/admin/balances" className="set-link" aria-label="在余额监控页配置供应商接入">
                          在余额监控中编辑
                          <ArrowUpRight aria-hidden size={13} />
                        </Link>
                      </div>
                    </div>
                  ) : (
                  <div className="set-list">
                    {rows.map((it) => {
                      const managed = MANAGED_ELSEWHERE[it.configKey];
                      const isFooterLinks = it.configKey === "site.footerLinks";
                      const boolCfg = BOOL_KEYS[it.configKey];
                      const numberCfg = NUMBER_KEYS[it.configKey];
                      const secret =
                        SUPPLIER_BALANCE_SECRET_KEYS.has(it.configKey) ||
                        /secret|password|access[_-]?key|api[_-]?key/i.test(it.configKey);
                      const block =
                        !managed && !isFooterLinks && !boolCfg && !numberCfg && !secret && isBlockValue(it.configValue);
                      const fl = isFooterLinks ? parseFooterLinks(valueOf(it)) : null;
                      const dirty = it.configKey in edits;
                      const displayLabel = isFooterLinks
                        ? "页脚链接（前台页脚的链接分组）"
                        : it.description || it.configKey;
                      const controlLabel = `${displayLabel}（${it.configKey}）`;
                      return (
                        <div
                          className={`set-row${block ? " block" : ""}${dirty ? " is-dirty" : ""}`}
                          key={it.configKey}
                        >
                          <div className="lab">
                            <span className="config-label-line">
                              <span>{displayLabel}</span>
                              {dirty ? <span className="config-dirty-tag">已修改</span> : null}
                              {!BASELINE_KEYS.has(it.configKey) && (
                                <button
                                  type="button"
                                  className="config-del"
                                  onClick={() => removeItem(it)}
                                  aria-label={`删除配置 ${it.configKey}`}
                                  title="删除配置"
                                >
                                  <Trash2 aria-hidden size={12} />
                                </button>
                              )}
                            </span>
                            <span className="key">{it.configKey}</span>
                          </div>
                          {managed ? (
                            <Link href={managed.href} className="set-link" aria-label={`${managed.hint}：${displayLabel}`}>
                              {managed.hint}
                              <ArrowUpRight aria-hidden size={13} />
                            </Link>
                          ) : isFooterLinks && fl ? (
                            <div className="config-row-actions">
                              <span className="set-summary">
                                {fl.length} 组 · {fl.reduce((n, g) => n + g.links.length, 0)} 个链接
                              </span>
                              <button
                                type="button"
                                className="adm-btn ghost"
                                onClick={() => openFooterLinks(it)}
                                aria-label="编辑前台页脚链接"
                              >
                                编辑
                              </button>
                            </div>
                          ) : boolCfg ? (
                            <div className="config-row-actions">
                              <span className="set-summary">
                                {valueOf(it).trim() === "1" ? boolCfg.on : boolCfg.off}
                              </span>
                              <SwitchToggle
                                checked={valueOf(it).trim() === "1"}
                                onChange={(next) => onEdit(it, next ? "1" : "0")}
                                aria-label={controlLabel}
                              />
                            </div>
                          ) : block ? (
                            <textarea
                              value={valueOf(it)}
                              onChange={(e) => onEdit(it, e.target.value)}
                              aria-label={controlLabel}
                              rows={3}
                              spellCheck={false}
                            />
                          ) : (
                            <input
                              type={secret ? "password" : numberCfg ? "number" : "text"}
                              value={valueOf(it)}
                              onChange={(e) => onEdit(it, e.target.value)}
                              onFocus={secret ? (e) => {
                                if (e.currentTarget.value === SUPPLIER_BALANCE_SECRET_MASK) {
                                  e.currentTarget.select();
                                }
                              } : undefined}
                              onClick={secret ? (e) => {
                                if (e.currentTarget.value === SUPPLIER_BALANCE_SECRET_MASK) {
                                  e.currentTarget.select();
                                }
                              } : undefined}
                              aria-label={controlLabel}
                              min={numberCfg?.min}
                              max={numberCfg?.max}
                              step={numberCfg?.step}
                              inputMode={numberCfg ? "decimal" : undefined}
                              autoComplete={secret ? "new-password" : undefined}
                              placeholder={
                                secret
                                  ? SUPPLIER_BALANCE_SECRET_KEYS.has(it.configKey)
                                    ? "粘贴新令牌"
                                    : "输入新值"
                                  : undefined
                              }
                              spellCheck={false}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}

      <AdminModal
        open={newOpen}
        size="md"
        title="新建配置"
        subtitle="添加系统运行参数；相同 configKey 会覆盖现有配置"
        saveLabel="创建配置"
        onClose={() => {
          if (!saving) {
            setNewError(null);
            setNewOpen(false);
          }
        }}
        onSave={createItem}
      >
        <FormCard title="配置信息" style={{ marginTop: 0 }}>
          <FormGrid>
            <Field
              label="配置键 configKey"
              required
              span={2}
              hint={newError ? <span className="config-field-error" role="alert">{newError}</span> : "建议使用 domain.name 形式"}
            >
              <input
                ref={nKeyRef}
                placeholder="如：site.name"
                aria-invalid={Boolean(newError)}
                onChange={() => setNewError(null)}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field label="分组 group" span={2} hint="用于页面中的配置分组">
              <input ref={nGroupRef} placeholder="如：site" autoComplete="off" />
            </Field>
            <Field label="配置值 configValue" span={4}>
              <input ref={nValueRef} placeholder="输入配置值" autoComplete="off" />
            </Field>
            <Field label="说明 description" span={4} hint="使用面向运营人员的简短说明">
              <input ref={nDescRef} placeholder="如：前台展示的站点名称" />
            </Field>
          </FormGrid>
        </FormCard>
      </AdminModal>

      <AdminModal
        open={flItem != null}
        size="lg"
        title="编辑页脚链接"
        subtitle="维护前台页脚的分组与链接，保存后即时生效"
        saveLabel="保存页脚"
        onClose={() => (saving ? undefined : setFlItem(null))}
        onSave={saveFooterLinks}
      >
        <div className="config-footer-editor">
          {flGroups.length === 0 ? (
            <div className="config-footer-empty">
              <strong>页脚还没有链接分组</strong>
              <span>先添加一个分组，再填写链接名称和地址。</span>
            </div>
          ) : null}
          {flGroups.map((g, gi) => (
            <FormCard
              key={gi}
              title={
                <span className="config-footer-title">
                  <span>{g.title.trim() || `分组 ${gi + 1}`}</span>
                  <button
                    type="button"
                    className="adm-chip"
                    onClick={() => setFlGroups((gs) => gs.filter((_, i) => i !== gi))}
                    aria-label={`删除${g.title.trim() || `分组 ${gi + 1}`}`}
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
                    aria-label={`第 ${gi + 1} 个页脚分组的标题`}
                  />
                </Field>
              </FormGrid>
              <div className="config-footer-links">
                {g.links.map((l, li) => (
                  <div key={li} className="config-footer-link-row">
                    <div className="fld config-footer-link-name">
                      <label htmlFor={`footer-link-${gi}-${li}-label`}>链接名称</label>
                      <input
                        id={`footer-link-${gi}-${li}-label`}
                        value={l.label}
                        placeholder="如：图片生成"
                        onChange={(e) => patchLink(gi, li, { label: e.target.value })}
                      />
                    </div>
                    <div className="fld config-footer-link-url">
                      <label htmlFor={`footer-link-${gi}-${li}-href`}>链接地址</label>
                      <input
                        id={`footer-link-${gi}-${li}-href`}
                        value={l.href}
                        placeholder="如：/studio?type=image"
                        onChange={(e) => patchLink(gi, li, { href: e.target.value })}
                        spellCheck={false}
                      />
                    </div>
                    <button
                      type="button"
                      className="adm-chip config-remove-link"
                      onClick={() =>
                        patchGroup(gi, { links: g.links.filter((_, j) => j !== li) })
                      }
                      aria-label={`移除${l.label.trim() || `第 ${li + 1} 个链接`}`}
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
                    <Plus aria-hidden size={12} />
                    添加链接
                  </button>
                </div>
              </div>
            </FormCard>
          ))}
          <div className="config-add-footer-group">
            <button
              type="button"
              className="adm-btn ghost"
              onClick={() =>
                setFlGroups((gs) => [...gs, { title: "", links: [{ label: "", href: "" }] }])
              }
            >
              <Plus aria-hidden size={14} />
              添加分组
            </button>
          </div>
        </div>
      </AdminModal>

      <style>{`
        .config-admin-page .config-save-state {
          display: flex;
          align-items: center;
          gap: 12px;
          min-height: 52px;
          margin: 0 0 16px;
          padding: 10px 12px;
          border: 1px solid var(--border);
          border-radius: var(--r-lg);
          background: var(--surface);
          color: var(--text-dim);
        }
        .config-admin-page .config-save-state.is-dirty {
          border-color: color-mix(in srgb, var(--warn) 28%, var(--border));
          background: var(--warn-soft);
        }
        .config-admin-page .config-save-state.is-error {
          border-color: color-mix(in srgb, var(--danger) 28%, var(--border));
          background: var(--danger-soft);
        }
        .config-admin-page .config-save-state.is-success {
          border-color: color-mix(in srgb, var(--ok) 24%, var(--border));
          background: var(--ok-soft);
        }
        .config-admin-page .config-save-state-icon {
          display: grid;
          flex: none;
          place-items: center;
          color: var(--warn);
        }
        .config-admin-page .config-save-state.is-error .config-save-state-icon { color: var(--danger); }
        .config-admin-page .config-save-state.is-success .config-save-state-icon { color: var(--ok); }
        .config-admin-page .config-save-state-copy {
          display: flex;
          flex: 1;
          min-width: 0;
          flex-direction: column;
          gap: 2px;
          font-size: 12px;
          line-height: 1.45;
        }
        .config-admin-page .config-save-state-copy strong {
          color: var(--text);
          font-size: 12.5px;
          font-weight: 600;
        }
        .config-admin-page .config-reset-button {
          display: inline-flex;
          flex: none;
          align-items: center;
          gap: 5px;
          min-height: 30px;
          padding: 0 8px;
          border: 0;
          border-radius: var(--r-sm);
          background: transparent;
          color: var(--text-dim);
          cursor: pointer;
          font: inherit;
          font-size: 12px;
          font-weight: 500;
        }
        .config-admin-page .config-reset-button:hover { background: rgba(0, 0, 0, 0.05); color: var(--text); }
        .config-admin-page .config-reset-button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .config-admin-page .config-state-card {
          min-height: 260px;
          border: 1px solid var(--border);
          border-radius: var(--r-lg);
          background: var(--surface);
          color: var(--text-faint);
        }
        .config-admin-page .config-group-heading {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 16px;
          padding: 0 2px 10px;
        }
        .config-admin-page .config-group-heading h2 {
          margin: 0;
          color: var(--text-title);
          font-size: 14px;
          font-weight: 600;
          line-height: 1.4;
        }
        .config-admin-page .config-group-heading p {
          max-width: 64ch;
          margin: 3px 0 0;
          color: var(--text-faint);
          font-size: 12px;
          font-weight: 400;
          line-height: 1.5;
        }
        .config-admin-page .config-group-count {
          flex: none;
          padding-bottom: 1px;
          color: var(--text-faint);
          font-family: var(--mono);
          font-size: 11.5px;
          font-weight: 400;
        }
        .config-admin-page .config-group-count.is-dirty,
        .config-admin-page .set-nav .n.has-dirty { color: var(--warn); }
        .config-admin-page .set-row.is-dirty { background: color-mix(in srgb, var(--warn-soft) 52%, var(--surface)); }
        .config-admin-page .config-label-line {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }
        .config-admin-page .config-label-line > span:first-child {
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .config-admin-page .config-dirty-tag {
          flex: none;
          border-radius: var(--r-sm);
          color: var(--warn);
          font-size: 11px;
          font-weight: 600;
        }
        .config-admin-page .config-row-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
        }
        .config-admin-page .set-link { display: inline-flex; align-items: center; gap: 4px; }
        .config-admin-page .config-del {
          display: inline-grid;
          flex: none;
          place-items: center;
          width: 22px;
          height: 22px;
          border: 0;
          border-radius: var(--r-sm);
          background: transparent;
          color: var(--text-faint);
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.16s, color 0.16s, background 0.16s;
        }
        .config-admin-page .set-row:hover .config-del,
        .config-admin-page .config-del:focus-visible { opacity: 1; }
        .config-admin-page .config-del:hover { background: var(--danger-soft); color: var(--danger); }
        .config-admin-page .config-del:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .config-admin-page .config-field-error { color: var(--danger); }
        .config-admin-page input[aria-invalid="true"] { border-color: var(--danger); }
        .config-admin-page .config-footer-title {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
        }
        .config-admin-page .config-footer-title .adm-chip { margin-left: auto; }
        .config-admin-page .config-footer-links {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 16px;
        }
        .config-admin-page .config-footer-link-row {
          display: grid;
          grid-template-columns: minmax(140px, 0.8fr) minmax(240px, 1.6fr) auto;
          gap: 10px;
          align-items: end;
        }
        .config-admin-page .config-remove-link { margin-bottom: 2px; }
        .config-admin-page .config-add-footer-group { margin-top: 12px; }
        .config-admin-page .config-footer-empty {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-top: 18px;
          padding: 18px;
          border: 1px dashed var(--border-strong);
          border-radius: var(--r-lg);
          color: var(--text-faint);
          font-size: 12.5px;
          text-align: center;
        }
        .config-admin-page .config-footer-empty strong { color: var(--text); font-size: 13px; }
        @media (max-width: 1100px) {
          .config-admin-page .set-nav {
            flex-wrap: nowrap;
            overflow-x: auto;
            padding-bottom: 4px;
          }
          .config-admin-page .set-nav button { flex: none; min-width: 132px; }
        }
        @media (max-width: 720px) {
          .config-admin-page .config-save-state { align-items: flex-start; flex-wrap: wrap; }
          .config-admin-page .config-reset-button { margin-left: 29px; }
          .config-admin-page .config-group-heading { align-items: flex-start; }
          .config-admin-page .config-row-actions {
            align-items: stretch;
            flex-direction: column;
            width: 100%;
          }
          .config-admin-page .config-row-actions .set-summary { white-space: normal; }
          .config-admin-page .config-footer-link-row { grid-template-columns: 1fr; }
          .config-admin-page .config-remove-link { justify-self: start; margin: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .config-admin-page *, .config-admin-page *::before, .config-admin-page *::after {
            scroll-behavior: auto !important;
          }
        }
      `}</style>
    </div>
  );
}

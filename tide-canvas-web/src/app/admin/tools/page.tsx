"use client";

/* ============================================================================
   /admin/tools — 工具管理 (AI 工具).

   Wired to the REAL admin API (/api/admin/tools → ai_tools). These rows drive
   the public /tools/<key> pages, the homepage 能力卡 and the 创作台 one-click
   operations — 启用、文案与生成参数全后台驱动.

   Tools are CODE-registered（代码注册能力，配置决定策略）: each row corresponds
   to a registry handler, so there is deliberately NO 新增/删除 here — the page
   only configures 启用 / 独立工具页 / 文案 / 预置提示词 / 默认参数 and order.

   Keeps the liuguang admin markup/classes + shared components (Panel /
   StatusPill / SwitchToggle / AdminModal / FormCard / FormGrid / Field /
   FormSection / MChips). The ordered `.floor` row list (拖拽手柄 +
   上移/下移, 启用 toggle) mirrors /admin/home-floors — drag 与按钮共用同一个
   reorder 端点。

   AdminModal contract: onSave 返回 false 时弹窗保持打开（校验/接口失败），
   成功路径由 onSaved 关闭并刷新（2026-07 修正旧「无条件关弹窗」quirk）。

   Client component (toggles + reorder + modal).
   ============================================================================ */

import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical, RefreshCw } from "lucide-react";
import {
  AdminModal,
  AdminAlert,
  AdminEmptyState,
  Field,
  FormCard,
  FormGrid,
  FormSection,
  MChips,
  Panel,
  StatusPill,
  SwitchToggle,
  ListSkeleton,
} from "@/components/admin";
import { useAuthStore } from "@/stores/use-auth-store";
import { toast } from "@/components/shared/toast";
import { adminToolsApi } from "@/lib/admin-tools-api";
import type { AdminToolUpdateDTO, AdminToolVO } from "@/types/admin-tools";

export default function AdminToolsPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);

  const [tools, setTools] = useState<AdminToolVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminToolVO | null>(null);
  const [reordering, setReordering] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await ensureSession();
      const res = await adminToolsApi.list();
      if (res.success && res.data) setTools(res.data);
      else setError(res.message || "加载失败");
    } catch {
      setError("加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [ensureSession]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frame);
  }, [load]);

  const openEdit = (tool: AdminToolVO) => setEditing(tool);
  const close = () => setEditing(null);

  const toggleEnabled = async (tool: AdminToolVO, next: boolean) => {
    try {
      const res = await adminToolsApi.setStatus(tool.id, { enabled: next });
      if (!res.success) toast.error(res.message || "工具状态更新失败");
    } catch {
      toast.error("工具状态更新失败，请稍后重试");
    } finally {
      load(); // 始终以服务端真值回滚开关
    }
  };

  // Persist a new ordering (shared by 上移/下移 buttons and drag-drop).
  const applyOrder = useCallback(
    async (next: AdminToolVO[]) => {
      if (reordering) return;
      setTools(next); // optimistic
      setReordering(true);
      try {
        const res = await adminToolsApi.reorder({ ids: next.map((t) => t.id) });
        if (!res.success) {
          toast.error(res.message || "排序保存失败");
          await load();
        }
      } catch {
        toast.error("排序保存失败，请稍后重试");
        await load();
      } finally {
        setReordering(false);
      }
    },
    [load, reordering],
  );

  // Move tool at index `from` to `from+dir`.
  const move = (from: number, dir: -1 | 1) => {
    if (reordering) return;
    const to = from + dir;
    if (to < 0 || to >= tools.length) return;
    const next = [...tools];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    applyOrder(next);
  };

  // 拖拽排序：只允许从手柄起拖（dragFromHandle 门闩），行整体作为放置目标；
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
    const next = [...tools];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    applyOrder(next);
  };

  return (
    <div className="adm-page">
      {/* 工具管理 */}
      <Panel
        title="工具列表"
        sub={`${tools.length} 个已注册工具 · 拖动或使用上下移动调整公开展示顺序`}
      >
        <div style={{ padding: "16px 18px" }} aria-busy={loading || reordering}>
          {loading ? (
            <ListSkeleton rows={5} height={64} />
          ) : error ? (
            <AdminAlert
              tone="error"
              title="工具列表加载失败"
              action={
                <button type="button" className="adm-btn ghost" onClick={load}>
                  <RefreshCw aria-hidden size={14} />
                  重新加载
                </button>
              }
            >
              {error}
            </AdminAlert>
          ) : tools.length === 0 ? (
            <AdminEmptyState
              title="暂无已注册工具"
              description="工具能力由服务端代码注册，服务启动并完成注册后会显示在这里。"
            />
          ) : (
            <>
              {tools.map((tool, i) => (
                <div
                  className={`floor${dragIx === i ? " dragging" : ""}${
                    overIx === i && dragIx != null && dragIx !== i ? " drop-hint" : ""
                  }`}
                  data-floor={tool.key}
                  key={tool.id}
                  draggable={!reordering}
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
                  <span
                    className="grab"
                    onMouseDown={() => {
                      dragFromHandle.current = true;
                    }}
                    onMouseUp={() => {
                      dragFromHandle.current = false;
                    }}
                    title={`拖动调整 ${tool.title} 顺序`}
                    aria-hidden="true"
                  >
                    <GripVertical size={16} strokeWidth={1.8} />
                  </span>
                  <span className="ix">{i + 1}</span>
                  <div>
                    <div className="nm">{tool.title}</div>
                    <div className="meta">
                      {(tool.showPage ? `/tools/${tool.key}` : "仅创作台") +
                        " · " +
                        (tool.type === "video" ? "视频" : "图片") +
                        " · " +
                        tool.handler +
                        (tool.needPrompt ? " · 需用户描述" : "")}
                    </div>
                  </div>
                  <div className="sp" />
                  <StatusPill tone={tool.showPage ? "blue" : "gray"}>
                    {tool.showPage ? "独立工具页" : "仅创作台"}
                  </StatusPill>
                  <SwitchToggle
                    checked={tool.enabled}
                    onChange={(next) => toggleEnabled(tool, next)}
                    aria-label={`${tool.title} 启用`}
                  />
                  <div className="rowacts">
                    <button type="button" disabled={reordering || i === 0} onClick={() => move(i, -1)}>
                      上移
                    </button>
                    <button
                      type="button"
                      disabled={reordering || i === tools.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      下移
                    </button>
                    <button type="button" onClick={() => openEdit(tool)} disabled={reordering}>
                      编辑
                    </button>
                  </div>
                </div>
              ))}
              <div className="muted" style={{ padding: "10px 2px 0", fontSize: 12 }}>
                工具能力由代码注册，此处仅配置策略，不支持新增或删除。
              </div>
            </>
          )}
        </div>
      </Panel>

      {/* toolModal — 编辑工具 */}
      {editing != null ? (
        <ToolModal
          key={editing?.id ?? "new"}
          tool={editing}
          onClose={close}
          onSaved={() => {
            close();
            load();
          }}
        />
      ) : null}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   ToolModal — 编辑工具. Bound to the real ai_tools columns; key/handler 由代码
   注册，不可修改。Sends ONLY changed fields (partial-update DTO).
   ──────────────────────────────────────────────────────────────────────── */

const ON_OFF = ["开启", "关闭"];

function ToolModal({
  tool,
  onClose,
  onSaved,
}: {
  tool: AdminToolVO;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(tool.title);
  const [desc, setDesc] = useState(tool.desc);
  const [icon, setIcon] = useState(tool.icon);
  const [hues, setHues] = useState<string[]>(
    tool.cover ? tool.cover.map(String) : ["", "", ""],
  );
  const [placeholder, setPlaceholder] = useState(tool.placeholder);
  const [showPage, setShowPage] = useState(tool.showPage);
  const [needPrompt, setNeedPrompt] = useState(tool.needPrompt);
  const [hd, setHd] = useState(tool.hd);
  const [presetPrompt, setPresetPrompt] = useState(tool.presetPrompt);
  const [extraParams, setExtraParams] = useState(tool.extraParams);

  const setHue = (i: number, val: string) =>
    setHues((prev) => prev.map((h, j) => (j === i ? val : h)));

  // 校验/接口失败 return false → AdminModal 保持打开，用户输入不丢。
  const save = async (): Promise<boolean> => {
    const nextTitle = title.trim();
    if (!nextTitle) {
      toast.error("工具标题不能为空");
      return false;
    }

    const nextExtra = extraParams.trim();
    if (nextExtra) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(nextExtra);
      } catch {
        toast.error("默认参数不是合法 JSON");
        return false;
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        toast.error('默认参数需为 JSON 对象，如 {"resolution":"4k"}');
        return false;
      }
    }

    // 封面色相：全空 = 不设置；否则需 3 个 0–360 的整数。
    const filled = hues.filter((h) => h.trim() !== "");
    let cover: number[] | null = null;
    if (filled.length > 0) {
      if (filled.length !== 3) {
        toast.error("封面色相需填满 3 个数值，或全部留空");
        return false;
      }
      const nums = hues.map((h) => Number(h.trim()));
      if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 360)) {
        toast.error("封面色相需为 0–360 的整数");
        return false;
      }
      cover = nums;
    }

    // Diff against the loaded row: send ONLY changed fields.
    const dto: AdminToolUpdateDTO = {};
    if (nextTitle !== tool.title) dto.title = nextTitle;
    if (desc.trim() !== tool.desc) dto.desc = desc.trim();
    if (icon.trim() !== tool.icon) dto.icon = icon.trim();
    if (JSON.stringify(cover) !== JSON.stringify(tool.cover ?? null)) dto.cover = cover;
    if (placeholder.trim() !== tool.placeholder) dto.placeholder = placeholder.trim();
    if (showPage !== tool.showPage) dto.showPage = showPage;
    if (needPrompt !== tool.needPrompt) dto.needPrompt = needPrompt;
    if (hd !== tool.hd) dto.hd = hd;
    if (presetPrompt !== tool.presetPrompt) dto.presetPrompt = presetPrompt;
    if (nextExtra !== tool.extraParams) dto.extraParams = nextExtra;

    if (Object.keys(dto).length === 0) {
      onSaved(); // nothing changed
      return true;
    }

    try {
      const res = await adminToolsApi.update(tool.id, dto);
      if (res.success) {
        onSaved();
        return true;
      }
      toast.error(res.message || "保存失败");
      return false;
    } catch {
      toast.error("保存失败，请稍后重试");
      return false;
    }
  };

  return (
    <AdminModal
      open
      size="lg"
      title={`编辑工具 · ${tool.title}`}
      subtitle={`${tool.key} · ${tool.handler}（key 与 handler 由代码注册，不可修改）`}
      footNote="变更将在保存后作用于工具页与创作台"
      onClose={onClose}
      onSave={save}
    >
      <FormCard title="基本信息">
        <FormGrid>
          <Field label="标题" required span={2}>
            <input
              placeholder="如：智能扩图"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label="描述" span={2}>
            <input
              placeholder="工具卡与工具页的一句话说明"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          </Field>
          <Field label="图标字符" span={2} hint="单个字形符号，如 ⤢">
            <input
              style={{ maxWidth: 120 }}
              placeholder="⤢"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
            />
          </Field>
          <Field group label="封面色相" span={2} hint="首页能力卡与工具页封面的三色相（0–360）">
            <div style={{ display: "flex", gap: 8 }}>
              {hues.map((h, i) => (
                <input
                  key={i}
                  inputMode="numeric"
                  aria-label={`封面色相 ${i + 1}`}
                  placeholder="0–360"
                  value={h}
                  onChange={(e) => setHue(i, e.target.value)}
                />
              ))}
            </div>
          </Field>
          <Field label="输入占位文案" span={4} hint="仅「需用户描述」的工具生效">
            <input
              placeholder="如：描述要修改的部分…"
              value={placeholder}
              onChange={(e) => setPlaceholder(e.target.value)}
            />
          </Field>
        </FormGrid>
      </FormCard>

      <FormCard title="行为开关">
        <FormSection
          label="独立工具页"
          hint="关闭后首页不出卡片、/tools 链接 404，创作台一键操作不受影响"
        >
          <MChips
            options={ON_OFF}
            selected={[showPage ? "开启" : "关闭"]}
            solo
            onChange={(next) => setShowPage(next[0] === "开启")}
          />
        </FormSection>
        <FormSection label="需用户描述" hint="开启后工具页要求用户输入描述文本，随请求发送（如局部重绘）">
          <MChips
            options={ON_OFF}
            selected={[needPrompt ? "开启" : "关闭"]}
            solo
            onChange={(next) => setNeedPrompt(next[0] === "开启")}
          />
        </FormSection>
        <FormSection label="偏好 4K 模型" hint="生成时优先选用 4K 能力模型，并附带默认参数">
          <MChips
            options={ON_OFF}
            selected={[hd ? "开启" : "关闭"]}
            solo
            onChange={(next) => setHd(next[0] === "开启")}
          />
        </FormSection>
      </FormCard>

      <FormCard title="生成配置">
        <FormSection
          label="预置提示词"
          hint="服务端注入的英文指令，用户不可见；留空则走用户输入（如局部重绘）"
        >
          <div className="fld">
            <textarea
              rows={5}
              value={presetPrompt}
              onChange={(e) => setPresetPrompt(e.target.value)}
              placeholder="Engineered instruction sent to the model…"
              aria-label="预置提示词"
            />
          </div>
        </FormSection>
        <FormSection
          label="默认参数"
          hint={'JSON 对象，如 {"resolution":"4k"}；随请求计费，改动会影响积分消耗'}
        >
          <div className="fld">
            <textarea
              rows={3}
              style={{ fontFamily: "var(--mono)" }}
              value={extraParams}
              onChange={(e) => setExtraParams(e.target.value)}
              placeholder='{"resolution":"4k"}（留空 = 内置默认）'
              aria-label="默认参数 JSON"
            />
          </div>
        </FormSection>
      </FormCard>
    </AdminModal>
  );
}

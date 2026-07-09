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
   FormSection / MChips). The ordered `.floor` row list (grab ⋮⋮ handle,
   上移/下移, 启用 toggle) mirrors /admin/home-floors.

   Known AdminModal quirk: 保存 closes the modal unconditionally, so both
   validation and API failures surface via toast AFTER close.

   Client component (toggles + reorder + modal).
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
  StatusPill,
  SwitchToggle,
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
    load();
  }, [load]);

  const openEdit = (tool: AdminToolVO) => setEditing(tool);
  const close = () => setEditing(null);

  const toggleEnabled = async (tool: AdminToolVO, next: boolean) => {
    const res = await adminToolsApi.setStatus(tool.id, { enabled: next });
    if (res.success) load();
    else load(); // revert from server truth on failure
  };

  // Persist a new ordering: move tool at index `from` to `from+dir`.
  const move = async (from: number, dir: -1 | 1) => {
    const to = from + dir;
    if (to < 0 || to >= tools.length) return;
    const next = [...tools];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setTools(next); // optimistic
    const res = await adminToolsApi.reorder({ ids: next.map((t) => t.id) });
    if (!res.success) load(); // revert from server truth
  };

  return (
    <>
      {/* 工具管理 */}
      <Panel
        title="工具管理"
        sub="独立工具页与创作台一键操作 —— 启用、文案与生成参数全后台驱动"
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
          ) : tools.length === 0 ? (
            <div className="muted" style={{ padding: "24px 0", textAlign: "center" }}>
              暂无工具（工具由代码注册，随服务端版本自动初始化）。
            </div>
          ) : (
            <>
              {tools.map((tool, i) => (
                <div className="floor" data-floor={tool.key} key={tool.id}>
                  <span className="grab">⋮⋮</span>
                  <span className="ix">{i + 1}</span>
                  <div>
                    <div className="nm">{tool.title}</div>
                    <div className="meta">
                      {(tool.showPage ? `/tools/${tool.key}` : "仅创作台") +
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
                    <button type="button" disabled={i === 0} onClick={() => move(i, -1)}>
                      上移
                    </button>
                    <button
                      type="button"
                      disabled={i === tools.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      下移
                    </button>
                    <button type="button" onClick={() => openEdit(tool)}>
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
    </>
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

  // AdminModal 保存 closes unconditionally, so validation/API errors toast.
  const save = async () => {
    const nextTitle = title.trim();
    if (!nextTitle) {
      toast.error("工具标题不能为空");
      return;
    }

    const nextExtra = extraParams.trim();
    if (nextExtra) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(nextExtra);
      } catch {
        toast.error("默认参数不是合法 JSON");
        return;
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        toast.error('默认参数需为 JSON 对象，如 {"resolution":"4k"}');
        return;
      }
    }

    // 封面色相：全空 = 不设置；否则需 3 个 0–360 的整数。
    const filled = hues.filter((h) => h.trim() !== "");
    let cover: number[] | null = null;
    if (filled.length > 0) {
      if (filled.length !== 3) {
        toast.error("封面色相需填满 3 个数值，或全部留空");
        return;
      }
      const nums = hues.map((h) => Number(h.trim()));
      if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 360)) {
        toast.error("封面色相需为 0–360 的整数");
        return;
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
      return;
    }

    try {
      const res = await adminToolsApi.update(tool.id, dto);
      if (res.success) onSaved();
      else toast.error(res.message || "保存失败");
    } catch {
      toast.error("保存失败，请稍后重试");
    }
  };

  return (
    <AdminModal
      open
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
          <Field label="封面色相" span={2} hint="首页能力卡与工具页封面的三色相（0–360）">
            <div style={{ display: "flex", gap: 8 }}>
              {hues.map((h, i) => (
                <input
                  key={i}
                  inputMode="numeric"
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
            />
          </div>
        </FormSection>
      </FormCard>
    </AdminModal>
  );
}

"use client";

/* ============================================================================
   /admin/discover — 发现管理 / 首页轮播 (REAL data).

   Wired to the admin discover API (banner / sys_banner rows, shared with the
   public home banners). Editing a slot here immediately changes the home page.
   Keeps the liuguang admin markup/classes + shared components:
     - 4 KPI tiles (推荐位总数 / 已显示 / 已隐藏 / 位置数)
     - 发现页配置 panel: tools 「+ 新增推荐位」, table
       (封面 / 标题 / 位置 / 排序 / 链接 / 状态[开关] / 操作[编辑·删除])
     - SlotModal: 新增/编辑推荐位 (标题 / 图片 / 链接 / 位置 / 排序 / 启用)

   GET /discover/slots returns a PLAIN LIST (not paged). CRUD against the real
   endpoints refreshes the list after each change; the 状态 switch writes status.
   ============================================================================ */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AdminModal,
  AdminTable,
  FormCard,
  FormGrid,
  Field,
  FormSection,
  Panel,
  RowActions,
  StatCardGrid,
  StatusPill,
  SwitchToggle,
} from "@/components/admin";
import type { Kpi, PillTone } from "@/mock/admin";
import { mesh } from "@/lib/mesh";
import { useAuthStore } from "@/stores/use-auth-store";
import { adminDiscoverApi } from "@/lib/admin-discover-api";
import {
  SLOT_STATUS_HIDDEN,
  SLOT_STATUS_SHOWN,
  type DiscoverSlotUpsertDTO,
  type DiscoverSlotVO,
} from "@/types/admin-discover";

/** Deterministic mesh cover from an id (fallback when imageUrl is empty). */
function meshCover(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return mesh(h, (h + 132) % 360, (h + 248) % 360);
}

function coverBg(imageUrl: string, id: string): string {
  return imageUrl ? `center / cover no-repeat url("${imageUrl}")` : meshCover(id);
}

function statusTone(status: number): PillTone {
  return status === SLOT_STATUS_SHOWN ? "green" : "gray";
}

type SlotDraft = {
  id: string | null;
  title: string;
  imageUrl: string;
  linkUrl: string;
  position: string;
  sortOrder: string;
  status: number;
};

export default function AdminDiscoverPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);

  const [slots, setSlots] = useState<DiscoverSlotVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<SlotDraft | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await ensureSession(); // 登录流程暂未做:无 token 时静默登录默认账号
      const res = await adminDiscoverApi.listSlots();
      if (res.success && res.data) {
        setSlots(res.data);
      } else {
        setSlots([]);
      }
    } finally {
      setLoading(false);
    }
  }, [ensureSession]);

  useEffect(() => {
    load();
  }, [load]);

  const kpis: Kpi[] = useMemo(() => {
    const shown = slots.filter((s) => s.status === SLOT_STATUS_SHOWN).length;
    const hidden = slots.length - shown;
    const positions = new Set(slots.map((s) => s.position).filter(Boolean)).size;
    return [
      { k: "推荐位总数", v: slots.length.toLocaleString(), d: "sys_banner", dir: "up" },
      { k: "已显示", v: shown.toLocaleString(), d: "上线中", dir: "up" },
      { k: "已隐藏", v: hidden.toLocaleString(), d: "下线", dir: hidden ? "down" : "up" },
      { k: "位置数", v: positions.toLocaleString(), d: "position", dir: "up" },
    ];
  }, [slots]);

  const openCreate = () =>
    setDraft({
      id: null,
      title: "",
      imageUrl: "",
      linkUrl: "",
      position: "",
      sortOrder: "0",
      status: SLOT_STATUS_SHOWN,
    });

  const openEdit = (s: DiscoverSlotVO) =>
    setDraft({
      id: s.id,
      title: s.title,
      imageUrl: s.imageUrl,
      linkUrl: s.linkUrl,
      position: s.position,
      sortOrder: String(s.sortOrder),
      status: s.status,
    });

  const save = useCallback(async () => {
    if (!draft) return;
    const imageUrl = draft.imageUrl.trim();
    if (!imageUrl) {
      window.alert("请填写图片 URL");
      return;
    }
    const body: DiscoverSlotUpsertDTO = {
      title: draft.title.trim(),
      imageUrl,
      linkUrl: draft.linkUrl.trim(),
      position: draft.position.trim(),
      sortOrder: Number(draft.sortOrder) || 0,
      status: draft.status,
    };
    setBusy(true);
    try {
      const res = draft.id
        ? await adminDiscoverApi.updateSlot(draft.id, body)
        : await adminDiscoverApi.createSlot(body);
      if (res.success) {
        setDraft(null);
        await load();
      } else {
        window.alert(res.message || "保存失败");
      }
    } finally {
      setBusy(false);
    }
  }, [draft, load]);

  const toggleStatus = useCallback(
    async (s: DiscoverSlotVO, next: boolean) => {
      setBusy(true);
      try {
        const res = await adminDiscoverApi.updateSlot(s.id, {
          title: s.title,
          imageUrl: s.imageUrl,
          linkUrl: s.linkUrl,
          position: s.position,
          sortOrder: s.sortOrder,
          status: next ? SLOT_STATUS_SHOWN : SLOT_STATUS_HIDDEN,
        });
        if (res.success) await load();
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const remove = useCallback(
    async (s: DiscoverSlotVO) => {
      if (!window.confirm(`确认删除推荐位「${s.title || s.id}」？此操作会同步从首页移除。`)) {
        return;
      }
      setBusy(true);
      try {
        const res = await adminDiscoverApi.deleteSlot(s.id);
        if (res.success) await load();
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const dim = busy ? { opacity: 0.6, pointerEvents: "none" as const } : undefined;

  return (
    <>
      <StatCardGrid items={kpis} />

      <Panel
        title="发现页配置"
        sub="管理首页轮播 / 发现页推荐位 · 与首页同源"
        tools={
          <button type="button" className="adm-btn" onClick={openCreate}>
            + 新增推荐位
          </button>
        }
      >
        {loading ? (
          <div style={{ padding: 28, color: "var(--muted, #94a3b8)" }}>加载中…</div>
        ) : slots.length === 0 ? (
          <div style={{ padding: 28, color: "var(--muted, #94a3b8)" }}>暂无推荐位。</div>
        ) : (
          <div style={dim}>
            <AdminTable<DiscoverSlotVO>
              rows={slots}
              rowKey={(s) => s.id}
              columns={[
                {
                  header: "封面",
                  cell: (s) => (
                    <div className="cellflex">
                      <span className="sw" style={{ background: coverBg(s.imageUrl, s.id) }} />
                    </div>
                  ),
                },
                {
                  header: "标题",
                  className: "strong",
                  sortable: true,
                  sortValue: (s) => s.title,
                  cell: (s) => s.title || "—",
                },
                {
                  header: "位置",
                  sortable: true,
                  sortValue: (s) => s.position,
                  cell: (s) => s.position || "—",
                },
                {
                  header: "排序",
                  className: "mono",
                  sortable: true,
                  sortValue: (s) => s.sortOrder,
                  cell: (s) => s.sortOrder,
                },
                {
                  header: "链接",
                  className: "muted",
                  cell: (s) =>
                    s.linkUrl ? (
                      <a href={s.linkUrl} target="_blank" rel="noreferrer">
                        {s.linkUrl}
                      </a>
                    ) : (
                      "—"
                    ),
                },
                {
                  header: "状态",
                  cell: (s) => (
                    <SwitchToggle
                      checked={s.status === SLOT_STATUS_SHOWN}
                      onChange={(next) => toggleStatus(s, next)}
                      aria-label={`${s.title || s.id} 显示`}
                    />
                  ),
                },
                {
                  header: "操作",
                  align: "right",
                  cell: (s) => (
                    <RowActions
                      actions={[
                        { label: "编辑", onClick: () => openEdit(s) },
                        {
                          label: s.status === SLOT_STATUS_SHOWN ? "下线" : "上线",
                          onClick: () =>
                            toggleStatus(s, s.status !== SLOT_STATUS_SHOWN),
                        },
                        { label: "删除", onClick: () => remove(s) },
                      ]}
                    />
                  ),
                },
              ]}
            />
          </div>
        )}
      </Panel>

      {/* SlotModal — 新增/编辑推荐位 */}
      <AdminModal
        open={draft != null}
        title={draft?.id ? `编辑推荐位 · ${draft.title || draft.id}` : "新增推荐位"}
        subtitle="配置推荐位的封面、链接、位置与排序"
        onClose={() => setDraft(null)}
        onSave={save}
        saveLabel={busy ? "保存中…" : "保存"}
      >
        {draft ? (
          <>
            <FormCard title="基础信息" style={{ marginTop: 0 }}>
              <FormGrid>
                <Field label="标题" span={2}>
                  <input
                    placeholder="如：本周精选"
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  />
                </Field>
                <Field label="位置" span={2}>
                  <input
                    placeholder="如：home-top / discover"
                    value={draft.position}
                    onChange={(e) => setDraft({ ...draft, position: e.target.value })}
                  />
                </Field>
                <Field label="图片 URL" required span={4}>
                  <input
                    placeholder="横幅图片 URL，建议比例 16:9"
                    value={draft.imageUrl}
                    onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })}
                  />
                </Field>
                <Field label="跳转链接" span={4}>
                  <input
                    placeholder="选填，点击横幅的跳转地址"
                    value={draft.linkUrl}
                    onChange={(e) => setDraft({ ...draft, linkUrl: e.target.value })}
                  />
                </Field>
                <Field label="排序" hint="数字越小越靠前">
                  <input
                    type="number"
                    value={draft.sortOrder}
                    onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })}
                  />
                </Field>
              </FormGrid>
            </FormCard>

            <FormCard title="选项">
              <FormSection label="状态">
                <div className="cfg-card" style={{ boxShadow: "none", padding: "4px 16px" }}>
                  <div className="cfg-row">
                    <span className="lab">在首页显示</span>
                    <SwitchToggle
                      checked={draft.status === SLOT_STATUS_SHOWN}
                      onChange={(next) =>
                        setDraft({
                          ...draft,
                          status: next ? SLOT_STATUS_SHOWN : SLOT_STATUS_HIDDEN,
                        })
                      }
                      aria-label="在首页显示"
                    />
                  </div>
                </div>
              </FormSection>
            </FormCard>
          </>
        ) : null}
      </AdminModal>
    </>
  );
}

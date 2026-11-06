"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCheck } from "lucide-react";
import { AdminModal } from "./admin-modal";
import { adminStudioTemplateApi, type TemplateSelectAllModelsResult } from "@/lib/studio-template-api";
import { useAuthStore } from "@/stores/use-auth-store";
import css from "./template-cover-batch.module.css";

const labels = { updated: "已勾选", unchanged: "已勾全", skipped: "已跳过", failed: "未完成" };

export function TemplateSelectAllModelsButton({ onUpdated }: { onUpdated: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<TemplateSelectAllModelsResult>();
  const request = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; request.current?.abort(); };
  }, []);

  const run = async () => {
    if (lock.current) return false;
    const owner = String(useAuthStore.getState().user?.id || "");
    if (!owner) return false;
    const current = () => alive.current && owner === String(useAuthStore.getState().user?.id || "");
    lock.current = true;
    setBusy(true);
    setError("");
    setResult(undefined);
    const controller = new AbortController();
    request.current = controller;
    let afterId: string | undefined;
    let throughId: string | undefined;
    let aggregate: TemplateSelectAllModelsResult = { total: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0, throughId: "0", nextAfterId: "0", done: false, items: [] };
    try {
      while (current()) {
        const response = await adminStudioTemplateApi.selectAllModels({ afterId, throughId }, AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]));
        if (!current()) return false;
        const chunk = response.data;
        if (!response.success || !chunk || typeof chunk.done !== "boolean") {
          setError((response.message || "暂时无法确认处理结果") + "。部分模板可能已保存，可重新执行，已勾选的模型会自动跳过。");
          return false;
        }
        if (!chunk.done && (!chunk.nextAfterId || chunk.nextAfterId === "0" || chunk.nextAfterId === afterId)) {
          setError("处理进度未更新，请刷新页面后重新执行。");
          return false;
        }
        aggregate = {
          ...chunk,
          updated: aggregate.updated + chunk.updated,
          unchanged: aggregate.unchanged + chunk.unchanged,
          skipped: aggregate.skipped + chunk.skipped,
          failed: aggregate.failed + chunk.failed,
          items: [...(aggregate.items || []), ...(chunk.items || [])],
        };
        setResult(aggregate);
        if (chunk.done) break;
        afterId = chunk.nextAfterId;
        throughId = chunk.throughId;
      }
    } catch {
      if (current()) setError("连接中断，部分模板可能已保存。可重新执行，已勾选的模型会自动跳过。");
    } finally {
      lock.current = false;
      if (current()) { setBusy(false); onUpdated(); }
    }
    return false;
  };

  return <>
    <button type="button" className="adm-btn ghost" disabled={busy} onClick={() => { setError(""); setResult(undefined); setOpen(true); }}>
      <CheckCheck size={15} />{busy ? "正在批量勾选…" : "一键勾选全部兼容模型"}
    </button>
    <AdminModal open={open} title="一键勾选全部兼容模型" size="lg"
      subtitle="为所有创作模板补齐「前台可选模型」，覆盖全部分页、图片和视频、风格和灵感、草稿及已上架模板。"
      closeable={!busy} showCancel={!busy && !result} onClose={() => setOpen(false)}
      saveDisabled={busy} saveLabel={busy ? "正在处理…" : error ? "重新执行" : result ? "完成" : "开始批量勾选"}
      onSave={async () => { if (!result || error) { await run(); return false; } setOpen(false); }}
      footNote="不生成作品、不扣积分。默认模型、提示词、输出规格和上架状态保持原值。">
      <div className={css.body}>
        <p>将逐个检查已上架模型与模板的模式、素材数量、比例、时长、质量及价格配置，勾选所有兼容模型，并保留已有勾选。</p>
        <p className={css.note}>当前列表的筛选条件不影响处理范围。生成配置不完整的模板会跳过，并显示具体原因。</p>
        {busy && <p role="status">正在校验并保存…{result ? `已处理 ${result.updated + result.unchanged + result.skipped + result.failed} / ${result.total} 个模板` : ""}</p>}
        {error && <p className={css.error} role="alert">{error}</p>}
        {result && <>
          <p role="status">{result.done ? `处理完成，共 ${result.total} 个模板` : "处理中"}：已更新 {result.updated} 个，已勾全 {result.unchanged} 个，跳过 {result.skipped} 个，未完成 {result.failed} 个。</p>
          {result.items?.length ? <ul className={css.items} aria-label="批量勾选结果">
            {result.items.map(item => <li key={item.id}>
              <div><strong>{item.title}</strong><small>{item.message}{item.models > 0 ? ` · ${item.models} 个模型` : ""}</small></div>
              <span className={css.status} data-status={item.status === "updated" || item.status === "unchanged" ? "succeeded" : item.status}>{labels[item.status]}</span>
            </li>)}
          </ul> : <p>暂无创作模板。</p>}
        </>}
      </div>
    </AdminModal>
  </>;
}

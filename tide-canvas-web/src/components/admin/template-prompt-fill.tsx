"use client";

import { useEffect, useRef, useState } from "react";
import { AdminModal } from "./admin-modal";
import { adminStudioTemplateApi, type TemplateCoverFilter, type TemplatePromptFillResult } from "@/lib/studio-template-api";
import { useAuthStore } from "@/stores/use-auth-store";
import css from "./template-cover-batch.module.css";

export function TemplatePromptFillButton({ filter, disabled, onUpdated }: {
  filter: TemplateCoverFilter;
  disabled?: boolean;
  onUpdated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<TemplatePromptFillResult>();
  const [chosen, setChosen] = useState(filter);
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const run = async (scope: TemplateCoverFilter) => {
    if (lock.current) return;
    const owner = String(useAuthStore.getState().user?.id || "");
    if (!owner) return;
    lock.current = true;
    setChosen({ ...scope });
    setOpen(true);
    setBusy(true);
    setError("");
    setResult(undefined);
    try {
      const response = await adminStudioTemplateApi.fillFromPrompts(scope, true);
      if (!alive.current || owner !== String(useAuthStore.getState().user?.id || "")) return;
      onUpdated();
      if (response.success && response.data) {
        setResult(response.data);
        if (response.data.publish !== true) setError("当前后端未执行上架，请更新后端后重试；仅保存参数不会让模板出现在用户列表。");
      }
      else setError(response.message || "暂时无法确认上架结果。可以重试，已上架且配置未变化的模板会跳过。");
    } catch {
      if (alive.current) setError("网络异常，暂时无法确认上架结果。可以重试，已上架且配置未变化的模板会跳过。");
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <>
      <button type="button" className="adm-btn ghost" disabled={disabled || busy}
        onClick={() => void run(filter)}>
        {busy ? "正在填充上架…" : "批量填充并上架"}
      </button>
      <AdminModal open={open} title="批量填充并上架" size="lg"
        subtitle="跨分页补齐模型和参数，校验通过后上架；缺少封面或配置不可用的模板保留原状态并显示原因。"
        closeable={!busy} showCancel={false} onClose={() => setOpen(false)}
        saveDisabled={busy} saveLabel={error ? "重试填充并上架" : "完成"}
        onSave={async () => {
          if (error) { await run(chosen); return false; }
          setOpen(false);
        }}
        footNote="上架后用户即可在模板列表使用。不生成视频、不扣积分；封面和提示词保持原内容。">
        <div className={css.body}>
          <p className={css.note}>清晰度未设置或为480p时更新为720p，其他已设清晰度保留。已上架模板也会按此规则更新；模型不支持720p时显示原因并保留原配置。</p>
          <p className={css.note}>
            {chosen.kind === "style" ? "风格主题" : "灵感做同款"} · 视频 · {chosen.category || "全部分类"}
            {" · " + (chosen.status === "1" ? "已上架" : chosen.status === "0" ? "草稿 / 已下架" : "全部状态")}
            {chosen.keyword ? " · 搜索「" + chosen.keyword + "」" : ""}
          </p>
          {busy && <p role="status">正在校验封面与生成配置，通过后逐条上架，请稍候…</p>}
          {error && <p className={css.error} role="alert">{error}</p>}
          {result && <>
            <div className={css.summary}>
              <div><small>已上架</small><strong>{result.counts.published ?? 0}</strong></div>
              <div><small>已跳过</small><strong>{result.counts.skipped}</strong></div>
              <div><small>未完成</small><strong>{result.counts.failed}</strong></div>
            </div>
            <p role="status">{result.total ? "处理完成，可在下方查看每个模板的结果。" : "当前筛选下没有视频模板。"}</p>
            {chosen.status === "0" && result.publish && (
              <p className={css.note}>上架成功的模板会从草稿筛选中移出，可切换「上架状态 → 已上架」查看。</p>
            )}
            <ul className={css.items} aria-label="自动填充结果">
              {result.items.map(item => <li key={item.id}>
                <div><strong>{item.title}</strong><small>{item.message}</small></div>
                <span className={css.status} data-status={item.status === "saved" || item.status === "published" ? "succeeded" : item.status}>
                  {{ saved: "已保存", published: "已上架", skipped: "已跳过", failed: "未完成" }[item.status]}
                </span>
              </li>)}
            </ul>
          </>}
        </div>
      </AdminModal>
    </>
  );
}

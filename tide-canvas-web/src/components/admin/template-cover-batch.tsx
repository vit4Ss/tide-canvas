"use client";

import { useEffect, useRef, useState } from "react";
import { AdminModal } from "./admin-modal";
import {
  templateCoverBatchApi as api,
  type TemplateCoverBatch,
  type TemplateCoverBatchPreview,
  type TemplateCoverFilter,
} from "@/lib/studio-template-api";
import { useAuthStore } from "@/stores/use-auth-store";
import css from "./template-cover-batch.module.css";

export function TemplateCoverBatchDialog({
  filter,
  onClose,
  onUpdated,
}: {
  filter: TemplateCoverFilter;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const owner = String(useAuthStore((s) => s.user?.id || ""));
  return (
    <BatchSession
      key={owner}
      filter={filter}
      onClose={onClose}
      onUpdated={onUpdated}
      owner={owner}
    />
  );
}

function BatchSession({
  filter,
  onClose,
  onUpdated,
  owner,
}: {
  filter: TemplateCoverFilter;
  onClose: () => void;
  onUpdated: () => void;
  owner: string;
}) {
  const [preview, setPreview] = useState<TemplateCoverBatchPreview>();
  const [batch, setBatch] = useState<TemplateCoverBatch>();
  const [last, setLast] = useState<TemplateCoverBatch>();
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [pollRetry, setPollRetry] = useState(0);
  const lock = useRef(false),
    alive = useRef(true),
    requestID = useRef("");
  const notified = useRef(""),
    refresh = useRef(onUpdated);
  useEffect(() => {
    refresh.current = onUpdated;
  }, [onUpdated]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const current = () =>
    alive.current && String(useAuthStore.getState().user?.id || "") === owner;

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(async () => {
      setLoading(true);
      setError("");
      setPreview(undefined);
      try {
        const active = await api.current();
        if (cancelled) return;
        if (!active.success) {
          setError(active.message || "无法确认已有批次，请重试");
          return;
        }
        setLast(active.data || undefined);
        if (active.data?.status === "running") {
          setBatch(active.data);
          return;
        }
        setBatch(undefined);
        // An existing job can be viewed/stopped even if the model is now
        // unavailable or a new quote is slow. Price only a new batch.
        const plan = await api.preview(filter);
        if (cancelled) return;
        if (plan.success && plan.data) {
          setPreview(plan.data);
          requestID.current =
            globalThis.crypto?.randomUUID?.() ||
            "cover-" +
              Date.now().toString(36) +
              "-" +
              Math.random().toString(36).slice(2);
        } else setError(plan.message || "无法读取缺失封面和计费信息");
      } catch {
        if (!cancelled) setError("读取失败，请重试");
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [filter, retry]);

  const batchID = batch?.id,
    running = batch?.status === "running";
  useEffect(() => {
    if (!batchID || !running) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const result = await api.get(batchID);
        if (stopped) return;
        if (!result.success || !result.data) {
          setError(result.message || "进度暂时无法读取，后台任务仍会继续");
          return;
        }
        setBatch(result.data);
        setError("");
        if (result.data.status === "running")
          timer = setTimeout(poll, document.hidden ? 8000 : 2000);
      } catch {
        if (!stopped) setError("进度暂时无法读取，后台任务仍会继续");
      }
    };
    timer = setTimeout(poll, 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [batchID, running, pollRetry]);

  useEffect(() => {
    if (!batch || batch.status === "running" || notified.current === batch.id)
      return;
    notified.current = batch.id;
    refresh.current();
    void useAuthStore.getState().fetchUser(true);
  }, [batch]);

  const start = async () => {
    if (batch) {
      onClose();
      return false;
    }
    if (
      lock.current ||
      !preview ||
      !preview.count ||
      preview.balance < preview.totalCost ||
      loading
    )
      return false;
    lock.current = true;
    setStarting(true);
    setError("");
    try {
      const result = await api.create(
        filter,
        preview.quoteToken,
        requestID.current,
      );
      if (!current()) return false;
      if (result.success && result.data) {
        setBatch(result.data);
        refresh.current();
      } else
        setError(
          result.message ||
            "提交结果尚未确认，再次点击将使用同一请求核对，避免重复生成",
        );
    } catch {
      if (current())
        setError("提交结果尚未确认，请重试同一请求或重新读取已有批次");
    } finally {
      lock.current = false;
      if (alive.current) setStarting(false);
    }
    return false;
  };
  const stop = async () => {
    if (!batch || stopping || batch.stopRequested) return;
    setStopping(true);
    setError("");
    try {
      const result = await api.stop(batch.id);
      if (!current()) return;
      if (result.success) {
        setBatch((old) => (old ? { ...old, stopRequested: true } : old));
        setPollRetry((v) => v + 1);
      } else setError(result.message || "停止请求失败，请重试");
    } catch {
      if (current()) setError("停止请求失败，请重试");
    } finally {
      if (alive.current) setStopping(false);
    }
  };
  const recheck = () => {
    setBatch(undefined);
    setRetry((v) => v + 1);
  };
  const done = batch
    ? batch.counts.succeeded + batch.counts.failed + batch.counts.skipped
    : 0;
  const pending = batch?.items.find((item) => item.status === "running");
  const statusLabel: Record<string, string> = {
    pending: "等待中",
    running: "生成中",
    succeeded: "已保存",
    failed: "失败",
    skipped: "已跳过",
  };
  return (
    <AdminModal
      open
      size="lg"
      title="批量生成缺失封面"
      subtitle="处理当前筛选下所有缺少封面的模板，包含其他分页。已有封面不会被覆盖。"
      onClose={onClose}
      closeable={!starting}
      showCancel={!batch}
      onSave={start}
      saveLabel={
        batch
          ? running
            ? "收起进度"
            : "完成"
          : starting
            ? "正在提交…"
            : "确认生成"
      }
      saveDisabled={
        !batch &&
        (loading ||
          starting ||
          !preview?.count ||
          preview.balance < preview.totalCost)
      }
      footNote={
        batch
          ? "任务在后台执行，关闭弹窗或刷新页面不会重复提交。再次点击批量封面可查看进度。"
          : "从当前管理员积分按张扣除；生成失败沿用原任务退款流程，不会改变模板配方或上架状态。"
      }
    >
      <div className={css.body}>
        {loading ? (
          <p role="status">正在检查缺失封面、默认模型和积分…</p>
        ) : batch ? (
          <>
            <div className={css.summary}>
              <div>
                <small>处理进度</small>
                <strong>
                  {done} / {batch.total}
                </strong>
              </div>
              <div>
                <small>已保存</small>
                <strong>{batch.counts.succeeded}</strong>
              </div>
              <div>
                <small>失败 / 跳过</small>
                <strong>
                  {batch.counts.failed} / {batch.counts.skipped}
                </strong>
              </div>
            </div>
            <p>
              {batch.modelName} · 每张预计 {batch.unitCost} 积分
            </p>
            <progress
              className={css.progress}
              aria-label="批量封面进度"
              max={Math.max(1, batch.total)}
              value={done}
            />
            {running ? (
              <div className={css.controls}>
                <span role="status">
                  {batch.stopRequested
                    ? "已请求停止，当前图片完成后结束"
                    : pending
                      ? "正在生成：" + pending.title
                      : "正在准备下一张封面…"}
                </span>
                <button
                  type="button"
                  className="adm-btn ghost small"
                  disabled={stopping || batch.stopRequested}
                  onClick={() => void stop()}
                >
                  {stopping ? "正在请求…" : "停止后续生成"}
                </button>
              </div>
            ) : (
              <div className={css.controls}>
                <span role="status">
                  {batch.status === "stopped"
                    ? "已停止后续生成"
                    : "本批次已处理完成"}
                </span>
                <button
                  type="button"
                  className="adm-btn ghost small"
                  onClick={recheck}
                >
                  重新检查缺失封面
                </button>
              </div>
            )}
            {batch.error && <p className={css.error}>{batch.error}</p>}
            <ul className={css.items} aria-label="批量封面任务">
              {batch.items.map((item) => (
                <li key={item.templateId}>
                  <div>
                    <strong>{item.title}</strong>
                    {item.message && <small>{item.message}</small>}
                  </div>
                  <span className={css.status} data-status={item.status}>
                    {statusLabel[item.status] || item.status}
                  </span>
                  {item.resultUrl && (
                    <a href={item.resultUrl} target="_blank" rel="noreferrer">
                      查看图片
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : preview ? (
          <>
            <div className={css.summary}>
              <div>
                <small>缺少封面</small>
                <strong>
                  {preview.count} <span>个模板</span>
                </strong>
              </div>
              <div>
                <small>每张积分</small>
                <strong>{preview.unitCost}</strong>
              </div>
              <div>
                <small>预计总积分</small>
                <strong>{preview.totalCost}</strong>
              </div>
            </div>
            {preview.count ? (
              <p>
                默认图片模型：<b>{preview.modelName}</b>
              </p>
            ) : (
              <p role="status">当前筛选下的模板都已有封面，无需生成。</p>
            )}
            <p className={css.note}>
              当前筛选：{filter.kind === "style" ? "风格主题" : "灵感做同款"} ·{" "}
              {filter.mediaType === "image" ? "图片" : "视频"} ·{" "}
              {filter.category || "全部分类"}
              {" · " +
                (filter.status === "1"
                  ? "已上架"
                  : filter.status === "0"
                    ? "草稿 / 已下架"
                    : "全部状态")}
              {filter.keyword ? " · 搜索「" + filter.keyword + "」" : ""}
            </p>
            <p>
              可用积分：{preview.balance}。
              {preview.balance < preview.totalCost ? (
                <span className={css.error}>
                  积分不足，请补充积分或缩小筛选范围。
                </span>
              ) : (
                "确认后逐张执行，期间积分不足或模型配置变更会停止后续生成。"
              )}
            </p>
            <p className={css.note}>
              每个模板生成一张封面示意图。若生成期间有人补充封面或修改模板介绍，将保留其修改，生成图片仍可在结果中查看。
            </p>
          </>
        ) : null}
        {error && (
          <div className={css.error} role="alert">
            <p>{error}</p>
            <button
              type="button"
              className="adm-btn ghost small"
              onClick={() =>
                batch?.status === "running"
                  ? setPollRetry((v) => v + 1)
                  : setRetry((v) => v + 1)
              }
            >
              {batch ? "重新读取进度" : "重新检查"}
            </button>
            {!batch && error.includes("模型") && (
              <a href="/admin/models" target="_blank" rel="noreferrer">
                去模型管理开启图片模型
              </a>
            )}
          </div>
        )}
        {!batch && last && (
          <button
            type="button"
            className="adm-btn ghost small"
            onClick={() => setBatch(last)}
          >
            查看上次批量结果
          </button>
        )}
      </div>
    </AdminModal>
  );
}

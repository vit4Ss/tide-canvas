"use client";

/* ── studio model list + selection (extracted verbatim from page.tsx) ────────── */

import { useCallback, useEffect, useMemo, useState } from "react";
import { marketApi, type StudioModelVO } from "@/lib/market-api";
import { swatchOf } from "../_components/chat-utils";

/** 模型列表 + 当前所选模型：加载 / focus·visibility 重拉 / 首页深链预选，
 *  以及按模型名 memo 的 swatch 解析（流式增量重渲染时不能对每个模型重跑正则）。 */
export function useGenModels() {
  const [genModels, setGenModels] = useState<StudioModelVO[]>([]);
  const [model, setModel] = useState("");

  // load every studio model (text + image + video). Text models drive the chat
  // assistant and may expose the 联网 toggle when their config enables webSearch.
  // Refetch on focus/visibility so 模型管理 edits reflect without a manual refresh.
  const reloadGenModels = useCallback(async () => {
    try {
      const res = await marketApi.studioModels();
      // 顺序由后端决定：类型顺序=后台「模型管理·类型排序」（sys_config
      // market.typeOrder），类型内=行内上移/下移（sort_order）。
      const list = res.success && Array.isArray(res.data) ? res.data : [];
      setGenModels(list);
      if (list.length) {
        setModel((cur) => (list.some((m) => m.name === cur) ? cur : list[0].name));
      }
    } catch {
      setGenModels([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载时拉取模型列表，setState 发生在 await 之后
    reloadGenModels();
  }, [reloadGenModels]);

  // 首页模型跑马灯深链：text 模型经 sessionStorage flux_model 交接预选
  // （与创作台同一约定）。列表加载的兜底会保留存在于列表中的选择，所以
  // 这里先行 setModel 是安全的。
  useEffect(() => {
    try {
      const m = sessionStorage.getItem("flux_model");
      if (m) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setModel(m);
        sessionStorage.removeItem("flux_model");
      }
    } catch {
      /* sessionStorage unavailable */
    }
  }, []);

  useEffect(() => {
    const onFocus = () => reloadGenModels();
    const onVisible = () => {
      if (document.visibilityState === "visible") reloadGenModels();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reloadGenModels]);

  // ── composer config (from 模型管理 via studio-models) ──────────────────────
  const modelNames = useMemo(() => genModels.map((m) => m.name), [genModels]);
  const selModel = useMemo(
    () => genModels.find((m) => m.name === model) ?? null,
    [genModels, model],
  );
  // swatch 按模型名 memo：ChatPage 在流式输出/输入期间每次增量都重渲染，swatchOf
  // 内的 matchBrandIcon 是一组正则，不能每次渲染对每个模型重跑。
  const swatchByName = useMemo(() => {
    const map = new Map<string, ReturnType<typeof swatchOf>>();
    for (const m of genModels) map.set(m.name, swatchOf(m));
    return map;
  }, [genModels]);
  const selSwatch = useMemo(
    () => swatchByName.get(model) ?? swatchOf({ name: model }),
    [swatchByName, model],
  );
  // 生成结果的 AI 头像按任务 modelName 取模型图标；不在列表中的历史模型名
  // 按名称即时解析（品牌 logo 匹配仍然命中）。
  const swatchForName = useCallback(
    (name: string) => swatchByName.get(name) ?? swatchOf({ name }),
    [swatchByName],
  );

  const mCfg = selModel?.config ?? null;
  const isVid = selModel?.type === "video";
  // 联网开关只对「文本模型」且其 config.webSearch 已开启时可用（模型管理里配置）。
  const webSearchAvail = selModel?.type === "text" && !!mCfg?.webSearch;

  return {
    genModels,
    model,
    setModel,
    modelNames,
    selModel,
    mCfg,
    isVid,
    webSearchAvail,
    swatchByName,
    selSwatch,
    swatchForName,
  };
}

export type GenModelsApi = ReturnType<typeof useGenModels>;

/* 创作台模型列表加载 hook — 从 create-studio.tsx 抽出（纯移动，无逻辑改动）。
   负责：按当前类型拉取真实 studio 模型（marketApi.studioModels，公开接口）、
   深链模型名落位（deepModelRef）、焦点/可见性回归时重取（让后台模型管理的
   改动免刷新生效）。 */

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { marketApi, type StudioModelVO } from "@/lib/market-api";
import type { ArtworkType } from "./types";

export function useStudioModels({
  curType,
  setModel,
}: {
  curType: ArtworkType;
  setModel: Dispatch<SetStateAction<string>>;
}) {
  /* real studio models for the current type (public, no auth), each carrying its
     per-model config; the picker + option pills are derived from this list. */
  const [studioList, setStudioList] = useState<StudioModelVO[]>([]);
  // `studioList` deliberately keeps the previous type while a new request is in
  // flight so the picker does not flash empty. Consumers that must make a paid
  // decision (history regenerate) need to know which type the list actually
  // belongs to instead of assuming it already follows `curType`.
  const [loadedType, setLoadedType] = useState<ArtworkType | null>(null);
  // 深链 /studio?model=<名称>：模型名先存 ref，等该类型的模型列表加载完成后再
  // 落位——直接 setModel 会被列表加载的兜底重置覆盖。
  const deepModelRef = useRef<string | null>(null);

  // load the studio models for the current type (public endpoint). Each carries
  // its per-model config; the picker + option pills derive from this list. On
  // empty/failure the built-in fallback lists keep the panel usable. Selection is
  // preserved if the chosen model still exists (so a refetch never resets it).
  // 请求序号防过期：深链把 curType 从默认 image 切到 video 时，两次加载并发，
  // 先发后至的 image 响应不能覆盖 video 列表。
  const modelsReqSeq = useRef(0);
  const reloadModels = useCallback(async () => {
    const seq = ++modelsReqSeq.current;
    try {
      const res = await marketApi.studioModels(curType);
      if (seq !== modelsReqSeq.current) return; // stale response
      const list = res.success && Array.isArray(res.data) ? res.data : [];
      setStudioList(list);
      setLoadedType(curType);
      if (list.length) {
        const names = list.map((m) => m.name);
        const deep = deepModelRef.current;
        if (deep && names.includes(deep)) {
          deepModelRef.current = null;
          setModel(deep);
        } else {
          setModel((cur) => (names.includes(cur) ? cur : names[0]));
        }
      }
    } catch {
      if (seq === modelsReqSeq.current) {
        setStudioList([]);
        setLoadedType(curType);
      }
    }
  }, [curType, setModel]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reloadModels 仅在异步回包后 setState（同步路径不触发）；拆分前同款挂载拉取
    reloadModels();
  }, [reloadModels]);

  // make admin edits feel live: re-fetch when the tab regains focus / becomes
  // visible, so returning from 模型管理 reflects the latest per-model config
  // without a manual refresh.
  useEffect(() => {
    const onFocus = () => reloadModels();
    const onVisible = () => {
      if (document.visibilityState === "visible") reloadModels();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reloadModels]);

  // History restoration already fetches the exact target type so it can verify
  // a paid regenerate before proceeding. Adopt that verified response into the
  // picker as well; otherwise a second catalog request could fail transiently
  // and leave generate() reading the previous type's list (or simulation mode).
  const adoptModels = useCallback((type: ArtworkType, list: StudioModelVO[]) => {
    modelsReqSeq.current += 1;
    setStudioList(list);
    setLoadedType(type);
    if (list.length) {
      const names = list.map((item) => item.name);
      setModel((current) => (names.includes(current) ? current : names[0]));
    }
  }, [setModel]);

  return { studioList, loadedType, reloadModels, adoptModels, deepModelRef };
}

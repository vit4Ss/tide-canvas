/* 音频（Suno）延长/翻唱的「原曲」选择 hook — 从 create-studio.tsx 抽出（纯移动，
   无逻辑改动）。负责：原曲 clip_id / 上传来源标记 / 延长起点、原曲选择弹窗与
   更换态、本会话内刚登记的上传原曲（extraClips）、本地音频「上传+登记」流程。 */

import { useEffect, useRef, useState } from "react";
import type { StudioModelVO } from "@/lib/market-api";
import { uploadAndRegisterClip, type ClipOption, type UploadClipStage } from "@/lib/music-modes";
import { toast } from "@/components/shared/toast";

export function useSourceClip({ selModel }: { selModel: StudioModelVO | null }) {
  /* 延长/翻唱的原曲(clip_id)与延长起点秒数(字符串承载输入框,提交时转整数) */
  const [sourceClipId, setSourceClipId] = useState("");
  /* 原曲来自「上传登记」的本地音频:延长时上游要求 task=upload_extend */
  const [sourceIsUpload, setSourceIsUpload] = useState(false);
  const [continueAt, setContinueAt] = useState("");
  /* 本次会话内刚「上传登记」的原曲(还没进 hist),合并进 clipOptions 供回显 */
  const [extraClips, setExtraClips] = useState<ClipOption[]>([]);
  // 原曲选择弹窗(替代下拉:Suno 同批两首同名,弹窗里能试听/看第 N 首区分)
  const [clipPickOpen, setClipPickOpen] = useState(false);
  // 已选原曲时点「更换」→ 临时展开来源选项(本地上传 / 从资产库选取),
  // 不清空当前选择,「取消」可退回卡片。未选原曲时来源选项常驻展示。
  const [clipChanging, setClipChanging] = useState(false);
  const clipFileRef = useRef<HTMLInputElement>(null);
  // 上传登记进行中的阶段;期间触发按钮显示进度并禁止重复发起
  const [clipUploadStage, setClipUploadStage] = useState<UploadClipStage | null>(null);
  // 登记异步完成时读「此刻」的选中项:等待期间用户另选了原曲就不覆盖其选择
  const sourceClipIdRef = useRef(sourceClipId);
  useEffect(() => {
    sourceClipIdRef.current = sourceClipId;
  }, [sourceClipId]);

  const onClipFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 同一文件再次选择也要触发 change
    if (!file || !selModel || clipUploadStage) return;
    const startClip = sourceClipIdRef.current;
    setClipUploadStage("uploading");
    try {
      const opt = await uploadAndRegisterClip({
        file,
        generateModelId: selModel.modelKey || selModel.id,
        modelRowId: selModel.id,
        modelName: selModel.name,
        onStage: setClipUploadStage,
      });
      // 无论是否自动选中都并入会话候选,保证歌单弹窗里能找到/回显
      setExtraClips((prev) =>
        prev.some((o) => o.clipId === opt.clipId) ? prev : [opt, ...prev]);
      if (sourceClipIdRef.current === startClip) {
        toast.success(`「${opt.label}」已登记为原曲`);
        setSourceClipId(opt.clipId);
        setSourceIsUpload(true);
        setClipChanging(false);
      } else {
        toast.success(`「${opt.label}」已登记，可在原曲列表中选用`);
      }
    } catch (err) {
      toast.error((err as Error)?.message || "上传登记失败，请重试");
    } finally {
      setClipUploadStage(null);
    }
  };

  return {
    sourceClipId,
    setSourceClipId,
    sourceIsUpload,
    setSourceIsUpload,
    continueAt,
    setContinueAt,
    extraClips,
    setExtraClips,
    clipPickOpen,
    setClipPickOpen,
    clipChanging,
    setClipChanging,
    clipFileRef,
    clipUploadStage,
    onClipFilePicked,
  };
}

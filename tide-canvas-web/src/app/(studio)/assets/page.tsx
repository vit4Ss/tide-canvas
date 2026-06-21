"use client";

/* ============================================================================
   资产 · Assets — React port of design-ref/资产.html +
   design-ref/liuguang/assets.js, rendered inside the (studio) ws-rail layout.

   Renders ONLY the content to the right of the rail (the <main class="asset">
   region); the rail + flux background + liuguang CSS come from the (studio)
   layout, so the canonical .asset-* class names apply unchanged.

   Sections (faithful to assets.js):
   - .asset-top    → tabs 生成历史/主体/画布 + actions 批量操作/同步到剪映
   - .asset-filter → 图片/视频/音频/文档 + 筛选 ▾
   - .asset-body   → date-grouped grid of .as-card

   DATA IS REAL: fileApi.list({pageNum,pageSize,fileType?}) → PageData<FileVO>.
   Files are grouped by their createTime date into the date-grouped grid that the
   design expects (.asset-group / .asset-date / .asset-grid / .as-card). The
   image/video/audio/文档 filter maps to the backend fileType (image|video|other):
   图片→image, 视频→video, 音频→audio, 文档→other — sent to the server. Cards use
   fileUrl as the cover (mesh fallback when empty) and a ▶ badge for videos; the
   star flag at indexes 1 & 9 is kept from the design. Clicking a card opens the
   file. The 主体/画布 tabs and 批量操作/同步到剪映 stay as prototype toasts.
   ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import { fileApi } from "@/lib/api";
import { useAuthStore } from "@/stores/use-auth-store";
import type { FileVO } from "@/types/file";
import { mesh } from "@/lib/mesh";
import { toast } from "@/components/shared/toast";
import { useReveal } from "@/components/site/use-reveal";

type TabKey = "hist" | "subject" | "canvas";
type FilterKey = "image" | "video" | "audio" | "doc";

const TABS: { t: TabKey; label: string }[] = [
  { t: "hist", label: "生成历史" },
  { t: "subject", label: "主体" },
  { t: "canvas", label: "画布" },
];

const FILTERS: { f: FilterKey; label: string }[] = [
  { f: "image", label: "图片" },
  { f: "video", label: "视频" },
  { f: "audio", label: "音频" },
  { f: "doc", label: "文档" },
];

/** Maps the design's four filter pills onto the backend FileType enum
 *  (image|video|other). 音频 → audio (backend stores none yet → empty state),
 *  文档 → other so it shows non-media uploads. */
const FILTER_TO_FILETYPE: Record<FilterKey, string> = {
  image: "image",
  video: "video",
  audio: "audio",
  doc: "other",
};

interface AssetGroup {
  date: string;
  items: FileVO[];
}

/** Deterministic mesh fallback for a file without a usable cover URL.
 *  Seeded from the file id so a given file always gets the same gradient. */
function fallbackCover(id: number): string {
  const h = (((id * 47) % 360) + 360) % 360;
  return mesh(h, (h + 132) % 360, (h + 248) % 360);
}

/** createTime arrives as "YYYY-MM-DDTHH:MM:SS"; render the design's
 *  "M 月 D 日" header. Falls back to the raw string if it won't parse. */
function dateLabel(createTime: string): string {
  if (!createTime) return "未知日期";
  const t = Date.parse(createTime);
  if (Number.isNaN(t)) return createTime;
  const d = new Date(t);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

/** Sort key for a createTime string (newest first); missing → 0. */
function timeKey(s: string): number {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

/** Group files into date buckets (newest day first, newest item first). */
function groupByDate(files: FileVO[]): AssetGroup[] {
  const buckets = new Map<string, FileVO[]>();
  const order: string[] = [];
  const sorted = files.slice().sort((a, b) => timeKey(b.createTime) - timeKey(a.createTime));
  for (const f of sorted) {
    const key = dateLabel(f.createTime);
    let arr = buckets.get(key);
    if (!arr) {
      arr = [];
      buckets.set(key, arr);
      order.push(key);
    }
    arr.push(f);
  }
  return order.map((date) => ({ date, items: buckets.get(date)! }));
}

export default function AssetsPage() {
  const [tab, setTab] = useState<TabKey>("hist");
  const [filter, setFilter] = useState<FilterKey>("image");
  const [files, setFiles] = useState<FileVO[]>([]);
  const [loading, setLoading] = useState(true);

  const ensureSession = useAuthStore((s) => s.ensureSession);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      await ensureSession(); // file list is authed — silently sign in default account
      const res = await fileApi.list({
        pageNum: 1,
        pageSize: 100,
        fileType: FILTER_TO_FILETYPE[filter] as FileVO["fileType"],
      });
      if (res.success && res.data) {
        setFiles(res.data.records);
      } else {
        setFiles([]);
      }
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [ensureSession, filter]);

  // 生成历史 tab is the only data-backed tab; reload when the filter changes.
  useEffect(() => {
    if (tab !== "hist") return;
    loadFiles();
  }, [tab, loadFiles]);

  const groups = useMemo(() => (tab === "hist" ? groupByDate(files) : []), [tab, files]);

  // Empty-state copy: non-hist tabs → prototype panel; hist with no files → archive note.
  const emptyMsg =
    tab !== "hist"
      ? `「${TABS.find((x) => x.t === tab)?.label}」面板 · 高保真原型`
      : "该类型暂无资产 —— 生成或上传后会归档到这里 ✦";

  // Re-scan reveal targets whenever the rendered set changes.
  useReveal([tab, filter, groups]);

  const showEmpty = tab !== "hist" || (!loading && groups.length === 0);

  return (
    <main className="asset">
      <div className="asset-top">
        <div className="asset-tabs" id="asset-tabs">
          {TABS.map((x) => (
            <button
              key={x.t}
              type="button"
              className={tab === x.t ? "on" : undefined}
              onClick={() => setTab(x.t)}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div className="asset-actions">
          <button type="button" onClick={() => toast.info("批量操作 · 原型")}>
            ☑ 批量操作
          </button>
          <button
            type="button"
            className="pri"
            onClick={() => toast.info("同步到剪映 · 原型")}
          >
            ⇄ 同步到剪映
          </button>
        </div>
      </div>

      <div className="asset-filter" id="asset-filter">
        {FILTERS.map((x) => (
          <button
            key={x.f}
            type="button"
            className={filter === x.f ? "on" : undefined}
            onClick={() => setFilter(x.f)}
          >
            {x.label}
          </button>
        ))}
        <button type="button" onClick={() => toast.info("更多筛选 · 原型")}>
          筛选 ▾
        </button>
      </div>

      <div className="asset-body" id="assetBody">
        {tab === "hist" && loading ? (
          <div className="empty" style={{ padding: "80px 0" }}>
            正在加载资产…
          </div>
        ) : showEmpty ? (
          <div className="empty" style={{ padding: "80px 0" }}>
            {emptyMsg}
          </div>
        ) : (
          groups.map((g) => (
            <div className="asset-group" key={g.date}>
              <div className="asset-date">{g.date}</div>
              <div className="asset-grid">
                {g.items.map((f, i) => (
                  <AssetCard
                    key={f.id}
                    file={f}
                    delay={(i % 8) * 0.02}
                    star={i === 1 || i === 9}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}

/* ── AssetCard — React port of cardHTML() from assets.js, over a real FileVO ─── */

function AssetCard({
  file,
  delay,
  star,
}: {
  file: FileVO;
  delay: number;
  star: boolean;
}) {
  const isVid = file.fileType === "video";
  const cover = file.fileUrl
    ? `center / cover no-repeat url("${file.fileUrl}")`
    : fallbackCover(file.id);

  const open = () => {
    if (file.fileUrl) {
      window.open(file.fileUrl, "_blank", "noopener,noreferrer");
    } else {
      toast.info("该资产暂无可预览的文件");
    }
  };

  return (
    <button
      type="button"
      className="as-card reveal in"
      style={{ ["--rd" as string]: `${delay}s` }}
      title={file.originalName}
      onClick={open}
    >
      <span className="cov" style={{ background: cover }} />
      <span className="pick" />
      {star && <span className="star">★</span>}
      {isVid && <span className="vbadge">▶</span>}
    </button>
  );
}

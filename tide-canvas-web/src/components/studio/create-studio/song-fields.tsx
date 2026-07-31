/* 音频（Suno）自定义/延长/翻唱的参数字段（歌词 / 风格 / 歌名）与人声开关 —
   从 create-studio.tsx 抽出（纯移动，无逻辑改动）。父组件负责外层 isAudio/isSfx/
   musicMode 条件。 */

import { AUDIO_STYLES } from "./constants";
import type { MusicMode } from "./types";

export function SongFields({
  musicMode,
  lyrics,
  onLyricsChange,
  songStyleList,
  onToggleStyle,
  songTitle,
  onSongTitleChange,
}: {
  musicMode: MusicMode;
  lyrics: string;
  onLyricsChange: (v: string) => void;
  songStyleList: string[];
  onToggleStyle: (v: string) => void;
  songTitle: string;
  onSongTitleChange: (v: string) => void;
}) {
  /* 音频（Suno）自定义/延长/翻唱的参数：歌词（自定义必填，延长 = 续写
     歌词、翻唱 = 改编提示，均选填）+ 风格/歌名。音效卡（SFX）隐藏。 */
  return (
    <>
      <div className="ws-field col" id="fieldLyrics">
        <label>
          {musicMode === "custom"
            ? "歌词 · 必填"
            : musicMode === "extend"
              ? "续写歌词 · 选填"
              : "改编提示 / 歌词 · 选填"}{" "}
          <span className="ws-pcount">
            <b>{lyrics.length}</b> 字
          </span>
        </label>
        <textarea
          className="ws-audio-ta"
          value={lyrics}
          onChange={(e) => onLyricsChange(e.target.value)}
          placeholder={
            musicMode === "custom"
              ? "Suno 按歌词演唱，支持段落标记\n[Verse]\n阳光洒在肩上\n[Chorus]\n这就是青春的模样"
              : musicMode === "extend"
                ? "为延长的部分续写歌词，留空则由 Suno 续写\n[Verse]\n…"
                : "描述想要的改编方向，或直接给出歌词，留空则保留原词"
          }
        />
      </div>
      <div className="ws-field col" id="fieldSongStyle">
        <label>音乐风格 · 可多选</label>
        <div className="ws-ratios">
          {AUDIO_STYLES.map((s) => {
            const on = songStyleList.includes(s.v);
            return (
              <button
                key={s.v}
                type="button"
                className={`ratio${on ? " on" : ""}`}
                onClick={() => onToggleStyle(s.v)}
              >
                {s.l}
              </button>
            );
          })}
        </div>
      </div>
      <div className="ws-field col" id="fieldSongTitle">
        <label>歌名</label>
        <input
          className="ws-audio-in"
          type="text"
          value={songTitle}
          onChange={(e) => onSongTitleChange(e.target.value)}
          placeholder="给这首歌起个名字"
        />
      </div>
    </>
  );
}

export function VocalField({
  instrumental,
  onChange,
}: {
  instrumental: boolean;
  onChange: (v: boolean) => void;
}) {
  /* 人声/纯音乐两种创作模式都支持（上游 make_instrumental 通吃） */
  return (
    <div className="ws-field col" id="fieldVocal">
      <label>人声</label>
      <div className="ws-ratios">
        {[
          { v: false, l: "有人声" },
          { v: true, l: "纯音乐" },
        ].map((o) => (
          <button
            key={o.l}
            type="button"
            className={`ratio${instrumental === o.v ? " on" : ""}`}
            onClick={() => onChange(o.v)}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

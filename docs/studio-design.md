# 創作台(Creation Studio)模組設計文檔

> 一個聊天式(chat-style)的 AI 生成工作台:用對話的方式產圖 / 產影片 / 文字對話,並支援
> 檔案參考、`@` 命名引用、結果再編輯等。本文說明它的整體設計思路與關鍵實作細節,供協作者參考。

---

## 目錄

1. [設計思路與定位](#1-設計思路與定位)
2. [整體架構與檔案結構](#2-整體架構與檔案結構)
3. [資料流與狀態管理](#3-資料流與狀態管理)
4. [檔案處理(File Handling)](#4-檔案處理file-handling)
5. [`@` 引用機制](#5--引用機制)
6. [`@` 的展示(Pill 渲染)](#6--的展示pill-渲染)
7. [UI 設計細節](#7-ui-設計細節)
8. [複製(Copy)](#8-複製copy)
9. [後端契約](#9-後端契約)
10. [需要特別注意的地方](#10-需要特別注意的地方)

---

## 1. 設計思路與定位

創作台把「生成參數表單」包裝成「聊天介面」。核心理念:

- **對話即歷史**:每一次生成是一個「turn」(使用者氣泡 + 助手氣泡),整串對話就是創作歷史,
  可隨時往回翻、再生成、再編輯。對標豆包 / 即夢的生成體驗。
- **複用既有生成管線**:創作台不重寫路由 / 計費 / 配額 / 對帳邏輯。每個 turn 直接走後端
  既有的 `TaskService.submit` 管線(`Task.Source.studio` 來源標記),助手訊息只用 `task_id`
  指向那筆 Task,Task 本身仍是狀態 / 產物的唯一真實來源(single source of truth)。
- **三條生成路徑,一個輸入框**:
  - **文生圖 / 圖生圖 / 影片**:走非同步 Task 路徑(輪詢結果)。
  - **文字對話**(text modality 模型):走 SSE streaming 串流路徑。
  - **Midjourney 衍生操作**(U/V/reroll/zoom/pan):當成一個新 turn 走一般送出路徑。
- **無 UI 的表單邏輯**:生成表單的狀態機抽成 headless hook(`useGenerationForm`),
  與 Playground 頁面共用同一套 payload 組裝邏輯,UI 只是綁定它的渲染層。

---

## 2. 整體架構與檔案結構

```
src/pages/StudioPage.jsx              ── 頁面容器:對話列表 / 訊息串 / 輸入框的協調者
src/components/studio/
  ├─ ConversationRail.jsx             ── 左側對話列表(新建 / 重新命名 / 刪除)
  ├─ MessageThread.jsx                ── 中間訊息串(使用者氣泡 / 結果 / 串流回覆)
  ├─ Composer.jsx                     ── 底部輸入框(prompt + 參考 + 參數 pill + 送出)
  ├─ ReferenceMediaPicker.jsx         ── 參考媒體挑選
  └─ FrameSlot.jsx                    ── 首尾幀槽位
src/components/RichPromptInput.jsx    ── 帶 "@" inline 引用的 contentEditable 輸入器(與 Playground 共用)
src/hooks/useGenerationForm.js        ── headless 生成表單狀態機(與 Playground 共用邏輯)
src/utils/sessionUploads.js           ── 本次 session/對話的上傳清單(@ 候選來源)
src/utils/clipboard.js                ── 跨環境剪貼簿寫入(HTTP/HTTPS 皆可)

backend/.../service/ConversationService.java   ── 對話 + 訊息持久化、送出 turn
backend/.../domain/Task.java                   ── 生成任務(Source.studio)
```

**頁面三欄佈局**:`ConversationRail`(左,240px)| `MessageThread`(中,flex-1)+ `Composer`(下)。

---

## 3. 資料流與狀態管理

### 3.1 核心狀態(StudioPage)

| 狀態 | 用途 |
|------|------|
| `conversations` / `activeId` | 對話列表與當前選中對話 |
| `messages` | 當前對話的訊息陣列 |
| `modelNames` | model key → 顯示名(結果詳情列用) |
| `assetUrls` | 上傳 asset id → 新簽名 URL(參考縮圖用) |
| `sendingConvs` (Set) | **每對話獨立**的送出中狀態 |
| `lightbox` | 燈箱檢視(單圖或多圖輪播) |
| `editDraft` | 「重新編輯」載入到輸入框的草稿 |

### 3.2 樂觀更新(Optimistic Update)

送出時**立即**插入兩個臨時氣泡,不等後端:

```
{ id: 'tmp_u_N', role: 'user',      content: prompt, params: body }
{ id: 'tmp_a_N', role: 'assistant', task: { status: 'processing' } }
```

- `tmpSeqRef` 是單調遞增計數器(不用時間戳,避免同毫秒送出碰撞)。
- 後端回應後,把真實訊息換進來;**`mapTmpKeys` 把真實 id 映射回臨時 key**,
  讓 `<motion.div>` 不重新掛載 → 淡入動畫只播一次,「生成中」氣泡不會閃一下消失。
- 失敗則只回滾**發起該 turn 的那條對話**的氣泡(使用者可能已切走)。

### 3.3 輪詢(Polling)

- 只有當前對話中**有任務在 `processing`/`queued`** 時才開輪詢(由衍生布林 `hasInflight` 控制)。
- 間隔 **1.5s**;`document.visibilityState !== 'visible'` 時跳過(省資源)。
- **fingerprint 短路**:`threadFingerprint(msgs)` 對 `id + status + updated_at` 取指紋,
  沒變化就不 `setState`,避免每 tick 重繪。
- 該對話有 in-flight 送出時暫停輪詢(避免覆蓋掉尚未持久化的樂觀氣泡)。

### 3.4 每對話獨立的送出狀態

`sendingConvs` 用 `Set` 而非單一布林:一條對話在跑長串流時,使用者切到另一條對話,
**另一條的輸入框不該被凍結**。輸入框只在「自己這條 id 在送出中」時 disable。

### 3.5 串流中止(Abort)

- 文字對話用 `AbortController`(`chatAbortRef`)。
- 切換對話 / 離開 `/studio` 時 abort 掉殘留的串流(否則它繼續在後端燒 token,
  且 late callback 會對已卸載元件 setState)。
- `finally` 裡用**同一控制器比對**才清空 ref(避免清掉另一條對話剛裝上的新控制器)。

---

## 4. 檔案處理(File Handling)

### 4.1 三種加入參考的方式(統一入口 `attachFiles`)

1. **「+參考」挑選器** — `<input type="file">`,依當前 mode 的 accept 過濾。
2. **拖放(drag-and-drop)** — 整個輸入框是放置區;用 `dragDepth` 深度計數器避免巢狀
   `dragenter/leave` 造成 overlay 閃爍。
3. **貼上(paste)** — `onPaste` 抓 `clipboardData.files`。

三條路徑都進 `attachFiles(fileList)`,依**MIME 類型**路由到當前 mode 的槽位:
- 陣列型槽位(`i2i`→圖、`omni_ref`→圖/影片/音訊)各自依 kind 分流,每槽位限額。
- 幀型槽位(首幀/尾幀)填第一個空幀,再填下一個。

### 4.2 上傳生命週期(樂觀 + race-guard)

```
選檔 → URL.createObjectURL(f) 產生 blob 預覽 → 立刻顯示縮圖(uploading: true)
     → api.uploadFile(f) 真正上傳 → 回來把 { id } 換進槽位
```

- **race-guard**:上傳回來時若該槽位的預覽已被換掉(使用者已移除/取代),
  就 `revokeObjectURL` 丟棄結果,不亂寫。
- **上傳後去重**:相同 bytes 會解析到相同 asset id;若該 id 已在槽位中,
  丟掉這條(抓到「同圖換檔名再加」這種 name+size 去重抓不到的情況)。
- **blob 清理**:`clearComposer`(送出/切對話)、元件卸載(離開路由)都會
  `revokeObjectURL` 釋放預覽,避免記憶體洩漏。mentions 持有的是 hosted URL,刻意不清。

### 4.3 id vs url(關鍵設計)

參考檔案在不同場合用不同 locator:

| 場合 | 用什麼 | 原因 |
|------|--------|------|
| 本地預覽縮圖 | `blob:` URL | 即時、不需網路 |
| 送出到後端 | `{ id }` 優先,否則 `{ url }` | 持久;`blob:` 永不送出 |
| 上游適配器抓取 | hosted https URL 優先,否則 `{ id }`(→ `asset://` 中繼) | 上游直接 fetch 公網 URL(阿里 OSS) |
| 歷史結果縮圖 | `assetUrls[id]` 新簽名 URL | 持久化只存 id,blob 預覽早沒了;`/uploads/raw/{id}` 需 HMAC 簽名瀏覽器簽不出 |

> **重要**:歷史訊息的參考只存 `id`。要重新渲染縮圖,得用 `api.uploads(scope)` 換一份
> `id → 新簽名 URL` 的對照表(`assetUrls`),每次 scope 切換 / 送出後刷新。

### 4.4 文字對話的附件(獨立於生成參考)

文字模型可帶附件(`chatAtts`,上限 8 個,單檔 8MB):
- **圖片** → 上傳取 id,以 `image_url` 形式送(後端解析 id)。
- **其他檔案**(pdf/xlsx…)→ 也上傳持久化,送出時後端讀 bytes 轉 base64 `file` part。
- 由模型的 `params_schema.web_search` / `file_upload` 控制是否顯示「聯網 / 附件」按鈕。

---

## 5. `@` 引用機制

`@` 引用讓使用者在 prompt 句子中**就地命名一張參考圖**,例如
`@田中 走向 @赵大柱`,每個名字綁定一張圖。

### 5.1 候選範圍(scope)

`@` 候選 = **當前 mode 下上傳的檔案**(上傳時用 `mode` 標記),不是整個圖庫。
理由:最終 prompt 是 mode-specific 的,跨 mode 的 `@` 會把 prompt 弄亂。
另也納入「目前掛在本 mode 槽位上的上傳」(即使 mode tag 因去重而過時)。

### 5.2 序列化:pill → `@角色名`

`RichPromptInput.serialize()` 走訪 contentEditable DOM,每個 pill 在它的位置輸出
`@角色名`,所以送給模型的 prompt 保留了具名引用的**位置**:`@田中 走向 @赵大柱`。
每個名字透過 `mentions` 清單對應到它綁定的圖。

### 5.3 送出時的轉換(`buildSubmitBody`)

1. **去掉 `@`**:Seedance 等上游沒有 `@` 綁定語法,所以把**有綁定的** `@名字` 去掉 `@`,
   變成純場景文字(`赵大柱 田中 在打架`);使用者自己打的、沒綁定的 `@…` 保留。
2. **折進參考集**:
   - 有 `reference_image` 槽位的 mode(omni_ref)→ mentions 折進 `extras.reference_images`,
     並**以 id 去重**(面板圖以 `{id}`、mention 以 `{url}`,同檔不同形,需去重避免 5 張變 9 張)。
   - image-edit 類 mode → mentions 當 i2i 圖參考(`image_urls` / `image_asset_ids`)。
3. **同圖多次 `@`**:prompt 文字保留兩個名字,但參考集 dedupe 成一張(一圖一參考)。
4. **攜帶角色名**:`{ url, name }`,給 Copp 等適配器映射成 `@image_file_N`(其他適配器忽略 name)。

### 5.4 往返無損(round-trip)

「重新編輯 → 不改 → 再送出」必須**位元組級重現原 prompt**。為此:

- 送出時去 `@`、存裸名(`田中 走过城堡`)。
- `loadDraft` 重新載入時:對每個**名字出現在 prompt 中**的具名參考,重新插 `@`,
  並標記為 mention;名字不在 prompt 中的(面板圖,以檔名為名)維持面板參考,
  避免產生 `@檔名` 的孤兒 pill 與檔名洩漏到上游 prompt。
- `@`-插入按**最長名優先**(短名不會卡進長名的子字串),但輸出陣列保留**原始順序**
  (位置順序對某些適配器有意義)。
- `renderExternalValue` 的比對邏輯與 `buildBody` 的反向重寫**對稱**(literal 最長名優先),
  確保 round-trip 無損。

### 5.5 貼上自動配對

貼上含 `@名字` 的文字時,每個 token 比對 session 上傳:
- 配對成功 → 變成綁定 pill,並路由進參考槽(等同手動挑選)。
- 配對失敗 → 維持字面文字。
- 全形 `＠`(中文輸入法標點模式)正規化成 `@`。

> 注意:paste 直接操作 DOM(無 `input` 事件),所以**不會**彈出 inline `@` 選單
> ——貼一大段剛好含 `@` 的文字不會洗版選單。

---

## 6. `@` 的展示(Pill 渲染)

### 6.1 為什麼用 contentEditable

`RichPromptInput` 的編輯區是一個 React **只渲染一次**的 `contentEditable`
(內容不來自 React state),React 永不在使用者打字時改寫它的 DOM。這保住了:
- **IME 組字**(中文拼音等)不被打斷 — 否則 caret 會跳回開頭。
- 可用命令式手法操作 pill / caret。

每次編輯都序列化回 `onChange`(純文字,排除 pill)與 `onMentionsChange`(pill,按文件順序)。

### 6.2 Pill 結構

pill 是 `contenteditable="false"` 的 inline `<span>`,內含:
- **縮圖**:圖片 `<img>`;影片渲染**真正的 `<video>`** 並 seek 進去一點點當首幀海報
  (避免黑色片頭幀,且支援跨域 OSS/簽名 URL,不用 canvas);音訊用 emoji glyph。
- **標籤**:角色名(去掉副檔名)。
- 縮圖文字內聯排版(`align-[-0.2em]`),與周圍 prompt 文字同基線、同字高。

dataset 攜帶:`mentionId / mentionUrl / mentionName / mentionLabel / mentionFile / mentionKind`。

### 6.3 inline `@` 選單

- 在參考 mode 下打 `@` 即彈出 caret 旁的下拉,列出當前 mode 的上傳。
- **觸發來源是即時 caret**(`detectAtQuery` 在每次 input 後跑),而非 keydown+rAF 競態 —— 更可靠。
- 邊界偵測 `NAME_STOP` 鏡像 `MENTION_RE`:在無標點的中文 prose 中,往回掃 `@` query 時
  **必須停在名字邊界字元**,否則會掃過一個很遠的字面 `@`,選取後刪掉一整段
  (「@-select 把我 prompt 洗掉」的 bug)。query 長度上限 40,作為雙保險。
- 支援 ↑↓ 導覽、Enter 選取、Esc 關閉、即時過濾(輸入名字時清單收窄)。

### 6.4 其他互動

- **Hover pill**:彈出「換圖」popover(只對圖片 pill;影片/音訊跳過),可把 pill 重綁到另一張圖。
- **Click 縮圖**:燈箱預覽(圖放大 / 影片 / 音訊播放器)。
- **Hover `@文字` token**:同樣彈出 picker,選圖即把該文字 token 換成 inline 引用。
- **Ctrl/Cmd+Z**:一次性撤銷剛做的「`@名字` → pill」選取,還原成打的 `@角色名` 文字
  (並視情況把圖從槽位移除)。只撤銷**最近一次**選取,任何後續編輯即失效。
- **pill ↔ 縮圖連動**:`@` 引用的圖與面板參考共用同一條 strip;移除縮圖即移除 pill,反之亦然。
  以 `panelKeys`(`id:` / `url:`)去重,同一張圖只顯示一個縮圖。

---

## 7. UI 設計細節

### 7.1 Composer(輸入框)

- **參數 pill 列**:自訂 `PillSelect`(非原生 `<select>`,因原生開啟清單無法套用 app 樣式)。
  - portal 到 `<body>`(逃出表單的 `overflow-hidden`),**向上展開**(工具列在螢幕底部)。
  - 完整鍵盤導覽:↑↓ Home/End Enter Esc + 首字母 type-ahead;`aria-activedescendant`。
  - outside-click / Escape / scroll / resize 自動關閉。
  - pill 列**單行水平捲動**(捲軸隱藏),不換行;成本 chip + 送出鈕固定右側。
- **效能**:pill 圖示 hoist 成 module 常數元素(穩定 identity),option 陣列 `useMemo`,
  `PillSelect` 與 `Composer` 都 `memo` —— 打字只重繪 Composer 自己,不重繪整頁/整排 pill。
- **送出再入鎖**:`inflight` ref 同步翻轉(`sending` prop 慢一個 render),
  防止連按 Enter 產生重複對話/turn。
- **送出即清空**:turn 一交出去就**立刻**清空 prompt 與 pill(不等生成完成),
  否則樂觀「生成中」氣泡已回顯文字,輸入框還留著文字會讓人以為「沒送出」。
  失敗則用編輯器的命令式 `restore()` 還原(state setter 在 focused 時會被 value-sync 略過)。
- **成本估算**:`estimated` 即時試算積分;餘額不足顯示紅色 + disable 送出。

### 7.2 MessageThread(訊息串)

- **使用者氣泡**:右側 brand 色;下方 hover 顯示複製鈕、參考縮圖、時間戳。
- **助手結果**(`AssistantResult`):
  - **載入中**:用目標 aspect 預留 box(`aspectRatio`),避免結果到位時版面跳動。
  - **載入後**:氣泡**貼合媒體自然比例**(capped `max-w` / `60vh`),避免直圖在寬 box 中留黑邊。
  - **狀態分支**:processing / failed(可重試)/ 無產物 / `task_id` 但 task 不存在(已過期,可重試)。
    - 「task_id 指向已刪除 task」→ 顯示「已過期」而非永遠轉圈(修掉「歷史卡在生成中」)。
  - **多圖**(MJ 4-up):縮圖顯示合併網格,點開燈箱輪播 1/N。
  - **詳情列 `ResultMeta`**:參考縮圖 + prompt(clamp 兩行)+ `model · aspect · duration` 摘要 +
    「詳細資訊」展開鈕(顯示完整參數)。資料源自**發起的使用者 turn 的參數快照**。
  - **下載鈕**:建 `<a download>`,影片 `.mp4` / 圖片 `.png`。
  - **MJ 衍生動作**:結果帶 `mj_buttons` 時顯示 放大/變體/重roll/擴圖/局部重繪。
  - **重新編輯 / 再生成**:都復用發起的使用者 turn 的參數。
- **串流文字氣泡**(`AssistantText`):首 token 前顯示「思考中」,串流時帶閃爍 caret,
  完成顯示複製鈕;空回覆顯示柔性提示而非空灰泡。Markdown 渲染。
- **自動捲動**:
  - 開啟/切換對話、自己送出 → **強制**跳到最新(`forceBottomRef` / `scrollSignal`)。
  - 被動更新(輪詢/串流)→ 只在使用者**已接近底部**時跟隨;否則顯示「跳到最新 / 有新內容」按鈕。
  - 串流逐 token append 用 **rAF 合併** + 僅在「真的新增氣泡」時用 `smooth`,
    in-place 內容增長用 `auto`,避免串流時捲動 judder。
- **效能**:`MessageRow` 與 `MessageThread` 都 `memo`;逐 token 渲染只動單一文字節點,
  不重繪整串圖片/影片氣泡。

### 7.3 燈箱(Lightbox)

- 單圖或多圖集合統一成 `{ items, index }`。
- 鍵盤:Esc 關閉、←/→ 翻頁(wrap-around);開啟時 focus 移到關閉鈕,關閉時還焦點回觸發縮圖。
- 多圖顯示 `index+1 / N` 與左右翻頁鈕。

### 7.4 ConversationRail(對話列表)

- 新建 / inline 重新命名(鉛筆 → 就地編輯,Enter/blur 提交)/ 刪除(父層確認)。
- 列的可選表面是真 `<button>`(鍵盤可操作 + focus ring);重新命名/刪除是 sibling 不巢狀
  (button 不能包 button)。
- `memo`:輪詢/送出不重繪 rail,除非列表或 activeId 真的變。

### 7.5 管理員 scope

管理員可檢視其他使用者的創作台歷史,但該視圖**唯讀**(不自動建對話、輸入框換成提示)。
`belongsToScope` 過濾跨 scope 資料;`loadSeqRef` 防止 scope 快速切換時舊請求覆蓋新狀態。

---

## 8. 複製(Copy)

### 8.1 跨環境剪貼簿(`utils/clipboard.js`)

`navigator.clipboard` 只在 **secure context**(HTTPS 或 localhost)有定義。
非 localhost 的純 HTTP 部署下 `navigator.clipboard === undefined`,
常見的 `navigator.clipboard?.writeText()` 會**靜默 no-op**(按鈕顯示「已複製」但其實沒進剪貼簿)。

`copyToClipboard(text)` 策略:
1. 優先 `navigator.clipboard.writeText`(secure context)。
2. fallback 用已棄用的 `document.execCommand('copy')`(隱藏 textarea + select),
   在不安全來源仍可用。
3. 回傳 `true/false`,呼叫端決定 toast / 換圖示。

### 8.2 複製鈕(`CopyBtn`)

- hover 才顯示,點擊複製後圖示換成 ✓(綠)1.2 秒後還原,失敗 toast。
- 共用於**聊天回覆**與**使用者 prompt 氣泡**。
- 使用者氣泡複製的是 `m.content`(純 prompt 文字)。

---

## 9. 後端契約

`ConversationService.java`(`Task.Source.studio`)。

### 9.1 資料模型

- `Conversation`:`id / userId / title / createdAt / updatedAt`。
- `ConversationMessage`:`id / conversationId / userId / role(user|assistant) / content /
  params(快照) / taskId / createdAt`。助手訊息**只存 `taskId`**,不存產物。

### 9.2 送出 turn 的交易紀律(`sendMessage`)

關鍵:`TaskService.submit` 的 phase-2 會做**非交易性**的上游 HTTP 呼叫,**不能**包在外層交易裡。

1. **先生成**(submit,不在交易內):若在 task 產生前被拒(無積分/無供應商/上游拒絕),
   此時尚未持久化任何東西,錯誤直接拋給前端 toast,**沒有孤兒訊息要清**。
2. **再持久化整個 turn**(一個短交易,純 DB):使用者 prompt + 助手(task_id)+ bump updated_at
   + 首 turn 自動命名,**原子寫入**。確保對話永遠不會留下「已扣費但沒有回覆 row」的 prompt。
3. 助手 `createdAt = now + 1`,確保同毫秒插入時排在使用者 row 之後。

### 9.3 讀取訊息串的效能

- `detailOf` 批次載入 task(一個 `IN` 查詢,無 N+1)。
- **只 select TaskView 真正會讀的欄位** —— Task 實體帶 payload / extras / result /
  attempts_log / upstream_request / upstream_response,每個可達數十 KB。
  20-turn 的對話每 1.5s 輪詢曾拉 ~1MB 死 JSON 過 DB 連線。

### 9.4 參數快照(`paramSnapshot`)

存非空的 model/operation/mode/aspect/quality/resolution/duration/fps/first_frame/last_frame/extras。
這是渲染使用者氣泡(參考縮圖、詳情列)與「重新編輯/再生成」的權威記錄
—— 助手 task row 本身不帶這些參考資訊。

---

## 10. 需要特別注意的地方

> 這些是踩過坑、容易誤改的地方,維護時請特別小心。

### 10.1 IME / contentEditable

- **不要**讓 React 在使用者打字時改寫編輯區 DOM(`innerHTML=''`)——會打斷中文組字、caret 跳開頭。
- 用 `focusedRef` + `composing` 旗標判斷「正在編輯」,**不要**依賴 `document.activeElement`
  (CJK IME 下 Chromium 可能短暫回報 `<body>`)。
- value-sync effect 在 focused 時跳過非空外部更新;需要強推內容(失敗還原)走命令式 `restore()`。

### 10.2 `@` query 邊界(最易出包)

- `detectAtQuery` 往回掃必須停在 `NAME_STOP`,否則無標點中文 prose 會掃過遠處字面 `@`,
  選取後刪掉一整段。`MENTION_RE` / `NAME_STOP` / `buildBody` 的去 `@` 正則**三者必須一致**。
- mention 簽名(`serialize` 的 sig 與 `mentionSig`)必須**包含 name**:同 id/url 但改名時,
  只比 id/url 會漏掉變更,留下舊 `@oldName` 洩漏到上游。

### 10.3 去重(dedup)是反覆出 bug 的點

- 同一張圖可能以**面板 `{id}`** 與 **mention `{url}`** 兩種形態到達 → 必須以 id 去重,
  否則參考數量灌水(5 張變 9 張)。
- 幀槽位的圖也算已知參考,折 mention 時要一起算進去。
- 縮圖渲染端 `panelKeys`(`id:`/`url:`)同樣去重,一圖一縮圖。

### 10.4 樂觀更新與輪詢的協調

- in-flight 送出時暫停輪詢與訊息覆寫,否則樂觀「生成中」氣泡會被沒有它的伺服器清單蓋掉而閃白。
- `mapTmpKeys` 把真實 id 釘到臨時 key,避免 motion 元件重掛載重播動畫。
- 回滾 / setState 都要先確認 `activeIdRef.current === sendConv`(使用者可能已切走)。

### 10.5 blob URL 生命週期

- 每個 `createObjectURL` 都要有對應的 `revokeObjectURL`(送出清空、移除、卸載三處)。
- 送出到後端 / 上游的參考**永不**用 `blob:` URL(只能 id 或 hosted url)。

### 10.6 歷史縮圖需要重新簽名

- 歷史 turn 的參考只存 id;渲染縮圖要靠 `assetUrls`(`id → 新簽名 URL`),
  scope 切換 / 送出後刷新。簽名過期 → `onError` 退回 placeholder,不顯示破圖。

### 10.7 中止與清理的競態

- 串流 abort ref 清理要**同控制器比對**,避免清掉另一條對話剛裝的新控制器。
- 切對話 / 卸載 effect 要 abort 殘留串流,否則後端繼續燒 token + 對已卸載元件 setState。

### 10.8 計費 / 配額不繞過

- 創作台**不重寫**計費邏輯,一律走 `TaskService.submit`。前端 `estimated` 只是預估顯示,
  真實扣費以後端 settle 為準。

---

*文檔對應程式碼以 `src/pages/StudioPage.jsx`、`src/components/studio/*`、
`src/components/RichPromptInput.jsx`、`src/hooks/useGenerationForm.js`、
`backend/.../ConversationService.java` 為準。*

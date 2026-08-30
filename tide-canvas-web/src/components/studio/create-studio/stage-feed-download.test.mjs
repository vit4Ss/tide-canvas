import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const feed = readFileSync(new URL("./stage-feed.tsx", import.meta.url), "utf8");
const player = readFileSync(new URL("../audio-player-card.tsx", import.meta.url), "utf8");

test("studio downloads stream to a user-chosen file and keep a reliable fallback", () => {
  assert.match(feed, /import \{ apiUrl, http \} from "@\/lib\/http"/);
  assert.match(feed, /http\.post<\{ url: string \}>\("\/api\/files\/download-ticket", \{ url, name \}\)/);
  assert.match(feed, /showSaveFilePicker[\s\S]*?suggestedName: name/);
  assert.match(feed, /destination\.createWritable\(\)[\s\S]*?response\.body\.pipeTo\(writable\)/);
  assert.match(feed, /response\.blob\(\)[\s\S]*?anchor\.download = name[\s\S]*?anchor\.click\(\)/);
  assert.match(feed, /showDirectoryPicker[\s\S]*?directory\.getFileHandle\(name, \{ create: true \}\)/);
  assert.match(feed, /downloadThroughProxy\(item\.url[\s\S]*?setDownloadingRun/);
  assert.doesNotMatch(feed, /document\.createElement\("iframe"\)/);
  assert.doesNotMatch(feed, /window\.open\(/);
  assert.doesNotMatch(feed, /已交给浏览器下载/);
  assert.match(feed, /"name" in error[\s\S]*?AbortError/);
  assert.match(feed, /optionalDownloadDestination[\s\S]*?if \(isDownloadPickerCancel\(error\)\) throw error;[\s\S]*?return undefined/);
  assert.match(feed, /r\.type === "audio" \? "mp3"/);
  assert.match(feed, /r\.items\.length > 1 \? `\$\{cleanBase\}-\$\{index \+ 1\}` : cleanBase/);
  assert.match(feed, /\^\(con\|prn\|aux\|nul\|com\[1-9\]\|lpt\[1-9\]\)/i);
  assert.match(feed, /assets\?\.map\(\(asset, assetIndex\)[\s\S]*?`\$\{asset\.type \|\| "file"\}-\$\{assetIndex \+ 1\}`/);
  assert.match(feed, /`正在下载\$\{downloadingRun\.total > 1/);
});

test("audio rows download individually and the run action identifies multi-result downloads", () => {
  assert.match(feed, /<SongCard[\s\S]*?onDownload=\{it\.url \? \(\) => void downloadItem\(r, it, itemIndex\)/);
  assert.match(feed, /<span>下载全部<\/span><em className="download-count">\{downloadableCount\}<\/em>/);
  assert.match(player, /className="sc-download"[\s\S]*?下载这首/);
});

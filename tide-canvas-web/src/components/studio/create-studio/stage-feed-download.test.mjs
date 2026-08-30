import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const feed = readFileSync(new URL("./stage-feed.tsx", import.meta.url), "utf8");
const player = readFileSync(new URL("../audio-player-card.tsx", import.meta.url), "utf8");

test("studio downloads use the browser default download path without opening a picker", () => {
  assert.match(feed, /import \{ apiUrl, http \} from "@\/lib\/http"/);
  assert.match(feed, /http\.post<\{ url: string; native\?: boolean \}>\("\/api\/files\/download-ticket", \{ url, name \}\)/);
  assert.match(feed, /anchor\.href = href[\s\S]*?anchor\.download = name[\s\S]*?anchor\.click\(\)/);
  assert.match(feed, /ticket\.data\.native[\s\S]*?clickBrowserDownload\(apiUrl\(ticket\.data\.url\), name\)/);
  assert.match(feed, /response\.blob\(\)[\s\S]*?clickBrowserDownload\(blobURL, name\)/);
  assert.match(feed, /downloadThroughProxy\(item\.url[\s\S]*?setDownloadingRun/);
  assert.doesNotMatch(feed, /showSaveFilePicker|showDirectoryPicker|createWritable\(\)/);
  assert.doesNotMatch(feed, /document\.createElement\("iframe"\)/);
  assert.doesNotMatch(feed, /window\.open\(/);
  assert.doesNotMatch(feed, /已交给浏览器下载/);
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

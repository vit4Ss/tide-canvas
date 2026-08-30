import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const feed = readFileSync(new URL("./stage-feed.tsx", import.meta.url), "utf8");
const player = readFileSync(new URL("../audio-player-card.tsx", import.meta.url), "utf8");

test("studio downloads exchange auth for a short native-streaming ticket", () => {
  assert.match(feed, /import \{ apiUrl, http \} from "@\/lib\/http"/);
  assert.match(feed, /http\.post<\{ url: string \}>\("\/api\/files\/download-ticket", \{ url, name \}\)/);
  assert.match(feed, /frame\.hidden = true[\s\S]*?frame\.src = apiUrl\(ticket\.data\.url\)/);
  assert.doesNotMatch(feed, /response\.blob\(\)|URL\.createObjectURL\(|fetch\(url\)/);
  assert.match(feed, /downloadThroughProxy\(item\.url[\s\S]*?setDownloadingRun/);
  assert.doesNotMatch(feed, /window\.open\(/);
  assert.match(feed, /r\.type === "audio" \? "mp3"/);
  assert.match(feed, /r\.items\.length > 1 \? `\$\{cleanBase\}-\$\{index \+ 1\}` : cleanBase/);
});

test("audio rows download individually and the run action identifies multi-result downloads", () => {
  assert.match(feed, /<SongCard[\s\S]*?onDownload=\{it\.url \? \(\) => void downloadItem\(r, it, itemIndex\)/);
  assert.match(feed, /<span>下载全部<\/span><em className="download-count">\{downloadableCount\}<\/em>/);
  assert.match(player, /className="sc-download"[\s\S]*?下载这首/);
});

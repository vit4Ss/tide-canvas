import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const player = readFileSync(new URL("./audio-player-card.tsx", import.meta.url), "utf8");
const feed = readFileSync(new URL("./create-studio/stage-feed.tsx", import.meta.url), "utf8");
const studioStyles = readFileSync(new URL("../../styles/liuguang/studio.css", import.meta.url), "utf8");
const chatStyles = readFileSync(new URL("../../styles/liuguang/chat.css", import.meta.url), "utf8");

test("song cards expose a disciplined track hierarchy and persistent controls", () => {
  assert.match(player, /trackNumber\?: number/);
  assert.match(player, /`TRACK \$\{String\(trackNumber\)\.padStart\(2, "0"\)\}`/);
  assert.match(player, /p\.playing && <span className="sc-now">PLAYING<\/span>/);
  assert.match(feed, /className=\{`ws-run-imgs\$\{r\.type === "audio" \? " audio-stage" : ""\}`\}/);
  assert.match(feed, /trackNumber=\{itemIndex \+ 1\}/);
  assert.match(studioStyles, /\.sc-row\{[\s\S]*?display:grid[\s\S]*?grid-template-columns:/);
  assert.match(studioStyles, /\.sc-cover-act\{[\s\S]*?opacity:\.82/);
  assert.match(studioStyles, /@container song-list \(max-width:560px\)/);
  assert.match(chatStyles, /\.chat-gen-audio\{[\s\S]*?gap:8px[\s\S]*?padding:8px/);
});

test("real waveform decoding starts on interaction instead of every card mount", () => {
  assert.match(player, /const \[decodeRequested, setDecodeRequested\] = useState\(\(\) => !!autoPlay\)/);
  assert.match(player, /if \(!decodeRequested\) return/);
  assert.match(player, /const toggle = useCallback\(\(\) => \{[\s\S]*?setDecodeRequested\(true\)/);
  assert.match(player, /onPointerDown=\{\(e\) => \{[\s\S]*?setDecodeRequested\(true\)/);
  assert.match(player, /void au\.play\(\)\.catch\(\(\) => setPlaying\(false\)\)/);
  assert.match(player, /peaksRef\.current = pseudoPeaks\(src\)[\s\S]*?growRef\.current\.start = 0[\s\S]*?draw\(\)/);
  assert.match(player, /if \(cached\) \{[\s\S]*?peaksRef\.current = cached[\s\S]*?growRef\.current\.start = 0/);
});

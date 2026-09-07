import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const audioNode = readFileSync(new URL("./audio-node.tsx", import.meta.url), "utf8");
const uploadHook = readFileSync(new URL("./shared/use-media-upload.ts", import.meta.url), "utf8");

test("audio node exposes local upload in both empty and selected states", () => {
  assert.match(audioNode, /useMediaUpload\(node, "audio", undefined\)/);
  assert.match(audioNode, /accept=\{CANVAS_AUDIO_ACCEPT\}/);
  assert.match(audioNode, /<Upload[^>]*\/>上传本地音频/);
  assert.match(audioNode, /<FolderOpen[^>]*\/>从资产库选择/);
  assert.match(audioNode, /node\.audioSrc \? "替换" : "上传"/);
  assert.match(audioNode, /<AssetPickerModal[\s\S]*kind="audio"[\s\S]*lockKind/);
  assert.equal(audioNode.match(/h-11 touch-manipulation/g)?.length, 4);
});

test("audio upload shares the media replacement mutex and cannot race generation", () => {
  assert.match(audioNode, /if \(generating \|\| nodeUploading\) return/);
  assert.match(audioNode, /disabled=\{!canGenerate \|\| generating \|\| nodeUploading\}/);
  assert.match(uploadHook, /canReplaceCanvasMedia\(current\)/);
  assert.match(uploadHook, /canCommitCanvasMediaUpload\(latest\)/);
  assert.match(audioNode, /existingUrls=\{\[node\.audioSrc, \.\.\.tracks\.map/);
});

test("successful audio replacement clears stale generated tracks and records the hosted URL", () => {
  assert.match(uploadHook, /audio: \{ status: "success", label: "音频", successToast: "音频已上传" \}/);
  assert.match(uploadHook, /patch\.audioSrc = res\.data\.fileUrl;[\s\S]*patch\.audioTracks = undefined/);
  assert.match(uploadHook, /\^音频节点[\s\S]*patch\.title = uploadFile\.name/);
  assert.match(uploadHook, /updateNode\(node\.id, patch, true\)/);
});

test("audio upload reports real progress and restores the picker after every outcome", () => {
  assert.match(audioNode, /nodeUploadPct > 0 \? `上传音频 \$\{nodeUploadPct\}%` : "正在载入音频\.\.\."/);
  assert.match(audioNode, /onError=\{\(\) => \{[\s\S]*if \(!nodeUploading\) toast\.error/);
  assert.match(uploadHook, /e\.target\.value = ""/);
  assert.match(uploadHook, /let objUrl = "";[\s\S]*try \{[\s\S]*objUrl = URL\.createObjectURL/);
  assert.match(uploadHook, /finally \{[\s\S]*uploading: false[\s\S]*URL\.revokeObjectURL\(objUrl\)/);
});

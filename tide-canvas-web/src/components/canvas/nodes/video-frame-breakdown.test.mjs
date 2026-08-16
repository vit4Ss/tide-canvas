import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildStoryboardOutputs,
  buildStoryboardAnalysisPrompt,
  formatStoryboardTime,
  parseStoryboardAnalysis,
  sampleStoryboardTimes,
  selectStoryboardAnalysisModel,
} from "./video-frame-breakdown.ts";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("storyboard sampling uses evenly spaced representative frames", () => {
  assert.deepEqual(sampleStoryboardTimes(12, 4), [1.5, 4.5, 7.5, 10.5]);
  assert.deepEqual(sampleStoryboardTimes(0, 4), []);
  assert.equal(sampleStoryboardTimes(12, 100).length, 24);
  assert.equal(formatStoryboardTime(65.25), "01:05.3");
  assert.equal(formatStoryboardTime(59.96), "01:00.0");
  assert.equal(formatStoryboardTime(119.99), "02:00.0");
  assert.equal(sampleStoryboardTimes(0.01, 20).length, 1);
});

test("storyboard outputs compact image nodes in connected groups", () => {
  let nodeSeq = 0;
  let groupSeq = 0;
  const frames = Array.from({ length: 5 }, (_, index) => ({
    url: `https://cdn.example/frame-${index}.png`,
    width: 1920,
    height: 1080,
    timeSec: index + 0.5,
  }));
  const result = buildStoryboardOutputs({
    processor: { id: "processor", type: "video_breakdown", x: 100, y: 200, width: 360, height: 264, title: "逐帧拉片" },
    sourceVideoId: "source",
    frames,
    framesPerGroup: 4,
    existingGroupCount: 1,
    colors: ["#111111", "#222222", "#333333"],
    makeNodeId: () => `frame-${++nodeSeq}`,
    makeGroupId: () => `group-${++groupSeq}`,
  });

  assert.equal(result.nodes.length, 5);
  assert.equal(result.connections.length, 5);
  assert.deepEqual(result.groups.map((group) => group.nodeIds.length), [4, 1]);
  assert.equal(result.groups[0].color, "#222222");
  assert.equal(result.nodes[0].title, "S01 · 00:00.5");
  assert.equal(result.nodes[0].storyboardFrame.sourceVideoId, "source");
  assert.equal(result.connections[0].sourceId, "processor");
  assert.equal(result.nodes[1].x - result.nodes[0].x, 328);
  assert.ok(result.groups[1].title.startsWith("分镜组 02"));
});

test("repeated storyboard runs are placed below prior outputs and labeled", () => {
  const prior = {
    id: "old",
    type: "image",
    x: 600,
    y: 900,
    width: 280,
    height: 158,
    title: "S01",
    storyboardFrame: { sourceVideoId: "source", processorId: "processor", timeSec: 1, index: 1, run: 1 },
  };
  const result = buildStoryboardOutputs({
    processor: { id: "processor", type: "video_breakdown", x: 100, y: 200, width: 360, height: 326, title: "逐帧拉片" },
    sourceVideoId: "source",
    frames: [{ url: "https://cdn.example/new.jpg", width: 1920, height: 1080, timeSec: 2 }],
    framesPerGroup: 4,
    existingGroupCount: 1,
    existingNodes: [prior],
    runNumber: 2,
    colors: ["#111111"],
    makeNodeId: () => "new",
    makeGroupId: () => "group",
  });
  assert.ok(result.nodes[0].y > prior.y + prior.height);
  assert.ok(result.groups[0].title.startsWith("拉片 02 · 分镜组 01"));
  assert.equal(result.nodes[0].storyboardFrame.run, 2);
});

test("storyboard analysis prompt and parser keep frame indexes stable", () => {
  const prompt = buildStoryboardAnalysisPrompt([1, 2], ["storyboard", "motion"]);
  assert.match(prompt, /固定镜头/);
  const parsed = parseStoryboardAnalysis(JSON.stringify({ frames: [
    { index: 2, shotSize: "近景", description: "人物转头" },
    { index: 1, shotSize: "远景", motion: "推进" },
    { index: 99, description: "ignore" },
  ] }), 2);
  assert.deepEqual(parsed.map((item) => item.index), [1, 2]);
  assert.deepEqual(parseStoryboardAnalysis("not-json", 2), []);
});

test("storyboard analysis only selects an explicitly vision-capable text model", () => {
  const base = {
    id: "1",
    name: "model",
    icon: "",
    type: "text",
    supportedHandlers: ["skill_text_completion"],
    pointCost: 1,
  };
  const textOnly = { ...base, modelId: "text-only", config: JSON.stringify({ capabilities: ["text"] }) };
  const vision = { ...base, id: "2", modelId: "vision", config: JSON.stringify({ inputModalities: ["text", "image"] }) };
  assert.equal(selectStoryboardAnalysisModel([textOnly, vision])?.modelId, "vision");
  assert.equal(selectStoryboardAnalysisModel([textOnly]), undefined);
  assert.equal(selectStoryboardAnalysisModel([{ ...vision, supportedHandlers: ["assistant_chat"] }]), undefined);
});

test("breakdown controls expose clear state and restrained progress feedback", () => {
  const breakdownNode = read("./video-breakdown-node.tsx");
  const imageNode = read("./image-node.tsx");
  const editor = read("./scene-3d-editor.tsx");
  const videoNode = read("./video-node.tsx");

  assert.match(breakdownNode, /aria-pressed=\{active\}/);
  assert.match(breakdownNode, /aria-busy=\{analyzing\}/);
  assert.match(breakdownNode, /aria-live="polite"/);
  assert.match(breakdownNode, /analysisModelStatus === "unavailable"/);
  assert.match(breakdownNode, /模型检查失败 · 重试/);
  assert.match(breakdownNode, /const cancelBreakdown = useCallback/);
  assert.match(breakdownNode, /const registered = await aiApi\.registerCapturedFrame/);
  assert.match(breakdownNode, /analysisTaskIdRef\.current === taskId/);
  assert.doesNotMatch(breakdownNode, /audioInput|AudioLines|视频或音频/);
  assert.match(breakdownNode, /inputTitle="连接待拉片视频"/);
  assert.match(breakdownNode, /\} catch \(error\) \{\s*if \(!active\(\)\) return;\s*const message = error instanceof VideoFrameError/);
  assert.match(breakdownNode, /if \(analyzing\) cancelBreakdown\(\)/);
  assert.match(breakdownNode, /<CapturableVideo[\s\S]*showFrameCapture=\{false\}/);
  assert.doesNotMatch(breakdownNode, /<video\b/);
  assert.match(breakdownNode, /style=\{\{ transform: `scaleX\(\$\{progressPct \/ 100\}\)` \}\}/);
  assert.match(breakdownNode, /analyzing && stage === "frames"/);
  assert.match(breakdownNode, /语义分析中 · 点击停止/);
  assert.doesNotMatch(breakdownNode, /⚡|rounded-full|bg-cyan/);
  assert.match(imageNode, /storyboardFrame\.motion[\s\S]*text-white\/70/);
  assert.match(editor, /aria-pressed=\{motion\.loop\}/);
  assert.match(editor, /aria-expanded=\{motionOpen\}/);
  assert.match(editor, /selRigId && !motionPlaybackActive/);
  assert.match(videoNode, /disabled=\{!node\.videoSrc \|\| nodeUploading \|\| generating\}/);
});

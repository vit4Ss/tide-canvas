import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const raw = readFileSync(new URL("./canvas-assistant-panel.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("panel.tsx", raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function extract(name) {
  let found;
  function visit(node) {
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name?.getText(source) === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, `${name} missing`);
  return ts.isVariableDeclaration(found) ? `const ${found.getText(source)};` : found.getText(source);
}
const code = ts.transpileModule([
  extract("assistantAttachmentError"), extract("sendMessage"), extract("handleFileChange"),
  "globalThis.send = sendMessage; globalThis.upload = handleFileChange;",
].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function setup({ attachments = [], parameters = {}, skill = { kind: "agent" } } = {}) {
  const stop = new Error("captured skill request");
  const captured = [], errors = [], limitModels = [], uploaded = [];
  const context = {
    assistantScope: "scope", readySessionScope: "scope", message: "Review this video",
    attachments, selectedSkill: skill, skillParameters: parameters, messages: [],
    selectedNodeIds: new Set(), sendLockRef: { current: false }, sending: false, uploading: false,
    selectedModel: { modelId: "chat-model", config: '{"fileUpload":false,"maxFileCount":1}' },
    MAX_ASSISTANT_ATTACHMENTS: 12, MAX_SKILL_PROMPT_BYTES: 32 * 1024,
    toast: { error: (message) => errors.push(message), info() {}, success() {} },
    referenceKindFromMeta: () => "video",
    referenceKindFromFile: () => "video",
    setUploading() {}, setUploadProgress() {},
    sessionScopeRef: { current: "scope" }, sessionSwitchEpochRef: { current: 1 },
    setAttachments: (updater) => { context.attachments = updater(context.attachments); },
    uploadFileSmart: async (file) => {
      uploaded.push(file.name);
      return { success: true, data: { fileUrl: "https://assets.test/video.mp4" } };
    },
    resolveModelReferenceLimitBytes: (model) => { limitModels.push(model); return 50 * 1024 * 1024; },
    validateKnownFileSize: () => null,
    activeSessionId: "session", recentTextHistory: (history) => history,
    utf8Length: (text) => new TextEncoder().encode(text).length,
    projectId: "project", useCanvasStore: { getState: () => ({ currentProjectId: "project" }) },
    skillKindOf: (value) => value.kind,
    buildCanvasSkillRunInput: (_, input) => { captured.push(input); throw stop; },
    filesToSkillAssets: (files) => files,
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return { context, stop, captured, errors, limitModels, uploaded };
}

test("canvas Skill requests do not inherit the ordinary chat model", async () => {
  const env = setup();
  await assert.rejects(env.context.send(), (error) => error === env.stop);
  assert.equal(env.captured[0].parameters.textModelId, undefined);
});

test("an unrelated chat model cannot block Skill attachments or set their upload limit", async () => {
  const env = setup({ attachments: [{ originalName: "video.mp4", fileSize: 123 }] });
  await assert.rejects(env.context.send(), (error) => error === env.stop);
  assert.deepEqual(env.errors, []);
  assert.deepEqual(env.limitModels, [undefined]);
});

test("deliberate Skill parameters remain available to the server", async () => {
  const env = setup({ parameters: { textModelId: "explicit-skill-model", mode: "review" } });
  await assert.rejects(env.context.send(), (error) => error === env.stop);
  assert.equal(env.captured[0].parameters.textModelId, "explicit-skill-model");
  assert.equal(env.captured[0].parameters.mode, "review");
});

test("ordinary chat still enforces its selected model's attachment support", async () => {
  const env = setup({ skill: null, attachments: [{ originalName: "video.mp4", fileSize: 123 }] });
  await env.context.send();
  assert.match(env.errors[0], /不支持/);
  assert.equal(env.captured.length, 0);
});

test("uploading a Skill's video ignores chat-model restrictions but keeps the upload path", async () => {
  const env = setup();
  await env.context.upload({ target: { files: [{ name: "review.mp4" }], value: "chosen" } });
  assert.deepEqual(env.errors, []);
  assert.deepEqual(env.uploaded, ["review.mp4"]);
  assert.deepEqual(env.limitModels, [undefined]);
  assert.equal(env.context.attachments.length, 1);
});

test("Skill uploads retain the overall attachment limit", async () => {
  const env = setup({ attachments: Array.from({ length: 12 }, () => ({ fileUrl: "https://assets.test/image.jpg" })) });
  await env.context.upload({ target: { files: [{ name: "review.mp4" }], value: "chosen" } });
  assert.match(env.errors[0], /最多分析 12/);
  assert.equal(env.uploaded.length, 0);
});

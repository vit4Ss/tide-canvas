import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as defaults from "../../../lib/admin-skill-defaults.ts";
import * as types from "../../../types/admin-skill.ts";
import * as packageHelpers from "../../../lib/admin-skill-package.ts";

const source = readFileSync(new URL("./_components/skill-version-modal.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const ok = (data) => ({ success: true, data });
const plain = (value) => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const skill = { id: "10", title: "Imported review", kind: "agent", outputType: "text", entryPoints: ["canvas"], currentVersionId: "101", defaultParams: "{}" };
const version = (id = "101", no = 1) => ({
  id, skillId: "10", version: no, kind: "agent", status: "published", entryPoints: '["canvas"]',
  primaryOutputType: "text", outputTypes: '["text"]', inputSchema: '{"type":"object","properties":{"video":{"type":"string"}}}',
  manifest: '{"kind":"agent","steps":[{"id":"review","type":"llm","outputType":"text"}]}',
  promptTemplate: "{{skill.primary}}\n{{skill.file:references/checklist.md}}", modelId: "text-model", defaultParams: '{"temperature":0.3}',
  bindings: '[{"surface":"canvas","targetType":"video","enabled":true,"sortOrder":5,"defaults":{"mode":"review"}}]',
  primaryFilePath: "SKILL.md", contentHash: "hash",
  files: [{ path: "SKILL.md", content: "Review the video", mimeType: "text/markdown", size: 16 },
    { path: "references/checklist.md", content: "Check continuity", mimeType: "text/markdown", size: 16 }],
});

// Render the actual modal with deterministic hooks and mocked HTTP. Handlers,
// hydration, form serialization and JSX conditions all run from production code.
function setup(overrides = {}, selectedSkill = skill) {
  let cursor = 0, tree, dirty = true, props = { open: true, skill: selectedSkill, onClose() {}, onChanged: async () => {} };
  const hooks = [], effects = [], frames = new Map(), calls = [], messages = [];
  let frameId = 0;
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { value: typeof initial === "function" ? initial() : initial };
      return [hooks[index].value, (value) => { hooks[index].value = typeof value === "function" ? value(hooks[index].value) : value; dirty = true; }];
    },
    useRef(initial) { const index = cursor++; hooks[index] ??= { current: initial }; return hooks[index]; },
    useMemo(fn, deps) {
      const index = cursor++;
      if (!hooks[index] || changed(hooks[index].deps, deps)) hooks[index] = { deps, value: fn() };
      return hooks[index].value;
    },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!hooks[index] || changed(hooks[index].deps, deps)) {
        const previous = hooks[index]; hooks[index] = { deps, cleanup: previous?.cleanup };
        effects.push(() => { previous?.cleanup?.(); hooks[index].cleanup = fn(); });
      }
    },
  };
  const api = {
    listVersions: async () => ok([{ ...version("102", 2), status: "draft", files: undefined }, { ...version(), files: undefined }]),
    listBindings: async () => ok([{ surface: "canvas", targetType: "*", enabled: true, sortOrder: 0 }]),
    getVersion: async (skillId, id) => { calls.push(["get", skillId, id]); return ok(version(id)); },
    importVersion: async (id, dto) => { calls.push(["save", id, plain(dto)]); return ok(version()); },
    createVersion: async (id, dto) => { calls.push(["save", id, plain(dto)]); return ok(version()); },
    ...overrides,
  };
  const stub = new Proxy({}, { get: (_, name) => String(name) });
  const exports = {};
  vm.runInNewContext(code, {
    exports, Blob, Error, console,
    requestAnimationFrame: (fn) => { const id = ++frameId; frames.set(id, fn); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
    require: (name) => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name === "@/lib/admin-skills-api") return { adminSkillsApi: api };
      if (name === "@/lib/admin-skill-defaults") return defaults;
      if (name === "@/types/admin-skill") return types;
      if (name === "@/lib/admin-skill-package") return packageHelpers;
      if (name === "@/types/skill") return { SKILL_KIND_LABEL: { agent: "智能技能" }, SKILL_OUTPUT_LABEL: { text: "文本" } };
      if (name === "@/components/shared/toast") return { toast: Object.fromEntries(["info", "error", "success"].map((type) => [type, (msg) => messages.push([type, msg])])) };
      if (name.endsWith("skill-input-schema-presets")) return { detectSkillInputPreset: () => "text", SKILL_INPUT_PRESETS: [] };
      return stub;
    },
  });
  const render = () => { cursor = 0; dirty = false; tree = exports.SkillVersionModal(props); while (effects.length) effects.shift()(); };
  const flush = async () => {
    for (let i = 0; i < 8; i++) {
      if (dirty) render();
      for (const [id, fn] of [...frames]) { frames.delete(id); fn(); }
      await tick();
    }
  };
  function nodes() {
    const all = [];
    const visit = (node) => { if (!node) return; if (Array.isArray(node)) return node.forEach(visit); if (typeof node !== "object") return; all.push(node); visit(node.props?.children); };
    visit(tree); return all;
  }
  const content = (node) => typeof node === "string" || typeof node === "number" ? String(node)
    : Array.isArray(node) ? node.map(content).join("") : node && typeof node === "object"
      ? content(node.props?.title) + content(node.props?.children) : "";
  return {
    flush, calls, messages, nodes, content: () => content(tree),
    save: () => tree.props.onSave(),
    read: (files) => nodes().find((node) => node.type === "input" && node.props.type === "file").props.onChange({ target: { files, value: "chosen" } }),
    switchSkill: (next) => { props = { ...props, skill: next }; dirty = true; },
    close: () => { props = { ...props, open: false }; dirty = true; },
  };
}

test("opening an imported skill restores current published package and saves all files without reimport", async () => {
  const env = setup(); await env.flush();
  assert.deepEqual(env.calls, [["get", "10", "101"]], "newer draft must not replace the live version");
  assert.match(env.content(), /已载入当前发布版本 v1/);
  assert.match(env.content(), /更换文件包/);
  assert.match(env.content(), /references\/checklist.md/);
  assert.equal(await env.save(), true);
  const dto = env.calls.find(([action]) => action === "save")[2];
  assert.equal(dto.publish, false);
  assert.equal(dto.primaryFilePath, "SKILL.md");
  assert.deepEqual(dto.files, version().files.map(({ path, content, mimeType }) => ({ path, content, mimeType })));
  assert.equal(dto.promptTemplate, version().promptTemplate);
  assert.deepEqual(dto.manifest, JSON.parse(version().manifest));
  assert.deepEqual(dto.inputSchema, JSON.parse(version().inputSchema));
  assert.deepEqual(dto.bindings, JSON.parse(version().bindings));
});

test("loading or incomplete version details cannot save an empty replacement", async () => {
  const response = deferred();
  const env = setup({ getVersion: () => response.promise }); await env.flush();
  assert.equal(await env.save(), false); assert.ok(!env.calls.some(([action]) => action === "save"));
  response.resolve(ok({ ...version(), files: [] })); await env.flush();
  assert.match(env.content(), /版本文件内容不完整/);
  assert.equal(await env.save(), false);
});

test("regenerating a text Manifest removes the old version model binding", async () => {
  const env = setup(); await env.flush();
  const control = env.nodes().find((node) => node.props?.loadRequests && node.props?.onGenerated);
  assert.ok(control);
  const [request] = await control.props.loadRequests();
  const manifest = { kind: "agent", primaryOutputType: "text", outputTypes: ["text"] };
  control.props.onGenerated([{ key: request.key, signature: request.signature, manifest }]);
  await env.flush();
  assert.equal(await env.save(), true);
  const dto = env.calls.find(([action]) => action === "save")[2];
  assert.equal(dto.modelId, undefined, "generated defaults must not inherit the previous text model");
  assert.deepEqual(dto.manifest, manifest);
});

test("regenerating a media Manifest preserves the administrator's media model", async () => {
  const env = setup({ getVersion: async () => ok({ ...version(), primaryOutputType: "image", outputTypes: '["text","image"]', modelId: "image-model" }) });
  await env.flush();
  const control = env.nodes().find((node) => node.props?.loadRequests && node.props?.onGenerated);
  const [request] = await control.props.loadRequests();
  const manifest = { kind: "agent", primaryOutputType: "image", outputTypes: ["text", "image"] };
  control.props.onGenerated([{ key: request.key, signature: request.signature, manifest }]);
  await env.flush();
  assert.equal(await env.save(), true);
  assert.equal(env.calls.find(([action]) => action === "save")[2].modelId, "image-model");
});

for (const output of ["text", "file", "image", "video", "audio"]) {
  test(`regeneration clears text overrides from version and placement defaults (${output})`, async () => {
    const params = { modelId: "old-output-model", textModelId: "old-text-model", temperature: 0.3, options: { modelId: "content-value" } };
    const placement = { surface: "canvas", targetType: "*", enabled: true, sortOrder: 0, defaults: { ...params, mode: "review" } };
    const env = setup({ getVersion: async () => ok({
      ...version(), primaryOutputType: output, outputTypes: JSON.stringify([output]),
      defaultParams: JSON.stringify(params), bindings: JSON.stringify([placement]),
    }) });
    await env.flush();
    const control = env.nodes().find((node) => node.props?.loadRequests && node.props?.onGenerated);
    const [request] = await control.props.loadRequests();
    const manifest = { kind: "agent", primaryOutputType: output, outputTypes: [output] };
    control.props.onGenerated([{ key: request.key, signature: request.signature, manifest }]);
    await env.flush();
    assert.equal(await env.save(), true);
    const dto = env.calls.find(([action]) => action === "save")[2];
    const expected = { temperature: 0.3, options: { modelId: "content-value" } };
    if (!["text", "file"].includes(output)) expected.modelId = "old-output-model";
    assert.deepEqual(dto.defaultParams, expected);
    assert.deepEqual(dto.bindings[0].defaults, { ...expected, mode: "review" });
  });
}

test("saving without regeneration preserves deliberate model defaults", async () => {
  const params = { textModelId: "manual-text-model", modelId: "manual-output-model", temperature: 0.3 };
  const env = setup({ getVersion: async () => ok({ ...version(), defaultParams: JSON.stringify(params) }) });
  await env.flush();
  assert.equal(await env.save(), true);
  assert.deepEqual(env.calls.find(([action]) => action === "save")[2].defaultParams, params);
});

test("regeneration cannot hide malformed default parameters from save validation", async () => {
  const env = setup({ getVersion: async () => ok({ ...version(), defaultParams: "invalid JSON" }) });
  await env.flush();
  const control = env.nodes().find((node) => node.props?.loadRequests && node.props?.onGenerated);
  const [request] = await control.props.loadRequests();
  control.props.onGenerated([{ key: request.key, signature: request.signature, manifest: { kind: "agent" } }]);
  await env.flush();
  assert.equal(await env.save(), false);
  assert.equal(env.calls.some(([action]) => action === "save"), false);
});

test("switching skills discards an old package response", async () => {
  const response = deferred();
  const env = setup({ getVersion: (skillId) => skillId === "10" ? response.promise : Promise.resolve(ok({ ...version("201"), skillId: "20", files: [{ path: "SKILL.md", content: "Second skill", mimeType: "text/markdown" }] })) });
  await env.flush(); env.switchSkill({ ...skill, id: "20", currentVersionId: "201" }); await env.flush();
  response.resolve(ok(version())); await env.flush();
  assert.equal(await env.save(), true);
  const saved = env.calls.find(([action]) => action === "save");
  assert.equal(saved[1], "20"); assert.equal(saved[2].files[0].content, "Second skill");
});

test("read failure retains the previously imported package", async () => {
  const env = setup(); await env.flush();
  env.read([{ name: "new.md", size: 10, arrayBuffer: async () => { throw new Error("cannot read file"); } }]);
  await env.flush(); assert.equal(await env.save(), true);
  assert.equal(env.calls.find(([action]) => action === "save")[2].files.length, 2);
  assert.ok(env.messages.some(([, text]) => text.includes("无法读取")));
});

test("nonstandard replacement files are rejected without overwriting the loaded version", async () => {
  const env = setup({ validateFiles: async () => ok({ valid: false, items: [{ index: 0, valid: false, errors: ["SKILL.md 缺少 YAML"] }] }) });
  await env.flush();
  env.read([{ name: "SKILL.md", size: 10, arrayBuffer: async () => new TextEncoder().encode("Plain text").buffer }]);
  await env.flush();
  assert.ok(env.messages.some(([, message]) => message.includes("缺少 YAML")));
  assert.equal(await env.save(), true);
  assert.equal(env.calls.find(([action]) => action === "save")[2].files[0].content, "Review the video");
});

test("skills with no published pointer use the newest draft, truly new skills use the initial form", async () => {
  const draft = setup({ listVersions: async () => ok([{ ...version("103", 3), status: "draft" }, { ...version("102", 2), status: "draft" }]) }, { ...skill, currentVersionId: undefined });
  await draft.flush(); assert.deepEqual(draft.calls[0], ["get", "10", "103"]);
  const fresh = setup({ listVersions: async () => ok([]) }, { ...skill, currentVersionId: undefined });
  await fresh.flush(); assert.equal(fresh.calls.length, 0);
  assert.match(fresh.content(), /当前没有文件包/);
});

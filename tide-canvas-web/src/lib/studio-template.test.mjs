import assert from "node:assert/strict";
import test from "node:test";
import {
  templatePrompt,
  templateModelIssue,
  templateReferenceIssue,
  remapTemplateReferences,
  withoutTemplateStyle,
  templateOptions,
  templateInputs,
} from "./studio-template.ts";
const row = {
  id: "1",
  kind: "style",
  mediaType: "image",
  title: "Clay",
  prompt: "clay lighting",
  mode: "i2i",
  requirements: { images: 1, videos: 0, audio: 0 },
  inputHint: "Upload your portrait",
};
test("removing a style preserves the subject and never strips a partially edited prefix", () => {
  assert.equal(withoutTemplateStyle("clay lighting\n\na cat", row), "a cat");
  assert.equal(
    withoutTemplateStyle("clay lightingness on a cat", row),
    "clay lightingness on a cat",
  );
  assert.equal(withoutTemplateStyle("clay lighting", row), "");
  assert.equal(
    withoutTemplateStyle("replace clothing", { ...row, kind: "inspiration" }),
    "replace clothing",
  );
});
test("styles preserve subjects, switching styles replaces only the previous intact prefix", () => {
  assert.equal(templatePrompt("a cat", row), "clay lighting\n\na cat");
  assert.equal(
    templatePrompt(
      "clay lighting\n\na cat",
      { ...row, prompt: "paper craft" },
      row,
    ),
    "paper craft\n\na cat",
  );
  assert.equal(
    templatePrompt(
      "custom edited clay",
      { ...row, prompt: "paper craft" },
      row,
    ),
    "paper craft\n\ncustom edited clay",
  );
  assert.equal(
    templatePrompt("a cat", {
      ...row,
      kind: "inspiration",
      prompt: "replace clothing",
    }),
    "replace clothing",
  );
});
test("requirements count only ready references in active slots", () => {
  const slots = [{ k: "img", type: "image", max: 4 }];
  assert.match(
    templateReferenceIssue(row, slots, {
      hidden: [{ url: "hidden" }],
      img: [{ url: "upload", uploading: true }],
    }),
    /至少 1 张图片/,
  );
  assert.equal(
    templateReferenceIssue(row, slots, { img: [{ url: "ready" }] }),
    null,
  );
  const video = {
    ...row,
    mediaType: "video",
    mode: "ref",
    requirements: { images: 0, videos: 1, audio: 1 },
  };
  assert.match(
    templateReferenceIssue(
      video,
      [
        { k: "video", type: "video" },
        { k: "audio", type: "audio" },
      ],
      { video: [{ url: "v" }] },
    ),
    /1 段音频/,
  );
});
test("changing mode moves user references without using the example cover", () => {
  const source = { img: [{ url: "mine1" }, { url: "mine2" }] };
  const moved = remapTemplateReferences(
    source,
    [{ k: "img", type: "image", max: 4 }],
    [{ k: "first", type: "image", max: 1 }],
  );
  assert.deepEqual(moved, {
    data: { first: [{ url: "mine1" }] },
    discarded: 1,
  });
  assert.equal(source.img.length, 2);
});

test("semantic frame positions survive applying a template with an empty first frame", () => {
  const slots = [
    { k: "first", type: "image", max: 1 },
    { k: "last", type: "image", max: 1 },
  ];
  assert.deepEqual(
    remapTemplateReferences({ last: [{ url: "tail" }] }, slots, slots),
    { data: { first: [], last: [{ url: "tail" }] }, discarded: 0 },
  );
  assert.deepEqual(
    remapTemplateReferences(
      { first: [{ url: "head" }], last: [{ url: "tail" }] },
      slots,
      slots,
    ),
    {
      data: { first: [{ url: "head" }], last: [{ url: "tail" }] },
      discarded: 0,
    },
  );
  assert.deepEqual(
    remapTemplateReferences(
      { last: [{ url: "tail" }, { url: "extra-tail" }] },
      slots,
      slots,
    ),
    { data: { first: [], last: [{ url: "tail" }] }, discarded: 1 },
  );
  assert.deepEqual(
    remapTemplateReferences(
      { img: [{ url: "a" }, { url: "b" }] },
      [{ k: "img", type: "image", max: 4 }],
      slots,
    ),
    { data: { first: [{ url: "a" }], last: [{ url: "b" }] }, discarded: 0 },
  );
});

test("references hidden by a disabled model input are counted before removal", () => {
  assert.deepEqual(
    remapTemplateReferences(
      { img: [{ url: "portrait" }], video: [{ url: "hidden-video" }] },
      [{ k: "img", type: "image", max: 4 }],
      [{ k: "img", type: "image", max: 4 }],
    ),
    { data: { img: [{ url: "portrait" }] }, discarded: 1 },
  );
});

test("recommended options use the model's exact strings and ignore unsupported values", () => {
  const model = {
    config: {
      resolutions: ["1k", "4k"],
      durations: ["5", "10"],
      qualities: ["standard", "HIGH"],
      ratios: ["1:1", "16:9"],
    },
  };
  assert.deepEqual(
    templateOptions(
      {
        ...row,
        options: {
          resolution: "4K",
          duration: 10,
          quality: "high",
          aspectRatio: " 16:9 ",
        },
      },
      model,
    ),
    { resolution: "4k", duration: "10", quality: "HIGH", aspectRatio: "16:9" },
  );
  assert.deepEqual(
    templateOptions(
      {
        ...row,
        options: {
          resolution: "8K",
          duration: 99,
          quality: "ultra",
          aspectRatio: "32:9",
        },
      },
      model,
    ),
    {
      resolution: undefined,
      duration: undefined,
      quality: undefined,
      aspectRatio: undefined,
    },
  );
});

test("reference-mode templates do not claim that a text description alone is enough", () => {
  assert.equal(
    templateInputs({
      ...row,
      mode: "ref",
      requirements: { images: 0, videos: 0, audio: 0 },
    }),
    "至少 1 个参考素材",
  );
});
test("model capability checks prevent unsupported template modes and media", () => {
  assert.match(
    templateModelIssue(row, { type: "video", config: {} }),
    /不一致/,
  );
  assert.match(
    templateModelIssue(row, { type: "image", config: { modes: ["t2i"] } }),
    /不支持/,
  );
  assert.equal(
    templateModelIssue(row, {
      type: "image",
      config: { modes: ["t2i", "i2i"] },
    }),
    null,
  );
  assert.match(
    templateModelIssue(
      {
        ...row,
        mediaType: "video",
        mode: "ref",
        requirements: { images: 0, videos: 1, audio: 0 },
      },
      {
        type: "video",
        config: { modes: ["omni_ref"], omniRefVideoEnabled: false },
      },
    ),
    /素材类型/,
  );
});

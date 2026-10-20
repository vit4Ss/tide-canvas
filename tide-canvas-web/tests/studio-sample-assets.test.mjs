import assert from "node:assert/strict";
import test from "node:test";
import { readFile, stat } from "node:fs/promises";
import sharp from "sharp";

const catalog = JSON.parse(
  await readFile(
    new URL(
      "../../tide-canvas-server/internal/handler/studiotemplate/samples.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const provenance = JSON.parse(
  await readFile(
    new URL(
      "../scripts/studio-sample-provenance.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
test("all starter recipes point to actual generated full-resolution artwork", async () => {
	await assert.rejects(stat(new URL("../public/studio-samples/v1/generation-prompts.json", import.meta.url)), { code: "ENOENT" });
  assert.equal(catalog.length, 8);
  assert.equal(provenance.assets.length, 8);
  let total = 0;
  for (const entry of catalog) {
    const row = entry.template;
    assert.equal(row.coverUrl, `/studio-samples/v1/${entry.slug}.webp`);
    const file = new URL("../public" + row.coverUrl, import.meta.url);
    const info = await sharp(await readFile(file)).metadata();
    assert.equal(info.format, "webp");
    assert.ok(info.width >= 1000 && info.height >= 900);
    total += (await stat(file)).size;
    const origin = provenance.assets.find(
      (item) => item.file === entry.slug + ".webp",
    );
    assert.ok(
      origin?.prompt.length > 100,
      "original generation prompt missing",
    );
    assert.ok(
      row.prompt.length > 80 && row.inputHint,
      "template recipe not ready",
    );
    if (row.mediaType === "video") {
      assert.equal(row.status, 0);
      assert.equal(row.previewUrl, "");
      assert.equal(origin.kind, "storyboard-still");
    } else assert.equal(row.status, 1);
  }
  assert.ok(total < 4 * 1024 * 1024, "web artwork unexpectedly heavy");
});

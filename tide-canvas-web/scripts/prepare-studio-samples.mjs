// Package generated artwork for the web without resizing or cropping it.
// Usage: node scripts/prepare-studio-samples.mjs ../.runtime/studio-image-sources.json
import { readFile, mkdir, copyFile, constants } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "public/studio-samples/v1");
const archive = resolve(root, "../.runtime/imagegen/studio-samples-v1");
const manifest = process.argv[2];
if (!manifest) throw new Error("Provide the local generated-image manifest");
const entries = JSON.parse(await readFile(resolve(manifest), "utf8"));
await mkdir(output, { recursive: true });
await mkdir(archive, { recursive: true });
for (const { slug, source } of entries) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new Error("Invalid asset name");
  const original = resolve(archive, slug + ".png");
  try {
    await copyFile(source, original, constants.COPYFILE_EXCL);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  const before = await sharp(original).metadata();
  const result = await sharp(original)
    .webp({ quality: 88, effort: 5 })
    .toFile(resolve(output, slug + ".webp"));
  if (result.width !== before.width || result.height !== before.height)
    throw new Error("Unexpected image dimension change");
  console.log(
    `${slug}: ${result.width} x ${result.height}, ${(result.size / 1024).toFixed(0)} KiB`,
  );
}

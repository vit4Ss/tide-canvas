import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MODEL_MAINTENANCE_MESSAGE,
  modelDisplayBadges,
  modelUnderMaintenance,
} from "./model-availability.ts";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const admin = read("../app/admin/models/page.tsx");
const studioGenerate = read("../components/studio/create-studio/use-generation.ts");
const studioPicker = read("../components/studio/create-studio/model-picker.tsx");
const chatSend = read("../app/(studio)/chat/_hooks/use-send-message.ts");
const chatComposer = read("../app/(studio)/chat/_components/composer.tsx");
const canvasPicker = read("../components/canvas/nodes/model-picker.tsx");

test("model maintenance defaults to normal and adds one visible status badge", () => {
  assert.equal(modelUnderMaintenance(undefined), false);
  assert.equal(modelUnderMaintenance({ availabilityStatus: "normal" }), false);
  assert.equal(modelUnderMaintenance({ availabilityStatus: "maintenance" }), true);
  assert.deepEqual(modelDisplayBadges({ availabilityStatus: "maintenance", badges: [
    { text: "维护中", tone: "info" },
    { text: "热门", tone: "hot" },
  ] }), [
    { text: "异常", tone: "hot" },
    { text: "热门", tone: "hot" },
  ]);
  assert.equal(MODEL_MAINTENANCE_MESSAGE, "该渠道维护中，暂不可用");
});

test("admin status, model menus and submit entry points share the maintenance contract", () => {
  assert.match(admin, /label="运行状态"/);
  assert.match(admin, /<option value="normal">正常<\/option>/);
  assert.match(admin, /<option value="maintenance">异常（维护中）<\/option>/);
  assert.match(studioPicker, /modelDisplayBadges\(m\.config\)/);
  assert.match(chatComposer, /modelDisplayBadges\(m\.config\)/);
  assert.match(canvasPicker, /primaryBadge\(maintenance, isNew, badges\)/);
  assert.match(canvasPicker, /selectedMaintenance &&[\s\S]*?>异常<\/span>/);
  assert.match(studioGenerate, /modelUnderMaintenance\(selectedStudio\?\.config\)[\s\S]*?MODEL_MAINTENANCE_MESSAGE/);
  assert.match(chatSend, /modelUnderMaintenance\(selModel\?\.config\)[\s\S]*?MODEL_MAINTENANCE_MESSAGE/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildLayerLayoutUnits, packLayerLayoutUnits } from "./canvas-layout-units.ts";

const nodeMap = (count, height) => new Map(Array.from({ length: count }, (_, index) => {
  const id = `frame-${index + 1}`;
  return [id, { id, width: 280, height, contentW: 280, contentH: height }];
}));

test("a four-frame storyboard group remains a compact two-by-two unit", () => {
  const nodes = nodeMap(4, 158);
  const ids = [...nodes.keys()];
  const groups = new Map(ids.map((id) => [id, "storyboard-1"]));
  const [unit] = buildLayerLayoutUnits(ids, nodes, groups, 40, 40);

  assert.equal(unit.width, 656);
  assert.equal(unit.height, 446);
  assert.deepEqual(unit.members.map(({ x, y }) => [x, y]), [
    [28, 62], [348, 62], [28, 260], [348, 260],
  ]);
});

test("packed storyboard groups reserve their visible frames and title bars", () => {
  const nodes = nodeMap(8, 158);
  const ids = [...nodes.keys()];
  const groups = new Map(ids.map((id, index) => [id, `storyboard-${Math.floor(index / 4)}`]));
  const units = buildLayerLayoutUnits(ids, nodes, groups, 40, 40);

  assert.equal(units.length, 2);
  assert.equal(units[0].height, 446);
  assert.equal(units[1].height, 446);
  assert.equal(units[0].height + 40, 486);
  assert.equal(units[0].width + 40, 696);
});

test("portrait storyboard groups never reserve more columns than units", () => {
  const nodes = nodeMap(12, 498);
  const ids = [...nodes.keys()];
  const groups = new Map(ids.map((id, index) => [id, `storyboard-${Math.floor(index / 4)}`]));
  const units = buildLayerLayoutUnits(ids, nodes, groups, 40, 40);
  const columns = packLayerLayoutUnits(units, 1800, 40);

  assert.equal(units.length, 3);
  assert.ok(columns.length <= units.length);
  assert.ok(columns.every((column) => column.length > 0));
  assert.equal(columns.flat().length, units.length);
});

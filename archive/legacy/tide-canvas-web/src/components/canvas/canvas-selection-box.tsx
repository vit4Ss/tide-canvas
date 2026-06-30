"use client";

interface Props {
  startWorldX: number;
  startWorldY: number;
  currentWorldX: number;
  currentWorldY: number;
}

export function CanvasSelectionBox({ startWorldX, startWorldY, currentWorldX, currentWorldY }: Props) {
  const x = Math.min(startWorldX, currentWorldX);
  const y = Math.min(startWorldY, currentWorldY);
  const w = Math.abs(currentWorldX - startWorldX);
  const h = Math.abs(currentWorldY - startWorldY);
  if (w < 2 && h < 2) return null;
  return (
    <div
      className="pointer-events-none absolute rounded border border-blue-500 bg-blue-500/10"
      style={{ left: x, top: y, width: w, height: h }}
    />
  );
}

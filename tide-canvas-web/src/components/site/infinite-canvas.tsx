"use client";

/* ============================================================================
   InfiniteCanvas — React port of renderInfiniteCanvas() from
   design-ref/liuguang/home-render.js. A node-graph showcase: fixed 1120×600
   stage of .ic-node cards wired together with SVG bezier .ic-wire paths, scaled
   down to fit the .ic-frame, animated in via IntersectionObserver (.ic-frame.in
   triggers the wire-draw + node-rise keyframes in flux.css).
   ========================================================================== */

import { useEffect, useRef } from "react";
import { mesh } from "@/lib/mesh";

const PROMPT_A =
  "A stylized, low-angle studio shot from a mirror placed on the floor. The same short-haired model leans over the mirror, looking down with a slightly surprised, open-mouthed expression. The silver Y2K sunglasses are shown from below, emphasizing their reflective frame…";
const PROMPT_B =
  "An extreme studio close-up of the model's face looking directly at the camera. She uses thumb and index finger, with silver metallic nail polish, to delicately lift the nose bridge of the Y2K silver sunglasses. The background is a muted grey void with precise rim lighting…";

type Hue = [number, number, number];
const cover = (h: Hue, hgt: number) =>
  `<div class="ic-img" style="height:${hgt}px; background:${mesh(h[0], h[1], h[2])}"></div>`;

// nodes: [innerHTML, x, y, w]
const NODES: Array<[string, number, number, number]> = [
  [
    '<div class="ic-cap"><span class="dot"></span>Image</div>' + cover([210, 230, 245], 132),
    40,
    150,
    196,
  ],
  [
    '<div class="ic-cap"><span class="dot"></span>Prompt</div><p class="ic-prompt-tx">' +
      PROMPT_A +
      "</p>",
    40,
    350,
    196,
  ],
  [
    '<div class="ic-cap"><span class="dot"></span>Image</div><div class="ic-grid2">' +
      cover([300, 260, 18], 116) +
      cover([8, 350, 28], 116) +
      cover([110, 78, 150], 116) +
      cover([255, 230, 290], 116) +
      "</div>",
    348,
    62,
    392,
  ],
  [
    '<div class="ic-cap"><span class="dot"></span>Prompt</div><p class="ic-prompt-tx">' +
      PROMPT_B +
      "</p>",
    384,
    452,
    348,
  ],
  [
    '<div class="ic-cap video"><span class="dot"></span>Video</div>' + cover([20, 42, 8], 300),
    846,
    132,
    226,
  ],
];

// wires between node ports (stage coords): [x1,y1,x2,y2]
const WIRES: Array<[number, number, number, number]> = [
  [236, 232, 348, 240],
  [236, 430, 348, 300],
  [740, 240, 846, 290],
  [732, 512, 846, 340],
];

export default function InfiniteCanvas() {
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // Build the stage DOM (nodes + SVG wires) once, imperatively — the markup is a
  // fixed-coordinate showcase, identical to home-render.js.
  useEffect(() => {
    const stage = stageRef.current;
    const frame = frameRef.current;
    if (!stage || !frame) return;

    let html =
      '<svg class="ic-wires" viewBox="0 0 1120 600" preserveAspectRatio="none"></svg>';
    NODES.forEach((n, i) => {
      html +=
        '<div class="ic-node" style="left:' +
        n[1] +
        "px; top:" +
        n[2] +
        "px; width:" +
        n[3] +
        "px; --nd:" +
        (0.15 + i * 0.12).toFixed(2) +
        's">' +
        n[0] +
        "</div>";
    });
    stage.innerHTML = html;

    const svg = stage.querySelector(".ic-wires");
    const NS = "http://www.w3.org/2000/svg";
    if (svg) {
      WIRES.forEach(([x1, y1, x2, y2], i) => {
        const dx = Math.max(40, (x2 - x1) * 0.6);
        const d =
          "M" +
          x1 +
          "," +
          y1 +
          " C" +
          (x1 + dx) +
          "," +
          y1 +
          " " +
          (x2 - dx) +
          "," +
          y2 +
          " " +
          x2 +
          "," +
          y2;
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", d);
        p.setAttribute("class", "ic-wire");
        const len = Math.hypot(x2 - x1, y2 - y1) + dx;
        p.style.setProperty("--len", String(Math.round(len * 1.3)));
        p.style.setProperty("--wd", (0.5 + i * 0.18).toFixed(2) + "s");
        svg.appendChild(p);
        [
          [x1, y1],
          [x2, y2],
        ].forEach(([cx, cy]) => {
          const c = document.createElementNS(NS, "circle");
          c.setAttribute("cx", String(cx));
          c.setAttribute("cy", String(cy));
          c.setAttribute("r", "4");
          c.setAttribute("class", "ic-port");
          svg.appendChild(c);
        });
      });
    }

    // scale the fixed 1120-wide stage to fit the frame
    let raf = 0;
    const fit = () => {
      const w = frame.clientWidth;
      if (!w) {
        raf = requestAnimationFrame(fit);
        return;
      }
      const s = Math.min(1, w / 1120);
      stage.style.transform = "scale(" + s + ")";
      frame.style.height = 600 * s + "px";
    };
    raf = requestAnimationFrame(fit);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(frame);
    window.addEventListener("load", fit);

    // trigger wire-draw / node-rise when scrolled in
    let io: IntersectionObserver | null = null;
    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver(
        (es) =>
          es.forEach((e) => {
            if (e.isIntersecting) {
              frame.classList.add("in");
              io?.disconnect();
            }
          }),
        { threshold: 0.25 },
      );
      io.observe(frame);
    } else {
      frame.classList.add("in");
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io?.disconnect();
      window.removeEventListener("load", fit);
    };
  }, []);

  return (
    <div className="ic-frame reveal" ref={frameRef}>
      <div className="ic-stage" id="ic-stage" ref={stageRef} />
    </div>
  );
}

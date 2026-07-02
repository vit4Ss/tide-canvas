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
// 有真实作品图时用图，否则回退 mesh 渐变（作品即界面）
const cover = (h: Hue, hgt: number, url?: string) =>
  `<div class="ic-img" style="height:${hgt}px; background:${
    url
      ? `url(${url}) center/cover no-repeat`
      : mesh(h[0], h[1], h[2])
  }"></div>`;

// nodes: [innerHTML, x, y, w, extraClass?] — 封面槽位依次消费 covers[0..5]
const buildNodes = (
  c: string[],
): Array<[string, number, number, number, string?]> => [
  [
    '<div class="ic-cap"><span class="dot"></span>Image</div>' +
      cover([210, 230, 245], 132, c[0]),
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
      cover([300, 260, 18], 116, c[1]) +
      cover([8, 350, 28], 116, c[2]) +
      cover([110, 78, 150], 116, c[3]) +
      cover([255, 230, 290], 116, c[4]) +
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
    '<div class="ic-cap video"><span class="dot"></span>Video</div>' +
      cover([20, 42, 8], 300, c[5]) +
      // 常驻"生成中"状态：让画布看起来正在工作
      '<div class="ic-gen"><div class="ic-gen-bar"><i></i></div><span class="ic-gen-lb">✦ 生成中 · 84%</span></div>',
    846,
    132,
    226,
    "gen-live",
  ],
];

/* 两个协作光标（Figma 式多人在场感），路径在 1120×600 舞台坐标系内游走 */
const CURSORS_HTML =
  '<div class="ic-cursor a"><svg viewBox="0 0 16 16"><path d="M2 1l12 5.5-5 1.5-2 5z"/></svg><span>夜航</span></div>' +
  '<div class="ic-cursor b"><svg viewBox="0 0 16 16"><path d="M2 1l12 5.5-5 1.5-2 5z"/></svg><span>Mira</span></div>';

// wires between node ports (stage coords): [x1,y1,x2,y2]
const WIRES: Array<[number, number, number, number]> = [
  [236, 232, 348, 240],
  [236, 430, 348, 300],
  [740, 240, 846, 290],
  [732, 512, 846, 340],
];

export default function InfiniteCanvas({ covers = [] }: { covers?: string[] }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const coversKey = covers.join(",");

  // Build the stage DOM (nodes + SVG wires) imperatively — the markup is a
  // fixed-coordinate showcase, identical to home-render.js. Rebuilds when the
  // real-work covers arrive.
  useEffect(() => {
    const stage = stageRef.current;
    const frame = frameRef.current;
    if (!stage || !frame) return;
    const NODES = buildNodes(coversKey ? coversKey.split(",") : []);

    let html =
      '<svg class="ic-wires" viewBox="0 0 1120 600" preserveAspectRatio="none"></svg>';
    NODES.forEach((n, i) => {
      html +=
        '<div class="ic-node' +
        (n[4] ? " " + n[4] : "") +
        '" style="left:' +
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
    html += CURSORS_HTML;
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
        const plen = Math.round(len * 1.3);
        p.style.setProperty("--len", String(plen));
        p.style.setProperty("--wd", (0.5 + i * 0.18).toFixed(2) + "s");
        svg.appendChild(p);
        // 能量脉冲：一段 16px 的亮色短划沿贝塞尔线循环流动
        const pulse = document.createElementNS(NS, "path");
        pulse.setAttribute("d", d);
        pulse.setAttribute("class", "ic-pulse");
        pulse.style.strokeDasharray = `16 ${plen}`;
        pulse.style.setProperty("--plen", String(plen + 16));
        pulse.style.animationDelay = (1.8 + i * 0.7).toFixed(2) + "s";
        svg.appendChild(pulse);
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
  }, [coversKey]);

  return (
    <div className="ic-window reveal">
      {/* 应用窗口镜头：红绿灯 + 标题 + 在线人数，让示意图读作"正在运行的产品" */}
      <div className="ic-titlebar">
        <span className="tdot r" />
        <span className="tdot y" />
        <span className="tdot g" />
        <b>流光 · 无限画布 — 未命名项目</b>
        <span className="ic-online">
          <i className="av a" />
          <i className="av b" />
          <i className="av c" />
          协作中 · 3 人
        </span>
      </div>
      <div className="ic-frame" ref={frameRef}>
        <div className="ic-stage" id="ic-stage" ref={stageRef} />
        {/* 画布假控件（不随舞台缩放）：左下缩放，右下小地图 */}
        <div className="ic-zoom" aria-hidden>
          <span>−</span>
          <b>86%</b>
          <span>+</span>
        </div>
        <div className="ic-mini" aria-hidden>
          <i />
        </div>
      </div>
    </div>
  );
}

/* global React */
// SCARECROWAI — generative aurora canvas. A living "video" backdrop: colored
// plasma blobs drift on Lissajous paths with additive blending, reading as an
// AI canvas mid-generation. Lightweight 2D canvas, pauses when off-screen.
const { useRef: auRef, useEffect: auEffect } = React;

function AuroraBg({ height = 720, intensity = 1 }) {
  const ref = auRef(null);
  auEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // read brand accents off the CSS vars so the bg always matches the theme/style
    const cs = getComputedStyle(document.documentElement);
    const pick = (v, fb) => (cs.getPropertyValue(v).trim() || fb);
    const palette = [
      pick('--accent', '#00d4ff'),
      pick('--accent-2', '#7c5cff'),
      pick('--accent-3', '#00ff94'),
      pick('--accent', '#00d4ff'),
      pick('--accent-2', '#7c5cff'),
    ];

    let W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => {
      const r = cv.getBoundingClientRect();
      W = Math.max(320, r.width); H = Math.max(360, r.height);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);

    // each blob orbits on its own Lissajous path with a slow radius pulse
    const blobs = palette.map((col, i) => ({
      col,
      ax: 0.30 + 0.16 * ((i * 7) % 5) / 5,
      ay: 0.24 + 0.18 * ((i * 11) % 5) / 5,
      fx: 0.07 + i * 0.018,
      fy: 0.05 + i * 0.022,
      px: i * 1.7,
      py: i * 2.3,
      base: (0.42 + 0.12 * (i % 3)),
    }));

    let raf, t = 0, visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !reduce) loop(); }, { threshold: 0.01 });
    io.observe(cv);

    const hexA = (hex, a) => {
      const h = hex.replace('#', '');
      const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
      const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
      return `rgba(${r},${g},${b},${a})`;
    };

    function frame() {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#04060d';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      const R = Math.max(W, H);
      for (const b of blobs) {
        const cx = W * (0.5 + b.ax * Math.sin(t * b.fx + b.px));
        const cy = H * (0.5 + b.ay * Math.sin(t * b.fy + b.py));
        const rad = R * (b.base + 0.06 * Math.sin(t * 0.6 + b.px)) * intensity;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        grad.addColorStop(0, hexA(b.col, 0.24));
        grad.addColorStop(0.45, hexA(b.col, 0.07));
        grad.addColorStop(1, hexA(b.col, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      // subtle vignette to seat the blobs
      ctx.globalCompositeOperation = 'source-over';
      const vg = ctx.createRadialGradient(W / 2, H * 0.4, H * 0.2, W / 2, H * 0.5, R * 0.8);
      vg.addColorStop(0, 'rgba(4,6,13,0)');
      vg.addColorStop(1, 'rgba(4,6,13,0.55)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }

    function loop() {
      if (!visible || reduce) return;
      t += 0.14;
      frame();
      raf = requestAnimationFrame(loop);
    }

    if (reduce) { t = 40; frame(); } else { loop(); }

    const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else if (visible && !reduce) loop(); };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return React.createElement('canvas', {
    ref,
    'aria-hidden': 'true',
    style: {
      position: 'absolute', inset: 0, width: '100%', height: '100%',
      display: 'block', zIndex: 0, pointerEvents: 'none',
    },
  });
}

window.AuroraBg = AuroraBg;

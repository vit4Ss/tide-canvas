/* SCARECROWAI — living-wallpaper hero background.
   A WebGL fragment shader: domain-warped fractal-Brownian-motion noise mapped
   to the brand's cool palette, producing a slow iridescent nebula / aurora flow.
   Mouse parallax, film grain, vignette. Pauses off-screen; honors reduced-motion;
   falls back to a CSS gradient if WebGL is unavailable.

   Usage:  window.initAuroraShader(canvasEl)  ->  returns a teardown function.   */
(function () {
  'use strict';

  const VERT = `
    attribute vec2 a_pos;
    void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
  `;

  const FRAG = `
    precision highp float;
    uniform vec2  u_res;
    uniform float u_time;
    uniform vec2  u_mouse;
    uniform float u_intensity;
    uniform vec3  u_bg;
    uniform vec3  u_c1;
    uniform vec3  u_c2;
    uniform vec3  u_c3;

    // --- Ashima simplex noise 2D -------------------------------------------
    vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
    vec2 mod289(vec2 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
    vec3 permute(vec3 x){ return mod289(((x*34.0)+1.0)*x); }
    float snoise(vec2 v){
      const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                         -0.577350269189626, 0.024390243902439);
      vec2 i  = floor(v + dot(v, C.yy));
      vec2 x0 = v -   i + dot(i, C.xx);
      vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz;
      x12.xy -= i1;
      i = mod289(i);
      vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0))
                              + i.x + vec3(0.0, i1.x, 1.0));
      vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
      m = m*m; m = m*m;
      vec3 x  = 2.0 * fract(p * C.www) - 1.0;
      vec3 h  = abs(x) - 0.5;
      vec3 ox = floor(x + 0.5);
      vec3 a0 = x - ox;
      m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
      vec3 gg;
      gg.x  = a0.x  * x0.x  + h.x  * x0.y;
      gg.yz = a0.yz * x12.xz + h.yz * x12.yw;
      return 130.0 * dot(m, gg);
    }

    float fbm(vec2 p){
      float v = 0.0, a = 0.5;
      mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
      for (int i = 0; i < 6; i++){
        v += a * snoise(p);
        p = rot * p * 2.0;
        a *= 0.5;
      }
      return v;
    }

    void main(){
      vec2 frag = gl_FragCoord.xy;
      vec2 p = (frag - 0.5 * u_res) / u_res.y;
      float t = u_time * 0.05;
      vec2 mo = (u_mouse - 0.5) * 0.35;
      p += mo;
      p *= 1.15;

      // two-stage domain warp -> fluid swirls
      vec2 q = vec2(fbm(p + vec2(0.0, t)),
                    fbm(p + vec2(5.2, -t)));
      vec2 r = vec2(fbm(p + 1.7*q + vec2(1.7, 9.2) + 0.16*t),
                    fbm(p + 1.7*q + vec2(8.3, 2.8) - 0.13*t));
      float f = fbm(p + 2.3*r);

      float m = clamp(f * 0.5 + 0.5, 0.0, 1.0);
      float rl = clamp(length(r), 0.0, 1.0);
      float ql = clamp(q.x * 0.5 + 0.5, 0.0, 1.0);

      // high-contrast DARK neon: keep most of the frame deep & dark, let only
      // the warp's ridges bloom into glowing colored ribbons.
      vec3 col = u_bg;
      col += u_c1 * smoothstep(0.48, 0.96, m) * 0.95 * u_intensity;
      col += u_c3 * pow(rl, 2.4) * 1.05 * u_intensity;
      col += u_c2 * smoothstep(0.56, 1.0, ql) * 0.70 * u_intensity;
      col += u_c3 * smoothstep(0.82, 1.0, m) * 0.55 * u_intensity;     // hot ridge highlights
      col += u_c2 * smoothstep(0.88, 1.0, rl) * 0.50 * u_intensity;

      // soft radial bloom toward the warp's core
      float core = smoothstep(1.05, 0.0, length(p - mo*0.5));
      col += u_c2 * core * 0.10 * u_intensity;

      // vignette — sink the edges into darkness
      float vig = smoothstep(1.5, 0.20, length(p));
      col *= vig * 0.7 + 0.3;
      col *= 0.96;

      // fine film grain — kills banding on dark gradients
      float g = fract(sin(dot(frag, vec2(12.9898, 78.233))) * 43758.5453 + u_time * 0.5);
      col += (g - 0.5) * 0.028;

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `;

  function hexToRGB(hex, fb) {
    if (!hex) hex = fb;
    hex = hex.trim().replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length < 6) hex = fb.replace('#', '');
    const n = parseInt(hex, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('[shader]', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function cssFallback(canvas) {
    canvas.style.background =
      'radial-gradient(120% 120% at 20% 10%, #2a2f6e 0%, transparent 55%),' +
      'radial-gradient(120% 120% at 85% 20%, #3a2c66 0%, transparent 52%),' +
      'radial-gradient(140% 140% at 50% 110%, #163a55 0%, transparent 60%),' +
      'linear-gradient(160deg, #0a0b16 0%, #05060d 100%)';
  }

  window.initAuroraShader = function initAuroraShader(canvas, opts) {
    opts = opts || {};
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, premultipliedAlpha: false, preserveDrawingBuffer: true })
            || canvas.getContext('experimental-webgl', { preserveDrawingBuffer: true });
    if (!gl) { cssFallback(canvas); return function () {}; }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) { cssFallback(canvas); return function () {}; }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { cssFallback(canvas); return function () {}; }
    gl.useProgram(prog);

    // fullscreen triangle
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const U = {
      res: gl.getUniformLocation(prog, 'u_res'),
      time: gl.getUniformLocation(prog, 'u_time'),
      mouse: gl.getUniformLocation(prog, 'u_mouse'),
      intensity: gl.getUniformLocation(prog, 'u_intensity'),
      bg: gl.getUniformLocation(prog, 'u_bg'),
      c1: gl.getUniformLocation(prog, 'u_c1'),
      c2: gl.getUniformLocation(prog, 'u_c2'),
      c3: gl.getUniformLocation(prog, 'u_c3'),
    };

    // pull palette off the live CSS vars so the bg always matches the theme
    function readPalette() {
      const cs = getComputedStyle(document.documentElement);
      const pick = (v, fb) => (cs.getPropertyValue(v).trim() || fb);
      gl.uniform3fv(U.bg, hexToRGB(opts.bg || '#06070f', '#06070f'));
      gl.uniform3fv(U.c1, hexToRGB(pick('--accent', '#6d8bf5'), '#6d8bf5'));
      gl.uniform3fv(U.c2, hexToRGB(pick('--accent-2', '#9b7bf0'), '#9b7bf0'));
      gl.uniform3fv(U.c3, hexToRGB(pick('--accent-3', '#57c9e8'), '#57c9e8'));
    }
    readPalette();
    gl.uniform1f(U.intensity, opts.intensity == null ? 1.0 : opts.intensity);

    // render at a fraction of native res — a soft nebula needs no crispness,
    // and it keeps the shader cheap on big displays.
    const scale = opts.scale || 0.6;
    let W = 0, H = 0;
    function resize() {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(2, Math.round(r.width * dpr * scale));
      H = Math.max(2, Math.round(r.height * dpr * scale));
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W; canvas.height = H;
        gl.viewport(0, 0, W, H);
      }
    }
    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas);

    // smoothed mouse
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let mx = 0.5, my = 0.5, tmx = 0.5, tmy = 0.5;
    function onMove(e) {
      const r = canvas.getBoundingClientRect();
      tmx = (e.clientX - r.left) / r.width;
      tmy = 1.0 - (e.clientY - r.top) / r.height;
    }
    window.addEventListener('pointermove', onMove, { passive: true });

    let raf = 0, t0 = performance.now() - 8000, visible = true, running = false;

    // single source of truth for a draw at wall-clock `now`
    function render(now) {
      const t = (now - t0) / 1000;
      mx += (tmx - mx) * 0.04; my += (tmy - my) * 0.04;
      gl.uniform2f(U.res, W, H);
      gl.uniform1f(U.time, t);
      gl.uniform2f(U.mouse, mx, my);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function frame(now) {
      if (!running) return;
      render(now);
      raf = requestAnimationFrame(frame);
    }
    function start() {
      if (running || reduce) return;
      running = true;
      raf = requestAnimationFrame(frame);
    }
    function stop() { running = false; cancelAnimationFrame(raf); }

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) start(); else stop();
    }, { threshold: 0.01 });
    io.observe(canvas);

    const onVis = () => { if (document.hidden) stop(); else if (visible) start(); };
    document.addEventListener('visibilitychange', onVis);

    // ALWAYS paint one frame synchronously so the buffer is never black —
    // covers throttled-rAF previews, screenshots and reduced-motion.
    mx = tmx; my = tmy;
    render(reduce ? t0 + 14000 : performance.now());
    if (!reduce) start();

    return function teardown() {
      stop();
      ro.disconnect(); io.disconnect();
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVis);
      gl.getExtension('WEBGL_lose_context') && gl.getExtension('WEBGL_lose_context').loseContext();
    };
  };
})();

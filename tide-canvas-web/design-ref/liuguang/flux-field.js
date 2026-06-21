/* ============================================================================
   SCARECROWAI — "流光场" FluxField  (parametric)
   A WebGL fragment-shader backdrop: domain-warped fractal-noise flow.
   One flexible shader, many moods — each section passes a different palette
   (hue), speed, scale, flow direction and form (variant), so every region
   gets its own cool background while staying part of the same family.

   mount(canvas, opts) — opts:
     hue        palette rotation in radians         (default 0)
     speed      flow speed multiplier               (default 1)
     scale      domain frequency multiplier         (default 1)
     intensity  brightness / energy of filaments    (default 1)
     flow       [x,y] constant drift direction      (default [0,0])
     variant    0 liquid · 1 streaks · 2 structured · 3 soft  (default 0)
     mouse      cursor reacts as a light source      (default true)
     res        internal resolution scale           (default 1)
   - DPR-capped, pauses off-screen / on hidden tab, honors reduced-motion.
   - Falls back to a CSS gradient if WebGL is unavailable.
   ========================================================================== */
(function () {
  'use strict';

  const FRAG = `
  precision highp float;
  uniform vec2  uRes;
  uniform float uTime;
  uniform vec2  uMouse;
  uniform float uEnergy;
  uniform float uHue;
  uniform float uSpeed;
  uniform float uScale;
  uniform float uIntensity;
  uniform vec2  uFlow;
  uniform float uVar;

  float hash(vec2 p){
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    float a = hash(i), b = hash(i + vec2(1.,0.));
    float c = hash(i + vec2(0.,1.)), d = hash(i + vec2(1.,1.));
    vec2 u = f*f*(3.-2.*f);
    return mix(a,b,u.x) + (c-a)*u.y*(1.-u.x) + (d-b)*u.x*u.y;
  }
  const mat2 M = mat2(1.62, 1.18, -1.18, 1.62);
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for(int i=0;i<6;i++){ v += a*noise(p); p = M*p; a *= 0.5; }
    return v;
  }

  // cosine palette (iq) tuned to a luminous cyan→violet→magenta band
  vec3 pal(float t){
    vec3 a = vec3(0.48, 0.42, 0.58);
    vec3 b = vec3(0.46, 0.42, 0.50);
    vec3 c = vec3(1.05, 1.10, 1.18);
    vec3 d = vec3(0.50, 0.62, 0.92);
    return a + b * cos(6.28318 * (c*t + d));
  }

  // rotate a color's hue around the luminance axis (Rodrigues)
  vec3 hueShift(vec3 col, float a){
    const vec3 k = vec3(0.57735);
    float c = cos(a);
    return col*c + cross(k, col)*sin(a) + k*dot(k, col)*(1.0-c);
  }

  void main(){
    vec2 uv = (gl_FragCoord.xy - 0.5*uRes) / uRes.y;
    float t = uTime * 0.045 * uSpeed;

    vec2 m = (uMouse - 0.5) * vec2(uRes.x/uRes.y, 1.0);
    float md = length(uv - m);

    // form: 1 = horizontal streaks (stretch x), else neutral
    float stretch = (abs(uVar - 1.0) < 0.5) ? 1.9 : 1.0;

    vec2 p = uv * 1.45 * uScale;
    p.x /= stretch;
    p += uFlow * (uTime * uSpeed * 0.25);        // constant drift
    p += 0.18 * (m - uv) * (1.0 + uEnergy);       // lean toward cursor

    vec2 q = vec2(fbm(p + vec2(0.0, t)),
                  fbm(p + vec2(5.2, 1.3) - t*0.6));
    vec2 r = vec2(fbm(p + 3.4*q + vec2(1.7, 9.2) + t*0.35),
                  fbm(p + 3.4*q + vec2(8.3, 2.8) - t*0.28));
    float f = fbm(p + 3.6*r);

    float fil = length(r);
    // form: >=2 = structured (sharper filaments)
    float sharp = (uVar > 1.5) ? 1.55 : 1.0;
    fil = pow(fil, sharp);

    vec3 col = pal(f + fil*0.55 + t*0.5);
    col = hueShift(col, uHue);

    vec3 voidc = vec3(0.016, 0.022, 0.05);
    // form: 3 = soft (lower contrast)
    float loEdge = (uVar > 2.5) ? 0.05 : 0.16;
    float lum = smoothstep(loEdge, 0.92, f + fil*0.4);
    col = mix(voidc, col, pow(lum, 1.18));

    float core = smoothstep(0.72, 1.0, f + fil*0.45);
    vec3 coreTint = hueShift(vec3(0.5, 0.72, 1.0), uHue);
    col += core * coreTint * (0.7 + 0.6*uEnergy) * uIntensity;

    float halo = exp(-md*md*5.5) * (0.18 + 0.5*uEnergy);
    col += halo * coreTint;

    float vig = smoothstep(1.35, 0.25, length(uv));
    col *= 0.55 + 0.45*vig;
    col *= uIntensity;

    col = col / (col + 0.62);
    col = pow(col, vec3(0.82));

    gl_FragColor = vec4(col, 1.0);
  }`;

  const VERT = `
  attribute vec2 aPos;
  void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

  function compile(gl, type, src){
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('FluxField shader error:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  function mount(canvas, opts){
    opts = opts || {};
    const O = {
      hue: opts.hue || 0, speed: opts.speed == null ? 1 : opts.speed,
      scale: opts.scale == null ? 1 : opts.scale,
      intensity: opts.intensity == null ? 1 : opts.intensity,
      flow: opts.flow || [0, 0], variant: opts.variant || 0,
      mouse: opts.mouse !== false, res: opts.res || 1,
    };
    const reduce = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false,
      premultipliedAlpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!gl) { canvas.classList.add('flux-fallback'); return; }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) { canvas.classList.add('flux-fallback'); return; }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      canvas.classList.add('flux-fallback'); return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const U = (n) => gl.getUniformLocation(prog, n);
    const uRes = U('uRes'), uTime = U('uTime'), uMouse = U('uMouse'), uEnergy = U('uEnergy');
    const uHue = U('uHue'), uSpeed = U('uSpeed'), uScale = U('uScale'),
          uIntensity = U('uIntensity'), uFlow = U('uFlow'), uVar = U('uVar');
    // variant is a discrete shader branch — set once (morphing it would pop)
    gl.uniform1f(uVar, O.variant);

    // continuously-lerped "mood" — color/density/flow morph smoothly as the
    // page scrolls, so the whole field reads as ONE evolving background.
    const cur = { hue: O.hue, speed: O.speed, scale: O.scale, intensity: O.intensity, fx: O.flow[0], fy: O.flow[1] };
    const tgt = { hue: O.hue, speed: O.speed, scale: O.scale, intensity: O.intensity, fx: O.flow[0], fy: O.flow[1] };
    const TWO_PI = Math.PI * 2;
    function lerpAngle(a, b, t){
      let d = ((b - a) % TWO_PI + TWO_PI * 1.5) % TWO_PI - Math.PI; // shortest path
      return a + d * t;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 1.6) * O.res;
    let W = 0, H = 0;
    function resize(){
      const r = canvas.getBoundingClientRect();
      W = Math.max(2, Math.round(r.width * dpr));
      H = Math.max(2, Math.round(r.height * dpr));
      canvas.width = W; canvas.height = H;
      gl.viewport(0, 0, W, H);
    }
    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas);

    let mtgt = [0.5, 0.55], cur2 = [0.5, 0.55], energy = 0, tgtE = 0;
    if (O.mouse) {
      const onMove = (e) => {
        const r = canvas.getBoundingClientRect();
        const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
        const y = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
        mtgt = [x / r.width, 1 - y / r.height]; tgtE = 1;
      };
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerdown', () => { tgtE = 1; }, { passive: true });
    }

    let raf, t0 = performance.now(), visible = true;
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !reduce) start();
    }, { threshold: 0.01 });
    io.observe(canvas);

    function render(now){
      const time = (now - t0) / 1000;
      cur2[0] += (mtgt[0] - cur2[0]) * 0.06;
      cur2[1] += (mtgt[1] - cur2[1]) * 0.06;
      tgtE *= 0.96; energy += (tgtE - energy) * 0.05;
      // ease mood toward target (color/flow/density morph continuously)
      cur.hue = lerpAngle(cur.hue, tgt.hue, 0.035);
      cur.speed += (tgt.speed - cur.speed) * 0.03;
      cur.scale += (tgt.scale - cur.scale) * 0.03;
      cur.intensity += (tgt.intensity - cur.intensity) * 0.03;
      cur.fx += (tgt.fx - cur.fx) * 0.03;
      cur.fy += (tgt.fy - cur.fy) * 0.03;
      gl.uniform1f(uHue, cur.hue);
      gl.uniform1f(uSpeed, cur.speed);
      gl.uniform1f(uScale, cur.scale);
      gl.uniform1f(uIntensity, cur.intensity);
      gl.uniform2f(uFlow, cur.fx, cur.fy);
      gl.uniform2f(uRes, W, H);
      gl.uniform1f(uTime, time);
      gl.uniform2f(uMouse, cur2[0], cur2[1]);
      gl.uniform1f(uEnergy, energy);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (visible && !reduce) raf = requestAnimationFrame(render);
    }
    function start(){ cancelAnimationFrame(raf); raf = requestAnimationFrame(render); }

    render(t0 + (reduce ? 8000 : 1200));
    if (!reduce) start();

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else if (visible && !reduce) start();
    });

    return {
      // set new mood targets; the render loop eases toward them
      setMood(m){
        if (m.hue != null) tgt.hue = m.hue;
        if (m.speed != null) tgt.speed = m.speed;
        if (m.scale != null) tgt.scale = m.scale;
        if (m.intensity != null) tgt.intensity = m.intensity;
        if (m.flow){ tgt.fx = m.flow[0]; tgt.fy = m.flow[1]; }
      },
      canvas,
    };
  }

  window.FluxField = { mount };
})();

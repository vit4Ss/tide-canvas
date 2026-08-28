// 封面生成（走部署的测试后端）+ 回写生产/测试 skill 封面
const PROD_TOKEN = process.env.PROD_TOKEN;
const TEST_TOKEN = process.env.TEST_TOKEN;
const LOCAL = "http://localhost:8080";
const TEST = "https://test-flowlight.tcmzhan.com";

const PROD_IDS = {
  "全能动作导演 Pro · 番剧高燃（单图版）": "2084583544360800256",
  "打戏分镜导演（多图版 · 16格）": "2084583567932788736",
  "文戏情绪导演（30S · 多角色分镜）": "2084583579953664000",
};
const COVERS = {
  "全能动作导演 Pro · 番剧高燃（单图版）": "Anime sakuga action scene: Japanese TV anime style fight moment, a warrior dashing with motion blur and speed lines, energy aura bursting with glowing particles, dramatic low-angle composition, cel-shaded, vibrant, cinematic, no text, no watermark",
  "打戏分镜导演（多图版 · 16格）": "Black and white manga storyboard: 4x4 grid of 16 ink-sketch panels showing an action fight sequence, dynamic camera angles, speed lines, cinematic panel composition, monochrome ink style, no text, no watermark",
  "文戏情绪导演（30S · 多角色分镜）": "Cinematic emotional drama film still: two characters facing each other in soft rim light, subtle intense expressions, shallow depth of field, warm muted tones, atmospheric, photorealistic, no text, no watermark",
};

const api = async (base, token, method, url, body) => {
  const res = await fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json().catch(() => null);
};

const poll = async (id) => {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const r = await api(TEST, TEST_TOKEN, "GET", `/api/ai/tasks/${id}`);
    const t = r?.data;
    if (t?.status === 1) return t;
    if (t?.status === 2 || t?.status === 3) throw new Error(`task ${id} failed: ${t.errorMsg}`);
    process.stdout.write(".");
  }
  throw new Error(`task ${id} timeout`);
};

(async () => {
  const titles = Object.keys(PROD_IDS);
  // 测试环境技能 id 映射
  const tl = await api(TEST, TEST_TOKEN, "GET", "/api/admin/skills?pageSize=20");
  const testByTitle = Object.fromEntries((tl?.data?.records || []).map((r) => [r.title, r.id]));

  for (const title of titles) {
    const g = await api(TEST, TEST_TOKEN, "POST", "/api/ai/generate", {
      handler: "text_to_image",
      modelId: "gpt-image-2",
      input: { prompt: COVERS[title], aspectRatio: "16:9" },
    });
    if (!g?.success) { console.log(`GEN FAIL [${title}]`, JSON.stringify(g).slice(0, 200)); continue; }
    process.stdout.write(`gen [${title}] task ${g.data.id} `);
    const t = await poll(g.data.id);
    const url = t.resultUrl || t.resultMeta?.url;
    console.log(`\n  -> ${url}`);
    if (!url) continue;

    const prodId = PROD_IDS[title];
    const cur = await api(LOCAL, PROD_TOKEN, "GET", `/api/admin/skills/${prodId}`);
    const up1 = await api(LOCAL, PROD_TOKEN, "PUT", `/api/admin/skills/${prodId}`, { ...cur.data, coverUrl: url });
    console.log("  prod cover:", up1?.success ? "ok" : JSON.stringify(up1).slice(0, 150));

    const testId = testByTitle[title];
    if (testId) {
      const cur2 = await api(TEST, TEST_TOKEN, "GET", `/api/admin/skills/${testId}`);
      const up2 = await api(TEST, TEST_TOKEN, "PUT", `/api/admin/skills/${testId}`, { ...cur2.data, coverUrl: url });
      console.log("  test cover:", up2?.success ? "ok" : JSON.stringify(up2).slice(0, 150));
    }
  }
  console.log("DONE");
})().catch((e) => { console.error("\nFATAL", e); process.exit(1); });

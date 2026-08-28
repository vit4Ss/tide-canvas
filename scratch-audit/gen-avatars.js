// 生成 6 张预置默认头像（走测试后端文生图，1:1，扁平可爱动物系列）
const TEST_TOKEN = process.env.TEST_TOKEN;
const TEST = "https://test-flowlight.tcmzhan.com";
const OUT = __dirname + "/avatars";

const AVATARS = [
  ["cat", "soft peach", "a cute chubby cat face"],
  ["dog", "soft mint green", "a cute happy dog face"],
  ["rabbit", "soft lavender", "a cute round rabbit face"],
  ["panda", "soft sky blue", "a cute panda face"],
  ["fox", "soft warm yellow", "a cute little fox face"],
  ["penguin", "soft pink", "a cute round penguin face"],
];

const api = async (method, url, body) => {
  const res = await fetch(TEST + url, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TEST_TOKEN}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json().catch(() => null);
};

const poll = async (id) => {
  for (let i = 0; i < 75; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const r = await api("GET", `/api/ai/tasks/${id}`);
    const t = r?.data;
    if (t?.status === 1) return t;
    if (t?.status === 2 || t?.status === 3) throw new Error(`task failed: ${t.errorMsg}`);
  }
  throw new Error("timeout");
};

(async () => {
  const fs = require("fs");
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, bg, subject] of AVATARS) {
    if (fs.existsSync(`${OUT}/${name}.png`) && fs.statSync(`${OUT}/${name}.png`).size > 10000) {
      console.log(`${name} 已有，跳过`);
      continue;
    }
    const prompt = `Flat vector illustration avatar: ${subject}, centered head-only composition on a ${bg} solid background, kawaii minimal style, thick clean rounded shapes, soft even lighting, friendly expression, high quality, no text, no watermark, no border`;
    let done = false;
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      try {
        const g = await api("POST", "/api/ai/generate", {
          handler: "text_to_image",
          modelId: "gpt-image-2",
          input: { prompt, aspectRatio: "1:1" },
        });
        if (!g?.success) { console.log(`GEN FAIL ${name}:`, JSON.stringify(g).slice(0, 160)); break; }
        process.stdout.write(`${name} `);
        const t = await poll(g.data.id);
        const url = t.resultUrl || t.resultMeta?.url;
        for (let dl = 0; dl < 4 && !done; dl++) {
          try {
            const img = await fetch(url);
            fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(await img.arrayBuffer()));
            done = true;
            console.log(`ok (${url})`);
          } catch {
            await new Promise((r) => setTimeout(r, 3000));
          }
        }
      } catch (e) {
        console.log(`retry ${name}:`, String(e).slice(0, 80));
      }
    }
    if (!done) console.log(`${name} 最终失败`);
  }
  console.log("ALL DONE");
})().catch((e) => { console.error("FATAL", e); process.exit(1); });

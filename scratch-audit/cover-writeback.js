// 仅回写封面（列表记录为 DTO 基底）
const PROD_TOKEN = process.env.PROD_TOKEN;
const TEST_TOKEN = process.env.TEST_TOKEN;
const LOCAL = "http://localhost:8080";
const TEST = "https://test-flowlight.tcmzhan.com";

const COVER_URLS = {
  "全能动作导演 Pro · 番剧高燃（单图版）": "https://test-cdn.mbfczzzz.top/uploads/usr_79jaq6g/up_77cy3fm_task_5lms3d2.png",
  "打戏分镜导演（多图版 · 16格）": "https://test-cdn.mbfczzzz.top/canvas/uploads/gen/f528f4a34826ad02fcdfd68895abf74cee6b94a9.png",
  "文戏情绪导演（30S · 多角色分镜）": "https://test-cdn.mbfczzzz.top/canvas/uploads/gen/d62af09ef8a76c73adc3ea4217b1afb217590a0b.png",
};

const api = async (base, token, method, url, body) => {
  const res = await fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json().catch(() => null);
};

(async () => {
  for (const [base, token, name] of [[LOCAL, PROD_TOKEN, "prod"], [TEST, TEST_TOKEN, "test"]]) {
    const list = await api(base, token, "GET", "/api/admin/skills?pageSize=30");
    const rows = list?.data?.records || [];
    for (const [title, coverUrl] of Object.entries(COVER_URLS)) {
      const row = rows.find((r) => r.title === title);
      if (!row) { console.log(`[${name}] NOT FOUND: ${title}`); continue; }
      const up = await api(base, token, "PUT", `/api/admin/skills/${row.id}`, { ...row, coverUrl });
      console.log(`[${name}] ${title}:`, up?.success ? "ok" : JSON.stringify(up).slice(0, 200));
    }
  }
  console.log("DONE");
})();

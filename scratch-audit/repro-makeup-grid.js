const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("console", (m) => console.log("[console]", m.text()));
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto("file:///" + __dirname.replace(/\\/g, "/") + "/repro-makeup-grid.html");
  await page.waitForTimeout(4000);
  const info = await page.evaluate(() => {
    const grid = document.getElementById("grid");
    const tiles = [...grid.querySelectorAll("button")];
    const cs = getComputedStyle(grid);
    return {
      gridTemplateRows: cs.gridTemplateRows,
      gridTemplateColumns: cs.gridTemplateColumns,
      gridClientHeight: grid.clientHeight,
      tileRects: tiles.slice(0, 7).map((t) => {
        const r = t.getBoundingClientRect();
        const tcs = getComputedStyle(t);
        return { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width), aspectRatio: tcs.aspectRatio };
      }),
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await page.screenshot({ path: __dirname + "/shots/repro-grid.png" });
  await browser.close();
})();

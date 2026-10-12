import assert from "node:assert/strict";
import path from "node:path";

const focusedOption = (page, label) => page.waitForFunction((label) =>
  document.activeElement?.getAttribute("role") === "option" &&
  document.activeElement.textContent.trim() === label, label);

export async function chooseSelect(page, label, option) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

export async function checkSelects({ page, browser, context, mockApi, base, artifacts, models }) {
  const mode = page.getByRole("combobox", { name: "Creation mode", exact: true });
  await mode.click();
  const popup = page.getByRole("listbox");
  await popup.waitFor();
  assert.equal(await popup.evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(25, 28, 26)");
  await page.screenshot({ path: path.join(artifacts, "select-mode-desktop.png") });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  assert.equal((await mode.innerText()).trim(), "Text to image", "Escape must not commit an explored option");
  assert.equal(await mode.evaluate((element) => document.activeElement === element), true, "Focus returns to the trigger");
  await mode.press("Space");
  await focusedOption(page, "Text to image");
  await page.keyboard.press("ArrowDown");
  await focusedOption(page, "Image to image");
  await page.keyboard.press("Enter");
  assert.equal((await mode.innerText()).trim(), "Image to image");
  await mode.press("t");
  assert.equal((await mode.innerText()).trim(), "Text to image", "Closed control supports typeahead");
  await mode.click();
  await page.mouse.click(1000, 150);
  await popup.waitFor({ state: "hidden" });

  const catalogRoute = "**/api/market/studio-models*";
  const longName = "A detailed image model for cinematic architecture, natural materials and precise lighting";
  const imageModel = models.find((model) => model.type === "image");
  const catalog = [imageModel, ...Array.from({ length: 28 }, (_, index) => ({
    ...imageModel, id: `extra-${index}`, modelKey: `extra-${index}`, name: index === 27 ? longName : `Image model ${index + 2}`,
  }))];
  await page.route(catalogRoute, async (route) => {
    if (new URL(route.request().url()).searchParams.get("type") !== "image") return route.fallback();
    await route.fulfill({ json: { success: true, code: 200, data: catalog } });
  });
  await page.goto(`${base}/studio`, { waitUntil: "networkidle" });
  const model = page.getByRole("combobox", { name: "Model", exact: true });
  await model.click();
  await focusedOption(page, "Image model");
  await page.keyboard.press("End");
  await focusedOption(page, longName);
  await page.screenshot({ path: path.join(artifacts, "select-models-desktop.png") });
  assert.equal(await popup.evaluate((element) => element.getBoundingClientRect().height <= 361), true, "Long catalog is bounded");
  await page.keyboard.press("Enter");
  assert.equal((await model.innerText()).trim(), longName);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "Long selected model must not widen the composer");
  await model.click();
  await focusedOption(page, longName);
  await page.keyboard.press("Home");
  await focusedOption(page, "Image model");
  await page.keyboard.press("Enter");
  assert.equal((await model.innerText()).trim(), "Image model");
  await page.unroute(catalogRoute);

  await page.route(catalogRoute, (route) => route.fulfill({ json: { success: true, code: 200, data: [] } }));
  await page.goto(`${base}/studio`, { waitUntil: "networkidle" });
  assert.equal(await model.isDisabled(), true, "Empty model lists disable the control");
  assert.equal((await model.innerText()).trim(), "Choose a model");
  await page.unroute(catalogRoute);

  await page.goto(`${base}/history`, { waitUntil: "networkidle" });
  await chooseSelect(page, "Filter activity by format", "Video");
  const resetFormat = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === "/api/ai/history" && url.searchParams.get("mediaType") === "image";
  });
  await chooseSelect(page, "Filter activity by format", "All formats");
  await resetFormat;
  await chooseSelect(page, "Filter activity by status", "Failed");
  const resetOutcome = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === "/api/ai/history" && !url.searchParams.has("success");
  });
  await chooseSelect(page, "Filter activity by status", "All outcomes");
  await resetOutcome;

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
    storageState: await context.storageState(),
  });
  await mobileContext.route("**/api/**", mockApi);
  const mobile = await mobileContext.newPage();
  const mobileErrors = [];
  mobile.on("pageerror", (error) => mobileErrors.push(error.message));
  try {
    await mobile.goto(`${base}/studio`, { waitUntil: "networkidle" });
    await mobile.getByRole("combobox", { name: "Creation mode", exact: true }).tap();
    const mobilePopup = mobile.getByRole("listbox");
    await mobilePopup.waitFor();
    assert.equal(await mobilePopup.evaluate((element) => getComputedStyle(element).animationName), "none");
    const touchOption = mobile.getByRole("option", { name: "Image to image", exact: true });
    assert.equal(await touchOption.evaluate((element) => element.getBoundingClientRect().height >= 44), true);
    await mobile.screenshot({ path: path.join(artifacts, "select-mode-mobile.png") });
    await touchOption.tap();
    assert.equal((await mobile.getByRole("combobox", { name: "Creation mode", exact: true }).innerText()).trim(), "Image to image");

    await mobile.goto(`${base}/studio?type=upscale`, { waitUntil: "networkidle" });
    const fps = mobile.getByRole("combobox", { name: "Output frame rate", exact: true });
    await fps.scrollIntoViewIfNeeded();
    await fps.evaluate((element) => window.scrollBy({ top: element.getBoundingClientRect().bottom - (innerHeight - 16), behavior: "instant" }));
    await fps.tap();
    await mobilePopup.waitFor();
    await mobile.waitForFunction(() => {
      const bounds = document.querySelector('[role="listbox"]')?.getBoundingClientRect();
      return bounds && bounds.x >= 11 && bounds.right <= innerWidth - 11 && bounds.y >= 11 && bounds.bottom <= innerHeight - 11;
    });
    const bounds = await mobilePopup.boundingBox();
    assert.ok(bounds.x >= 11 && bounds.x + bounds.width <= 379 && bounds.y >= 11 && bounds.y + bounds.height <= 833, "Menu stays inside the phone viewport");
    assert.equal(await mobilePopup.getAttribute("data-side"), "top", "Bottom-edge menus open upwards");
    await mobile.screenshot({ path: path.join(artifacts, "select-frame-rate-mobile.png") });
    await mobile.getByRole("option", { name: "2x interpolation", exact: true }).tap();
    await fps.tap();
    await mobile.getByRole("option", { name: "Model default", exact: true }).tap();
    assert.equal((await fps.innerText()).trim(), "Model default", "Empty-string options remain selectable");
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(mobileErrors, []);
  } finally {
    await mobileContext.close();
  }
  await page.goto(`${base}/studio`, { waitUntil: "networkidle" });
}

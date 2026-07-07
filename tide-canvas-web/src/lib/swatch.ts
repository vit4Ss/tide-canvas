/* ============================================================================
   灰阶 swatch 公式 — imini 主题「零彩色」的哈希渐变，唯一定义处。
   站点导航/账户页/后台头像、跑马灯与模型选择器的字母兜底全部从这里取，
   避免同一公式散落多份手抄后漂移。
   ========================================================================== */

/** 哈希种子 → 确定性灰阶渐变（哈希只驱动明度差异）。
 *  dark（默认）：深灰系配白字（头像、跑马灯兜底）；
 *  light：浅灰系配深字（chat / 创作台模型 swatch 兜底）。 */
export function grayscaleSwatch(seed: string, tone: "dark" | "light" = "dark"): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return tone === "light"
    ? `linear-gradient(135deg, hsl(0 0% ${82 + (h % 12)}%), hsl(0 0% ${64 + (h % 12)}%))`
    : `linear-gradient(135deg, hsl(0 0% ${30 + (h % 16)}%), hsl(0 0% ${14 + (h % 10)}%))`;
}

/** 哈希种子 → 柔和彩色渐变（后台浅色工作台的头像/实体色块）。
 *  界面骨架保持克制，但身份类色块用颜色承载识别——Linear/Notion 的头像路数：
 *  高明度低饱和的粉彩系，白卡上醒目但不刺眼。imini 前台（零彩色铁律）勿用。 */
export function hueSwatch(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h} 72% 86%), hsl(${(h + 26) % 360} 62% 72%))`;
}

// 中文注释：画布图片节点在 100% 缩放下的展示尺寸表，和前端比例选择器保持一致。
export interface ImageCardSize {
  w: number;
  h: number;
}

const IMAGE_CARD_SHORT_SIDE = 348;
const IMAGE_CARD_MAX_LONG_SIDE = 815;

export const IMAGE_CARD_SIZE_BY_RATIO: Record<string, ImageCardSize> = {
  auto: { w: 348, h: 348 },
  "1:1": { w: 348, h: 348 },
  "1:2": { w: 348, h: 698 },
  "2:1": { w: 698, h: 348 },
  "9:16": { w: 348, h: 620 },
  "16:9": { w: 620, h: 348 },
  "3:4": { w: 348, h: 465 },
  "4:3": { w: 465, h: 348 },
  "3:2": { w: 523, h: 348 },
  "2:3": { w: 348, h: 523 },
  "5:4": { w: 436, h: 348 },
  "4:5": { w: 348, h: 436 },
  "21:9": { w: 815, h: 348 },
  "9:21": { w: 348, h: 815 },
};

// 中文注释：非预设比例按短边 348px 计算，并限制超长边，避免极端图片撑爆画布。
export function getImageCardSizeForAspect(aspect: number): ImageCardSize {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  if (safeAspect >= 1) {
    const width = Math.min(IMAGE_CARD_MAX_LONG_SIDE, Math.round(IMAGE_CARD_SHORT_SIDE * safeAspect));
    return { w: width, h: Math.round(width / safeAspect) };
  }

  const height = Math.min(IMAGE_CARD_MAX_LONG_SIDE, Math.round(IMAGE_CARD_SHORT_SIDE / safeAspect));
  return { w: Math.round(height * safeAspect), h: height };
}

export function getImageCardSizeForRatio(ratio?: string | null, fallbackAspect = 1): ImageCardSize {
  if (ratio && IMAGE_CARD_SIZE_BY_RATIO[ratio]) {
    return IMAGE_CARD_SIZE_BY_RATIO[ratio];
  }
  return getImageCardSizeForAspect(fallbackAspect);
}
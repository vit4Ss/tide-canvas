import type { ReactNode } from "react";

// 中文注释：集中定义画布和首页共用的图像参数类型，避免不同入口各自维护一套结构。
export type ImageQuality = "low" | "standard" | "high";
export type ImageClarity = "1K" | "2K" | "4K";

export interface QualityRatioValue {
  quality: ImageQuality;
  clarity: string;
  ratio: string;
}

export interface QualityOption {
  value: ImageQuality;
  label: string;
}

export interface RatioOption {
  value: string;
  label: string;
  w: number;
  h: number;
}

export interface ParamSectionProps {
  title: string;
  children: ReactNode;
}

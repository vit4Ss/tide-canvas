import type { PageQuery } from "./api";

// 风格库列表来源：风格广场、收藏、最近使用、我的风格。
export type StylePresetSource = "gallery" | "favorite" | "recent" | "mine";

// 风格预设查询条件，和后端 internal/module/style/dto.go 对齐。
export interface StylePresetQuery extends PageQuery {
  source?: StylePresetSource;
  keyword?: string;
  category?: string;
  modelId?: string;
  status?: number;
  commercialOnly?: boolean;
}

// 风格预设展示结构，用户端选择器和后台维护页共用。
export interface StylePresetVO {
  id: string;
  name: string;
  shortName: string;
  description: string;
  prompt: string;
  coverUrl: string;
  category: string;
  authorName: string;
  modelType: string;
  modelId: string;
  modelIds: string[];
  modelPrompts: Record<string, string>;
  tags: string[];
  commercial: number;
  publicFlag: number;
  official: number;
  status: number;
  sortOrder: number;
  usageCount: number;
  favorited: boolean;
  ownerType: "system" | "user";
  createTime: string;
  updateTime: string;
}

// 新建/编辑风格预设提交体。
export interface StylePresetSaveDTO {
  name: string;
  shortName?: string;
  description?: string;
  prompt: string;
  coverUrl?: string;
  category?: string;
  authorName?: string;
  modelType?: string;
  modelId?: string;
  modelIds?: string[];
  modelPrompts?: Record<string, string>;
  tags?: string[];
  commercial?: number;
  publicFlag?: number;
  official?: number;
  status?: number;
  sortOrder?: number;
}

// 收藏切换接口返回体。
export interface StyleFavoriteToggleVO {
  favorited: boolean;
}
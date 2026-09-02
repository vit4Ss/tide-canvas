import type { ModelBadge, ModelConfig } from "@/types/admin-models";

export const MODEL_MAINTENANCE_MESSAGE = "该渠道维护中，暂不可用";

export function modelUnderMaintenance(config: { availabilityStatus?: unknown } | null | undefined): boolean {
  return config?.availabilityStatus === "maintenance";
}

/** 在管理员自定义标签前补运行状态；避免手工标签重复显示“异常/维护中”。 */
export function modelDisplayBadges(config: ModelConfig | null | undefined): ModelBadge[] {
  const badges = (config?.badges ?? []).filter((badge) => {
    const text = badge.text?.trim();
    return text !== "异常" && text !== "维护中";
  });
  return modelUnderMaintenance(config)
    ? [{ text: "异常", tone: "hot" }, ...badges]
    : badges;
}

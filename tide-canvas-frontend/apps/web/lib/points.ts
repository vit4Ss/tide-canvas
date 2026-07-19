import type { UserVO } from "@/types/user";

/**
 * 按团队加价系数换算实际消耗积分（前端展示用；后端权威重算）。
 * 单价支持小数（Runware 等供应商的小数积分定价），与后端结算一致按向上取整展示；
 * 不在团队时系数为 1。
 */
export function applyTeamFactor(base: number, user?: UserVO | null): number {
  const factor = user?.inTeam && Number(user.teamPriceFactor ?? 1) > 1 ? Number(user.teamPriceFactor ?? 1) : 1;
  return Math.ceil(base * factor);
}

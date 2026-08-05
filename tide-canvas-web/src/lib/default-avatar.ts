// default-avatar — 系统预置的默认头像（public/avatars/，AI 生成的可爱动物系列）。
// 无头像用户按 id 稳定映射到其中一张：同一个用户永远同一只，不同用户散列分布。

const PRESET_AVATARS = ["cat", "dog", "rabbit", "panda", "fox", "penguin"] as const;

export function defaultAvatar(seed: string | number): string {
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return `/avatars/${PRESET_AVATARS[h % PRESET_AVATARS.length]}.png`;
}

/** 后台一键生成/用户名注册的用户没有真实邮箱——后端按 id 生成
 *  `u<id>@noemail.internal` 占位（列非空且唯一）。此类邮箱不应作为信息展示。 */
export function isPlaceholderEmail(email?: string | null): boolean {
  return !!email && email.endsWith("@noemail.internal");
}

export interface UserVO {
  id: string;
  username: string;
  email: string;
  phone: string;
  nickname: string;
  avatar: string;
  role: UserRole;
  vipLevel?: number;
  /** 免 AI 并发限制(0否1是) */
  concurrencyUnlimited?: number;
  roleId?: string; // 管理角色雪花主键，字符串传输避免 JS 精度丢失
  status: UserStatus;
  apiQuota: number;
  points: number;
  isAuthor: number;
  storageQuota: number;
  /** 所属团队ID；null 表示未加入团队 */
  teamId?: number | null;
  /** 是否在团队中（团队价/共享标识据此显示） */
  inTeam?: boolean;
  /** 团队模式 AI 消耗加价系数（不在团队为 1） */
  teamPriceFactor?: number;
  createTime: string;
  lastLoginTime: string;
}

export interface UserSimpleVO {
  id: string;
  username: string;
  nickname: string;
  avatar: string;
}

export interface LoginVO {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  userInfo: UserVO;
}

export interface UserRegisterDTO {
  username?: string;
  email: string;
  code: string;
  password: string;
  nickname?: string;
  phone?: string;
}

export interface UserLoginDTO {
  account: string;
  password: string;
  rememberMe?: boolean;
}

export interface UpdatePasswordDTO {
  oldPassword: string;
  newPassword: string;
}

export interface UpdateProfileDTO {
  nickname?: string;
  phone?: string;
}

export interface PasswordResetRequestDTO {
  email: string;
}

export interface PasswordResetConfirmDTO {
  token: string;
  newPassword: string;
}

export enum UserRole {
  USER = 0,
  VIP = 1,
  ADMIN = 9,
}

export enum UserStatus {
  DISABLED = 0,
  ACTIVE = 1,
}

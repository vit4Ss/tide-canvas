export interface UserVO {
  id: string; // 后端雪花 ID 序列化为字符串
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
  /** 角色授予的前台侧栏菜单键（discover/studio/analysis/three_d/tools/chat/canvas/explore/inspire/assets），
      studio-rail 据此过滤展示；缺失（旧会话缓存）时侧栏回退全量 */
  menus?: string[];
  /** 角色解析后的后台模块权限键（admin.users 等；role=9 为全量）。
      AdminGuard/后台侧栏据此放行与过滤；实际接口门禁在服务端 */
  adminPerms?: string[];
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

/** 用户名+密码本地注册（免邮箱，注册即登录）；规范由服务端权威校验 */
export interface RegisterLocalDTO {
  username: string;
  password: string;
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

export interface ResetPasswordDTO {
  email: string;
  code: string;
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

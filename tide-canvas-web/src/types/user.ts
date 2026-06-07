export interface UserVO {
  id: number;
  username: string;
  email: string;
  phone: string;
  nickname: string;
  avatar: string;
  role: UserRole;
  status: UserStatus;
  apiQuota: number;
  points: number;
  isAuthor: number;
  storageQuota: number;
  createTime: string;
  lastLoginTime: string;
}

export interface UserSimpleVO {
  id: number;
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

export enum UserRole {
  USER = 0,
  VIP = 1,
  ADMIN = 9,
}

export enum UserStatus {
  DISABLED = 0,
  ACTIVE = 1,
}

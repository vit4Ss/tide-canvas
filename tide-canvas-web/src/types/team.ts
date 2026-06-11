export interface TeamMemberVO {
  userId: number;
  username: string;
  nickname: string;
  avatar?: string;
  /** 团队内角色：0 成员，1 管理员 */
  role: number;
  isOwner: boolean;
  joinTime?: string;
}

export interface TeamVO {
  id: number;
  name: string;
  inviteCode: string;
  ownerId: number;
  memberCount: number;
  /** 团队模式 AI 消耗加价系数（>1） */
  priceFactor: number;
  /** 当前用户是否为该团队管理员 */
  iAmOwner: boolean;
  members: TeamMemberVO[];
  createTime: string;
}

export interface TeamCreateDTO {
  name: string;
}

export interface TeamJoinDTO {
  inviteCode: string;
}

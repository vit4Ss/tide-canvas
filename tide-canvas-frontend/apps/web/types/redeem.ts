import type { PageQuery } from "./api";

export interface RedeemCodeVO {
  id: string; // 后端雪花主键，字符串传输避免 JS number 精度丢失
  code: string;
  points: number;
  /** 生成者（管理员）用户ID */
  createdBy?: string;
  /** 0未使用 / 1已使用 / 2已停用 */
  status: number;
  usedBy?: string;
  usedTime?: string;
  expireTime?: string;
  batchNo?: string;
  remark?: string;
  createTime: string;
}

export interface RedeemCodeQuery extends PageQuery {
  code?: string;
  status?: number;
  batchNo?: string;
}

export interface RedeemResultVO {
  points: number;
  balance: number;
}

export interface GenerateRedeemDTO {
  count: number;
  points: number;
  expireTime?: string;
  remark?: string;
}

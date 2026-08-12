import type { AdminOrderUser } from "./admin-payments";

export type ActivationCodeState = "available" | "disabled" | "expired" | "exhausted";

export interface AdminActivationCode {
  id: string;
  codeHint: string;
  batchName: string;
  points: number;
  usageLimit: number;
  usedCount: number;
  enabled: boolean;
  state: ActivationCodeState;
  expiresAt: string;
  lastUsedAt: string;
  createdBy: string;
  createTime: string;
}

export interface AdminActivationCodeQuery {
  pageNum?: number;
  pageSize?: number;
  keyword?: string;
  state?: ActivationCodeState;
}

export interface AdminActivationCodeGenerateDTO {
  batchName?: string;
  quantity: number;
  usageLimit: number;
  points: number;
  expiresAt: string;
}

export interface AdminActivationCodeGenerateResult {
  batchName: string;
  quantity: number;
  /** Plaintext secrets, returned only by the generate request. */
  codes: string[];
}

export interface AdminActivationCodeSummary {
  totalCodes: number;
  available: number;
  claims: number;
  pointsIssued: number;
}

export interface AdminActivationCodeClaim {
  id: string;
  activationCodeId: string;
  codeHint: string;
  batchName: string;
  userId: string;
  user: AdminOrderUser;
  points: number;
  balance: number;
  clientIp: string;
  createTime: string;
}

export interface AdminActivationCodeClaimQuery {
  pageNum?: number;
  pageSize?: number;
  keyword?: string;
  activationCodeId?: string;
}

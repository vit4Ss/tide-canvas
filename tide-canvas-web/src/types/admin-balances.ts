export type SupplierBalanceState =
  | "healthy"
  | "low"
  | "error"
  | "unconfigured"
  | "disabled";

export interface SupplierBalanceDetailVO {
  label: string;
  value: number;
  currency: string;
}

/** One server-side supplier check. Credentials and full endpoints are never exposed. */
export interface SupplierBalanceVO {
  key: string;
  name: string;
  source: string;
  state: SupplierBalanceState;
  balance: number | null;
  currency: string;
  lowBalance: number | null;
  details: SupplierBalanceDetailVO[];
  checkedAt: string;
  lastSuccessAt: string;
  latencyMs: number;
  stale: boolean;
  message: string;
}

export interface SupplierBalancesVO {
  suppliers: SupplierBalanceVO[];
  refreshedAt: string;
  refreshSeconds: number;
}

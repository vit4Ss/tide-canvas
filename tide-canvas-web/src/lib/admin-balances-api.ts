import { http } from "@/lib/http";
import type { SupplierBalancesVO } from "@/types/admin-balances";

export const adminBalancesApi = {
  /** GET /api/admin/supplier-balances — concurrent server-side supplier checks. */
  snapshot: () => http.get<SupplierBalancesVO>("/api/admin/supplier-balances"),
};

"use client";
import { createContext, useContext } from "react";
import type { PublicRuntimeConfig } from "@/lib/runtime-config";
import { money as formatMoney } from "@/lib/brand";

const RuntimeConfig = createContext<PublicRuntimeConfig | null>(null);
export function RuntimeConfigProvider({ config, children }: { config: PublicRuntimeConfig; children: React.ReactNode }) {
  return <RuntimeConfig.Provider value={config}>{children}</RuntimeConfig.Provider>;
}
export function useRuntimeConfig() {
  const config = useContext(RuntimeConfig);
  if (!config) throw new Error("RuntimeConfigProvider is required");
  return config;
}
export function useBrand() {
  const BRAND = useRuntimeConfig();
  return { BRAND, money: (amount: number, currency = BRAND.currency) => formatMoney(amount, currency) };
}

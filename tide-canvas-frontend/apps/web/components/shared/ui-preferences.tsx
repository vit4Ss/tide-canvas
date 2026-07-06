"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const STORAGE_KEY = "tc-ui-preferences";

export type UiDensity = "compact" | "comfortable" | "spacious";
export type UiThemeColor = "blue" | "violet" | "cyan" | "green" | "rose" | "neutral";

export interface UiPreferences {
  fontSize: number;
  themeColor: UiThemeColor;
  density: UiDensity;
}

interface ThemeColorToken {
  label: string;
  color: string;
  soft: string;
  foreground: string;
  ring: string;
}

export const THEME_COLORS: Record<UiThemeColor, ThemeColorToken> = {
  blue: { label: "蓝色", color: "#1677ff", soft: "#e6f0ff", foreground: "#ffffff", ring: "#4096ff" },
  violet: { label: "紫色", color: "#6d5efc", soft: "#f0edff", foreground: "#ffffff", ring: "#8f83ff" },
  cyan: { label: "青色", color: "#0891b2", soft: "#e0f7fb", foreground: "#ffffff", ring: "#22b8cf" },
  green: { label: "绿色", color: "#16a34a", soft: "#e8f7ee", foreground: "#ffffff", ring: "#22c55e" },
  rose: { label: "玫红", color: "#e11d48", soft: "#ffe4eb", foreground: "#ffffff", ring: "#fb7185" },
  neutral: { label: "黑色", color: "#171717", soft: "#f5f5f5", foreground: "#ffffff", ring: "#525252" },
};

export const FONT_SIZE_OPTIONS = [
  { value: 15, label: "紧凑" },
  { value: 16, label: "标准" },
  { value: 17, label: "舒适" },
  { value: 18, label: "大字" },
];

export const DENSITY_OPTIONS: Array<{ value: UiDensity; label: string; description: string }> = [
  { value: "compact", label: "紧凑", description: "工具区更省空间" },
  { value: "comfortable", label: "标准", description: "适合日常创作" },
  { value: "spacious", label: "宽松", description: "更多阅读留白" },
];

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  fontSize: 16,
  themeColor: "blue",
  density: "comfortable",
};

interface UiPreferencesContextValue {
  preferences: UiPreferences;
  setPreferences: (next: UiPreferences | ((current: UiPreferences) => UiPreferences)) => void;
  resetPreferences: () => void;
}

const UiPreferencesContext = createContext<UiPreferencesContextValue | null>(null);

function isUiDensity(value: unknown): value is UiDensity {
  return value === "compact" || value === "comfortable" || value === "spacious";
}

function isThemeColor(value: unknown): value is UiThemeColor {
  return typeof value === "string" && value in THEME_COLORS;
}

function normalizePreferences(value: unknown): UiPreferences {
  if (!value || typeof value !== "object") return DEFAULT_UI_PREFERENCES;
  const source = value as Partial<UiPreferences>;
  const fontSize = typeof source.fontSize === "number" && Number.isFinite(source.fontSize)
    ? Math.min(18, Math.max(15, source.fontSize))
    : DEFAULT_UI_PREFERENCES.fontSize;
  return {
    fontSize,
    themeColor: isThemeColor(source.themeColor) ? source.themeColor : DEFAULT_UI_PREFERENCES.themeColor,
    density: isUiDensity(source.density) ? source.density : DEFAULT_UI_PREFERENCES.density,
  };
}

function readStoredPreferences(): UiPreferences {
  if (typeof window === "undefined") return DEFAULT_UI_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizePreferences(JSON.parse(raw)) : DEFAULT_UI_PREFERENCES;
  } catch {
    return DEFAULT_UI_PREFERENCES;
  }
}

function persistPreferences(preferences: UiPreferences) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

function applyPreferences(preferences: UiPreferences) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const color = THEME_COLORS[preferences.themeColor];

  root.style.setProperty("--tc-root-font-size", `${preferences.fontSize}px`);
  root.style.setProperty("--tc-font-scale", String(preferences.fontSize / DEFAULT_UI_PREFERENCES.fontSize));
  root.style.setProperty("--tc-primary", color.color);
  root.style.setProperty("--tc-primary-soft", color.soft);
  root.style.setProperty("--tc-primary-foreground", color.foreground);
  root.style.setProperty("--tc-ring", color.ring);
  root.style.setProperty("--primary", color.color);
  root.style.setProperty("--primary-foreground", color.foreground);
  root.style.setProperty("--accent", color.soft);
  root.style.setProperty("--accent-foreground", color.color);
  root.style.setProperty("--ring", color.ring);
  root.style.setProperty("--sidebar-primary", color.color);
  root.style.setProperty("--sidebar-primary-foreground", color.foreground);
  root.dataset.tcDensity = preferences.density;
  root.dataset.tcThemeColor = preferences.themeColor;
}

export function UiPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferencesState] = useState<UiPreferences>(DEFAULT_UI_PREFERENCES);

  useEffect(() => {
    const stored = readStoredPreferences();
    setPreferencesState(stored);
    applyPreferences(stored);
  }, []);

  const value = useMemo<UiPreferencesContextValue>(() => ({
    preferences,
    setPreferences: (next) => {
      setPreferencesState((current) => {
        const resolved = normalizePreferences(typeof next === "function" ? next(current) : next);
        persistPreferences(resolved);
        applyPreferences(resolved);
        return resolved;
      });
    },
    resetPreferences: () => {
      persistPreferences(DEFAULT_UI_PREFERENCES);
      applyPreferences(DEFAULT_UI_PREFERENCES);
      setPreferencesState(DEFAULT_UI_PREFERENCES);
    },
  }), [preferences]);

  return <UiPreferencesContext.Provider value={value}>{children}</UiPreferencesContext.Provider>;
}

export function useUiPreferences() {
  const value = useContext(UiPreferencesContext);
  if (!value) throw new Error("useUiPreferences must be used within UiPreferencesProvider");
  return value;
}

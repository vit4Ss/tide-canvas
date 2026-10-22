"use client";

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { Moon, Sun } from "lucide-react";
import "./styles/canvas-workspace.css";

type CanvasTheme = "light" | "dark";
const ThemeContext = createContext<{ theme: CanvasTheme; toggle: () => void }>({ theme: "light", toggle: () => {} });
const STORAGE_KEY = "flowinglight:canvas-theme";
const THEME_EVENT = "flowinglight:canvas-theme-change";
let memoryTheme: CanvasTheme = "light";

function readTheme(): CanvasTheme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* Private browsing can block storage. */ }
  return memoryTheme;
}

function subscribeTheme(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(THEME_EVENT, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(THEME_EVENT, notify);
  };
}

function toggleTheme() {
  memoryTheme = readTheme() === "light" ? "dark" : "light";
  try { localStorage.setItem(STORAGE_KEY, memoryTheme); } catch { /* Keep the in-memory preference. */ }
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function CanvasThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "light" as CanvasTheme);
  useEffect(() => {
    const body = document.body;
    const hadDark = body.classList.contains("dark");
    const previousTheme = body.getAttribute("data-canvas-theme");
    return () => {
      body.classList.toggle("dark", hadDark);
      if (previousTheme === null) body.removeAttribute("data-canvas-theme");
      else body.setAttribute("data-canvas-theme", previousTheme);
    };
  }, []);
  useEffect(() => {
    // Apply to body as node menus and dialogs can render through portals.
    document.body.classList.toggle("dark", theme === "dark");
    document.body.dataset.canvasTheme = theme;
  }, [theme]);
  return <ThemeContext.Provider value={{ theme, toggle: toggleTheme }}>{children}</ThemeContext.Provider>;
}

export const useCanvasTheme = () => useContext(ThemeContext);

export function CanvasThemeToggle() {
  const { theme, toggle } = useCanvasTheme();
  const Icon = theme === "light" ? Moon : Sun;
  return <button type="button" className="canvas-theme-toggle" onClick={toggle} aria-label={theme === "light" ? "切换到深色画布" : "切换到浅色画布"} title={theme === "light" ? "切换到深色画布" : "切换到浅色画布"}><Icon size={16} aria-hidden /><span>{theme === "light" ? "深色" : "浅色"}</span></button>;
}

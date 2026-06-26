"use client";

import { Search } from "lucide-react";

interface Props {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onSearch?: () => void;
  className?: string;
}

export function SearchBar({ value, placeholder = "搜索...", onChange, onSearch, className }: Props) {
  return (
    <div className={`relative ${className || "max-w-md flex-1"}`}>
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSearch?.()}
        placeholder={placeholder}
        className="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-10 pr-4 text-sm outline-none transition-colors focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
      />
    </div>
  );
}

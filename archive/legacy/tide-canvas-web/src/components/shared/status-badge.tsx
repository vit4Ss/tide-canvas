"use client";

interface Props {
  label: string;
  variant?: "success" | "warning" | "danger" | "info" | "neutral";
}

const VARIANTS = {
  success: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  danger: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  info: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  neutral: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
} as const;

export function StatusBadge({ label, variant = "neutral" }: Props) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${VARIANTS[variant]}`}>
      {label}
    </span>
  );
}

"use client";

interface RowsProps {
  rows?: number;
  columns?: number;
}

export function TableSkeleton({ rows = 5, columns = 6 }: RowsProps) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="border-b border-neutral-50 dark:border-neutral-900">
          {Array.from({ length: columns }).map((_, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-4 w-16 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function CardSkeleton({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={className || "space-y-3"}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800/50" />
      ))}
    </div>
  );
}

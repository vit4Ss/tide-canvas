"use client";

interface FilterOption<T = string> {
  value: T;
  label: string;
}

interface Props<T extends string | number> {
  value: T;
  options: FilterOption<T>[];
  onChange: (value: T) => void;
}

export function FilterTabs<T extends string | number>({ value, options, onChange }: Props<T>) {
  return (
    <div className="flex gap-2">
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          onClick={() => onChange(opt.value)}
          className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
            value === opt.value
              ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
              : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

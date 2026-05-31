"use client";

import type { ReactNode } from "react";

interface BaseFieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
}

interface TextFieldProps extends BaseFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password" | "email" | "url";
}

export function TextField({ label, required, hint, error, value, onChange, placeholder, type = "text" }: TextFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium">
        {label}{required && <span className="text-red-500"> *</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm outline-none transition-colors focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-white dark:focus:ring-white"
      />
      {hint && <p className="mt-1 text-xs text-neutral-400">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

interface NumberFieldProps extends BaseFieldProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

export function NumberField({ label, required, hint, error, value, onChange, min, max, step }: NumberFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium">
        {label}{required && <span className="text-red-500"> *</span>}
      </label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm outline-none transition-colors focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-white dark:focus:ring-white"
      />
      {hint && <p className="mt-1 text-xs text-neutral-400">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

interface SelectFieldProps extends BaseFieldProps {
  value: string | number;
  onChange: (value: string) => void;
  options: { value: string | number; label: string }[];
}

export function SelectField({ label, required, hint, error, value, onChange, options }: SelectFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium">
        {label}{required && <span className="text-red-500"> *</span>}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-white"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {hint && <p className="mt-1 text-xs text-neutral-400">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

interface TextAreaFieldProps extends BaseFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}

export function TextAreaField({ label, required, hint, error, value, onChange, placeholder, rows = 4 }: TextAreaFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium">
        {label}{required && <span className="text-red-500"> *</span>}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm outline-none transition-colors focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-white dark:focus:ring-white"
      />
      {hint && <p className="mt-1 text-xs text-neutral-400">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function FormSection({ title, description, children }: { title?: string; description?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
      {title && <h3 className="font-semibold">{title}</h3>}
      {description && <p className="mt-1 text-sm text-neutral-500">{description}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </div>
  );
}

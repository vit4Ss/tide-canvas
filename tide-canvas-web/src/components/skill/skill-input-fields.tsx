"use client";

import { useId, useMemo, type CSSProperties } from "react";
import { skillInputFields } from "@/lib/skill-api";
import { PopoverSelect, type PopoverSelectTone } from "@/components/shared/popover-select";
import type { SkillInputSchema } from "@/types/skill";
import styles from "./skill-run-panel.module.css";

export function SkillInputFields({
  schema,
  values,
  errors,
  onChange,
  disabled = false,
  compact = false,
  selectTone = "default",
  className,
  style,
}: {
  schema: SkillInputSchema | string | null | undefined;
  values: Record<string, unknown>;
  errors?: Record<string, string>;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
  compact?: boolean;
  selectTone?: PopoverSelectTone;
  className?: string;
  style?: CSSProperties;
}) {
  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const fields = useMemo(() => skillInputFields(schema), [schema]);
  if (!fields.length) return null;

  return (
    <div
      className={`${styles.fields}${compact ? ` ${styles.fieldsCompact}` : ""}${className ? ` ${className}` : ""}`}
      style={style}
    >
      {fields.map((field) => {
        const value = values[field.key];
        const error = errors?.[field.key];
        const id = `skill-field-${instanceId}-${field.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
        const errorId = `${id}-error`;
        const options = field.options?.length
          ? field.options
          : field.enum?.map((item) => ({ label: String(item), value: item })) ?? [];
        return (
          <label key={field.key} className={styles.field} htmlFor={id}>
            <span className={styles.fieldLabel}>
              {field.label}
              {field.required && <i>必填</i>}
            </span>
            {field.type === "boolean" ? (
              <span className={styles.checkRow}>
                <input
                  id={id}
                  type="checkbox"
                  checked={value === true}
                  disabled={disabled}
                  aria-describedby={error ? errorId : undefined}
                  onChange={(event) => onChange(field.key, event.target.checked)}
                />
                <span>{field.description || "启用"}</span>
              </span>
            ) : field.type === "select" ? (
              <PopoverSelect
                id={id}
                value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
                options={[
                  { value: "", label: "请选择" },
                  ...options.map((option) => ({ value: String(option.value), label: option.label })),
                ]}
                onChange={(picked) => {
                  const hit = options.find((option) => String(option.value) === picked);
                  onChange(field.key, hit?.value ?? picked);
                }}
                label={field.label}
                ariaDescribedBy={error ? errorId : undefined}
                invalid={!!error}
                disabled={disabled}
                tone={selectTone}
                className="min-h-9 w-full px-2.5 py-1.5 text-xs"
              />
            ) : field.type === "textarea" ? (
              <textarea
                id={id}
                rows={compact ? 2 : 3}
                value={typeof value === "string" ? value : value == null ? "" : String(value)}
                placeholder={field.placeholder}
                disabled={disabled}
                aria-invalid={!!error}
                aria-describedby={error ? errorId : undefined}
                onChange={(event) => onChange(field.key, event.target.value)}
              />
            ) : (
              <input
                id={id}
                type={field.type === "number" ? "number" : "text"}
                value={typeof value === "string" || typeof value === "number" ? value : ""}
                placeholder={field.placeholder}
                min={field.min}
                max={field.max}
                step={field.step}
                disabled={disabled}
                aria-invalid={!!error}
                aria-describedby={error ? errorId : undefined}
                onChange={(event) =>
                  onChange(
                    field.key,
                    field.type === "number" && event.target.value !== ""
                      ? Number(event.target.value)
                      : event.target.value,
                  )
                }
              />
            )}
            {field.description && field.type !== "boolean" && (
              <small className={styles.fieldHint}>{field.description}</small>
            )}
            {error && <small id={errorId} className={styles.fieldError}>{error}</small>}
          </label>
        );
      })}
    </div>
  );
}

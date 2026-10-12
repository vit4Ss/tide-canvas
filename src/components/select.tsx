"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import styles from "./select.module.css";
import type { ReactNode } from "react";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  icon?: ReactNode;
}

interface SelectProps {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
}

// Prefix every value so an empty application value (All formats / Model default)
// remains a real option instead of Radix's reserved empty placeholder value.
const encodeValue = (value: string) => `option:${value}`;

export function Select({
  id,
  value,
  onValueChange,
  options,
  placeholder = "Choose an option",
  disabled = false,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: SelectProps) {
  const selected = options.find((option) => option.value === value);

  return (
    <SelectPrimitive.Root
      value={selected ? encodeValue(selected.value) : ""}
      onValueChange={(next) => onValueChange(next.slice("option:".length))}
      disabled={disabled || !options.some((option) => !option.disabled)}
    >
      <SelectPrimitive.Trigger
        id={id}
        className={styles.trigger}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        title={selected?.label || placeholder}
      >
        {selected?.icon && <span className={styles.leadingIcon} aria-hidden="true">{selected.icon}</span>}
        <span className={styles.value}>
          <SelectPrimitive.Value placeholder={placeholder}>
            {selected?.label}
          </SelectPrimitive.Value>
        </span>
        <SelectPrimitive.Icon className={styles.chevron}>
          <ChevronDown size={16} aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className={styles.menu}
          position="popper"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          aria-label={ariaLabel}
        >
          <SelectPrimitive.ScrollUpButton className={styles.scrollButton}>
            <ChevronUp size={16} aria-hidden="true" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className={styles.viewport}>
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={encodeValue(option.value)}
                textValue={option.label}
                disabled={option.disabled}
                className={styles.option}
              >
                {option.icon && <span className={styles.leadingIcon} aria-hidden="true">{option.icon}</span>}
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className={styles.check}>
                  <Check size={15} strokeWidth={2} aria-hidden="true" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className={styles.scrollButton}>
            <ChevronDown size={16} aria-hidden="true" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

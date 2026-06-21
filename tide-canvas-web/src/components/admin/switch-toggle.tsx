"use client";

/* ============================================================================
   SwitchToggle — liuguang `.sw-toggle` pill switch.

   Faithful to admin.js `sw(on)` (<span class="sw-toggle [on]">) plus go()'s
   click-to-toggle wiring. Controlled-or-uncontrolled:
     - pass `checked` + `onChange` for controlled, OR
     - omit them and pass `defaultChecked` to self-manage.

   Rendered as a <button> for keyboard/focus accessibility while keeping the
   exact `.sw-toggle[.on]` classes so the CSS knob animation applies.

   <SwitchToggle defaultChecked />
   ============================================================================ */

import { useState } from "react";

export interface SwitchToggleProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
}

export function SwitchToggle({
  checked,
  defaultChecked = false,
  onChange,
  disabled,
  "aria-label": ariaLabel,
}: SwitchToggleProps) {
  const [internal, setInternal] = useState(defaultChecked);
  const on = checked != null ? checked : internal;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`sw-toggle${on ? " on" : ""}`}
      onClick={() => {
        const next = !on;
        if (checked == null) setInternal(next);
        onChange?.(next);
      }}
    />
  );
}

export default SwitchToggle;

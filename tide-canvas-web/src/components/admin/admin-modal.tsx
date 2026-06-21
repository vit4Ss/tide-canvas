"use client";

/* ============================================================================
   AdminModal — liuguang `.adm-mask` / `.adm-modal` CRUD modal shell.

   Faithful to admin.js `modal(title, bodyHTML, subtitle)`:
     <div class="adm-mask [show]">
       <div class="adm-modal">
         <div class="adm-mhead"><div><h2/><div class="mh-sub"/></div><button class="x"/></div>
         <div class="adm-mbody">{children}</div>
         <div class="adm-mfoot"><span class="foot-note"/>…取消 / 保存</div>
       </div>
     </div>

   Behavior parity with admin.js: backdrop click closes, ✕ closes, 取消 closes,
   保存 fires onSave then closes. The `.show` class is toggled on the next frame
   so the open transition runs (admin.js did `void offsetWidth; add('show')`).
   Escape-to-close added for accessibility. Renders nothing when closed.

   Section pages compose their forms from the exported field helpers (Field,
   FormCard, FormGrid, FormSection, MChips) inside <AdminModal>.

   <AdminModal open={open} title="新增模型" subtitle="配置模型…" onClose={close} onSave={save}>
     <FormCard title="基础信息"><FormGrid> … <Field label="名称" required /> … </FormGrid></FormCard>
   </AdminModal>
   ============================================================================ */

import { useEffect, useState } from "react";

export interface AdminModalProps {
  open: boolean;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  /** Footer note (default: "变更将在保存后生效"). */
  footNote?: React.ReactNode;
  /** Cancel button label (default: "取消"). */
  cancelLabel?: string;
  /** Save button label (default: "保存"). */
  saveLabel?: string;
  onClose: () => void;
  /** Fires before the modal closes on save. */
  onSave?: () => void;
}

export function AdminModal({
  open,
  title,
  subtitle,
  children,
  footNote = "变更将在保存后生效",
  cancelLabel = "取消",
  saveLabel = "保存",
  onClose,
  onSave,
}: AdminModalProps) {
  const [show, setShow] = useState(false);

  // toggle `.show` after mount for the entrance transition; the cleanup resets
  // it when `open` flips back to false (no synchronous setState in the effect).
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => setShow(true));
    return () => {
      cancelAnimationFrame(id);
      setShow(false);
    };
  }, [open]);

  // Escape-to-close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const save = () => {
    onSave?.();
    onClose();
  };

  return (
    <div
      className={`adm-mask${show ? " show" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="adm-modal" role="dialog" aria-modal="true">
        <div className="adm-mhead">
          <div>
            <h2>{title}</h2>
            {subtitle ? <div className="mh-sub">{subtitle}</div> : null}
          </div>
          <button type="button" className="x" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="adm-mbody">{children}</div>
        <div className="adm-mfoot">
          <span className="foot-note">{footNote}</span>
          <button type="button" className="adm-btn ghost" onClick={onClose}>
            {cancelLabel}
          </button>
          <button type="button" className="adm-btn" onClick={save}>
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Form field helpers — reusable inside AdminModal bodies (and config panels).
   Mirror the liuguang `.fcard / .ct / .fgrid / .fld / .fsec / .mchips` markup.
   ──────────────────────────────────────────────────────────────────────── */

/** A grouped form card with a `.ct` accent title. */
export function FormCard({
  title,
  children,
  style,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className="fcard" style={style}>
      <div className="ct">{title}</div>
      {children}
    </div>
  );
}

/** The 4-col `.fgrid` form layout (use Field `col2`/`col4` to span). */
export function FormGrid({ children }: { children: React.ReactNode }) {
  return <div className="fgrid">{children}</div>;
}

/** A `.fld` labeled input wrapper. Pass `children` to supply a custom control. */
export interface FieldProps {
  label: React.ReactNode;
  required?: boolean;
  /** Hint line under the control. */
  hint?: React.ReactNode;
  /** Column span: 2 → `.col2`, 4 → full row. */
  span?: 2 | 4;
  /** Custom control; if omitted, a text <input> with `placeholder`/`defaultValue`. */
  children?: React.ReactNode;
  placeholder?: string;
  defaultValue?: string;
}

export function Field({ label, required, hint, span, children, placeholder, defaultValue }: FieldProps) {
  const spanClass = span === 2 ? " col2" : "";
  const spanStyle: React.CSSProperties | undefined = span === 4 ? { gridColumn: "span 4" } : undefined;
  return (
    <div className={`fld${spanClass}`} style={spanStyle}>
      <label>
        {label}
        {required ? <span className="req">*</span> : null}
      </label>
      {children ?? <input placeholder={placeholder} defaultValue={defaultValue} />}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

/** A `.fsec` section with an accent `.lab` heading (for chip groups / option lists). */
export function FormSection({
  label,
  children,
  hint,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="fsec">
      <span className="lab">{label}</span>
      {children}
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

/**
 * MChips — `.mchips` multi/single-select chip group used inside modals.
 * Faithful to admin.js `chips(arr, sel, solo)`: `solo` makes it single-select.
 */
export function MChips({
  options,
  selected = [],
  solo = false,
  onChange,
}: {
  options: string[];
  selected?: string[];
  solo?: boolean;
  onChange?: (next: string[]) => void;
}) {
  const [sel, setSel] = useState<string[]>(selected);
  const toggle = (opt: string) => {
    let next: string[];
    if (solo) next = [opt];
    else next = sel.includes(opt) ? sel.filter((s) => s !== opt) : [...sel, opt];
    setSel(next);
    onChange?.(next);
  };
  return (
    <div className="mchips">
      {options.map((opt) => (
        <span
          key={opt}
          className={`mchip${sel.includes(opt) ? " on" : ""}`}
          onClick={() => toggle(opt)}
        >
          {opt}
        </span>
      ))}
    </div>
  );
}

export default AdminModal;

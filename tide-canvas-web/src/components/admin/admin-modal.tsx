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
   保存 awaits onSave then closes — UNLESS onSave returns/resolves `false`
   (校验失败或接口失败时返回 false，弹窗保持打开、用户输入不丢；admin.js 的
   「无条件关弹窗」quirk 由此修正，2026-07 审计)。onSave 进行中保存按钮禁用。
   The `.show` class is toggled on the next frame so the open transition runs
   (admin.js did `void offsetWidth; add('show')`).
   Escape-to-close added for accessibility. Renders nothing when closed.

   Section pages compose their forms from the exported field helpers (Field,
   FormCard, FormGrid, FormSection, MChips) inside <AdminModal>.

   <AdminModal open={open} title="新增模型" subtitle="配置模型…" onClose={close} onSave={save}>
     <FormCard title="基础信息"><FormGrid> … <Field label="名称" required /> … </FormGrid></FormCard>
   </AdminModal>
   ============================================================================ */

import {
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useState,
} from "react";
import { LoaderCircle, X } from "lucide-react";
import { useFocusTrap } from "@/hooks/use-focus-trap";

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
  /** Dialog width preset. Defaults to md. */
  size?: "sm" | "md" | "lg" | "xl";
  /** Whether the dialog can be dismissed via close button, backdrop, or Escape. */
  closeable?: boolean;
  /** Whether to render the secondary cancel action. */
  showCancel?: boolean;
  onClose: () => void;
  /** Fires on save; return/resolve `false` to keep the modal open
   *  (validation / API failure). Any other result closes the modal. */
  onSave?: () => void | boolean | Promise<void | boolean>;
}

export function AdminModal({
  open,
  title,
  subtitle,
  children,
  footNote = "变更将在保存后生效",
  cancelLabel = "取消",
  saveLabel = "保存",
  size = "md",
  closeable = true,
  showCancel = true,
  onClose,
  onSave,
}: AdminModalProps) {
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const dialogRef = useFocusTrap<HTMLDivElement>(open);
  const titleId = useId();
  const subtitleId = useId();

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
      if (e.key === "Escape" && !saving && closeable) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeable, open, onClose, saving]);

  if (!open) return null;

  const save = async () => {
    if (saving) return;
    if (!onSave) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const result = await onSave();
      if (result !== false) onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`adm-mask${show ? " show" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving && closeable) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`adm-modal adm-modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        aria-busy={saving}
      >
        <div className="adm-mhead">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <div className="mh-sub" id={subtitleId}>{subtitle}</div> : null}
          </div>
          {closeable ? (
            <button type="button" className="x" onClick={onClose} aria-label="关闭" disabled={saving}>
              <X aria-hidden size={16} strokeWidth={1.8} />
            </button>
          ) : null}
        </div>
        <div className="adm-mbody">{children}</div>
        <div className="adm-mfoot">
          <span className="foot-note">{footNote}</span>
          {showCancel ? (
            <button type="button" className="adm-btn ghost" onClick={onClose} disabled={saving}>
              {cancelLabel}
            </button>
          ) : null}
          <button type="button" className="adm-btn" disabled={saving} onClick={save}>
            {saving ? <><LoaderCircle className="adm-spin" aria-hidden size={14} />保存中…</> : saveLabel}
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
    <section className="fcard" style={style}>
      <h3 className="ct">{title}</h3>
      {children}
    </section>
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
  /** Inline validation message. */
  error?: React.ReactNode;
  /** Column span: 2 → `.col2`, 4 → full row. */
  span?: 2 | 4;
  /** Treat the child as a composite group rather than one labelable control. */
  group?: boolean;
  /** Custom control; if omitted, a text <input> with `placeholder`/`defaultValue`. */
  children?: React.ReactNode;
  placeholder?: string;
  defaultValue?: string;
}

export function Field({ label, required, hint, error, span, group, children, placeholder, defaultValue }: FieldProps) {
  const controlId = useId();
  const labelId = useId();
  const hintId = useId();
  const errorId = useId();
  const spanClass = span === 2 ? " col2" : span === 4 ? " col4" : "";
  const nativeTag = children && isValidElement(children) && typeof children.type === "string"
    ? children.type
    : null;
  const isNativeLabelable = nativeTag != null && ["button", "input", "meter", "output", "progress", "select", "textarea"].includes(nativeTag);
  const isComposite = group ?? (nativeTag != null && !isNativeLabelable);
  const resolvedControlId =
    !isComposite && children && isValidElement<{ id?: string }>(children)
      ? children.props.id ?? controlId
      : controlId;
  let control: React.ReactNode = children ?? (
    <input id={resolvedControlId} placeholder={placeholder} defaultValue={defaultValue} required={required} />
  );
  if (
    children && !isComposite &&
    isValidElement<{
      id?: string;
      "aria-describedby"?: string;
      "aria-invalid"?: boolean | "true" | "false";
      required?: boolean;
    }>(children)
  ) {
    const describedBy = [hint ? hintId : "", error ? errorId : "", children.props["aria-describedby"] ?? ""]
      .filter(Boolean)
      .join(" ");
    control = cloneElement(children, {
      id: resolvedControlId,
      required: children.props.required ?? required,
      "aria-describedby": describedBy || undefined,
      "aria-invalid": error ? true : children.props["aria-invalid"],
    });
  } else if (
    children && isComposite &&
    isValidElement<{
      role?: string;
      "aria-labelledby"?: string;
      "aria-describedby"?: string;
      "aria-invalid"?: boolean | "true" | "false";
    }>(children)
  ) {
    const describedBy = [hint ? hintId : "", error ? errorId : "", children.props["aria-describedby"] ?? ""]
      .filter(Boolean)
      .join(" ");
    control = cloneElement(children, {
      role: children.props.role ?? "group",
      "aria-labelledby": children.props["aria-labelledby"] ?? labelId,
      "aria-describedby": describedBy || undefined,
      "aria-invalid": error ? true : children.props["aria-invalid"],
    });
  }
  return (
    <div className={`fld${spanClass}${error ? " has-error" : ""}`}>
      {isComposite ? (
        <span className="fld-label" id={labelId}>
          {label}
          {required ? <span className="req" aria-hidden>*</span> : null}
        </span>
      ) : (
        <label htmlFor={resolvedControlId}>
          {label}
          {required ? <span className="req" aria-hidden>*</span> : null}
        </label>
      )}
      {control}
      {hint ? <span className="hint" id={hintId}>{hint}</span> : null}
      {error ? <span className="fld-error" id={errorId} role="alert">{error}</span> : null}
    </div>
  );
}

/** A `.fsec` section with an accent `.lab` heading (for chip groups / option lists). */
const FormSectionLabelContext = createContext<string | undefined>(undefined);

/** Label id for composite controls rendered inside a FormSection. */
export function useFormSectionLabelId() {
  return useContext(FormSectionLabelContext);
}

export function FormSection({
  label,
  children,
  hint,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  const labelId = useId();
  const hintId = useId();
  return (
    <div
      className="fsec"
      role="group"
      aria-labelledby={labelId}
      aria-describedby={hint ? hintId : undefined}
    >
      <span className="lab" id={labelId}>{label}</span>
      <FormSectionLabelContext.Provider value={labelId}>
        {children}
      </FormSectionLabelContext.Provider>
      {hint ? <div className="hint" id={hintId}>{hint}</div> : null}
    </div>
  );
}

/**
 * MChips — `.mchips` multi/single-select chip group used inside modals.
 * Faithful to admin.js `chips(arr, sel, solo)`: `solo` makes it single-select.
 */
export function MChips({
  options,
  selected,
  solo = false,
  onChange,
  label,
  role = "group",
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: {
  options: string[];
  selected?: string[];
  solo?: boolean;
  onChange?: (next: string[]) => void;
  /** Accessible group name when rendered outside FormSection. */
  label?: string;
  role?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}) {
  const [internal, setInternal] = useState<string[]>(selected ?? []);
  const sectionLabelId = useFormSectionLabelId();
  const labelledBy = ariaLabelledBy ?? sectionLabelId;
  const sel = selected ?? internal;
  const toggle = (opt: string) => {
    let next: string[];
    if (solo) next = [opt];
    else next = sel.includes(opt) ? sel.filter((s) => s !== opt) : [...sel, opt];
    if (selected == null) setInternal(next);
    onChange?.(next);
  };
  return (
    <div
      className="mchips"
      role={role}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
    >
      {options.map((opt) => (
        <button
          type="button"
          key={opt}
          className={`mchip${sel.includes(opt) ? " on" : ""}`}
          onClick={() => toggle(opt)}
          aria-pressed={sel.includes(opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

export default AdminModal;

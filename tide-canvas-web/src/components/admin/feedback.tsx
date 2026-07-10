import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";

export type AdminAlertTone = "info" | "success" | "warning" | "error";

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  error: AlertCircle,
};

export function AdminAlert({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: AdminAlertTone;
  title: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const Icon = ICONS[tone];
  return (
    <div className={`adm-alert ${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon aria-hidden size={17} strokeWidth={1.8} />
      <div className="adm-alert-copy">
        <strong>{title}</strong>
        {children ? <div>{children}</div> : null}
      </div>
      {action ? <div className="adm-alert-action">{action}</div> : null}
    </div>
  );
}

export function AdminEmptyState({
  title,
  description,
  action,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="adm-empty">
      <div className="t">{title}</div>
      {description ? <div className="s">{description}</div> : null}
      {action}
    </div>
  );
}

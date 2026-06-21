// Barrel for the /admin shared primitives. Section pages import from
// "@/components/admin". All components use the EXACT liuguang class names from
// design-ref/后台管理.html + admin.js so the styles in admin.css apply.

export { AdminTable } from "./admin-table";
export type { AdminTableProps, Column, CellAlign } from "./admin-table";

export {
  AdminModal,
  FormCard,
  FormGrid,
  Field,
  FormSection,
  MChips,
} from "./admin-modal";
export type { AdminModalProps, FieldProps } from "./admin-modal";

export { StatCard, StatCardGrid } from "./stat-card";
export type { StatCardProps, StatCardGridProps } from "./stat-card";

export { Panel, SectionHeader } from "./section-header";
export type { PanelProps, SectionHeaderProps } from "./section-header";

export { StatusPill } from "./status-pill";
export type { StatusPillProps } from "./status-pill";

export { FilterChips, FilterBar } from "./filter-bar";
export type { FilterChipsProps, FilterBarProps } from "./filter-bar";

export { SwitchToggle } from "./switch-toggle";
export type { SwitchToggleProps } from "./switch-toggle";

export { RowActions } from "./row-actions";
export type { RowAction, RowActionsProps } from "./row-actions";

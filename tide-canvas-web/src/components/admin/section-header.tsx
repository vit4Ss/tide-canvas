/* ============================================================================
   Panel + PanelHeader — liuguang `.adm-panel` shell with a title/sub/tools head.

   Faithful to admin.js `panel(title, sub, tools, inner)`:
     <div class="adm-panel">
       <div class="adm-phead"><div><h2/><div class="sub"/></div>
         <div class="sp"/><div class="adm-tools">{tools}</div></div>
       {children}
     </div>

   The section pages wrap their tables / config-grids in <Panel>. `tools` is the
   right-aligned action slot (chips, buttons, search). Server-safe.

   <Panel title="用户列表" sub="管理账号" tools={<button className="adm-btn">+ 新建</button>}>
     <AdminTable … />
   </Panel>
   ============================================================================ */

export interface PanelProps {
  title: React.ReactNode;
  /** Optional sub-heading line under the title. */
  sub?: React.ReactNode;
  /** Right-aligned tools slot (chips / buttons / search). */
  tools?: React.ReactNode;
  /** Panel body (table, config grid, custom content). */
  children: React.ReactNode;
  /** Extra className on the `.adm-panel` root. */
  className?: string;
}

export function Panel({ title, sub, tools, children, className }: PanelProps) {
  return (
    <div className={`adm-panel${className ? ` ${className}` : ""}`}>
      <div className="adm-phead">
        <div>
          <h2>{title}</h2>
          {sub ? <div className="sub">{sub}</div> : null}
        </div>
        <div className="sp" />
        {tools ? <div className="adm-tools">{tools}</div> : null}
      </div>
      {children}
    </div>
  );
}

/**
 * SectionHeader — standalone title/sub block (no panel chrome). Useful when a
 * page wants a heading above a free-form layout. Reuses the `.adm-phead`
 * typography by rendering the same h2/sub markup.
 */
export interface SectionHeaderProps {
  title: React.ReactNode;
  sub?: React.ReactNode;
  tools?: React.ReactNode;
}

export function SectionHeader({ title, sub, tools }: SectionHeaderProps) {
  return (
    <div className="adm-phead" style={{ border: "none", paddingLeft: 0, paddingRight: 0 }}>
      <div>
        <h2>{title}</h2>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      <div className="sp" />
      {tools ? <div className="adm-tools">{tools}</div> : null}
    </div>
  );
}

export default Panel;

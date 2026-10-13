"use client";
import { useBrand } from "./runtime-config";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, ArrowRight, Menu, X, LayoutGrid, Images, Boxes, Code2, BarChart3, Settings2, Sparkles, LogOut, BookOpen, CreditCard, Wand2, ChevronDown } from "lucide-react";
import { useMobileNavigation } from "./use-mobile-navigation";
import styles from "./navigation.module.css";
import { number } from "@/lib/brand";
import { useConsumer } from "./consumer-info";
import { useAuth } from "./auth-provider";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  const { BRAND } = useBrand();
  return <Link className="brand" href="/" aria-label={`${BRAND.name} home`}><svg viewBox="0 0 32 32" width="30" height="30" fill="none" aria-hidden><path d="M5 6h15v5H10v15H5V6Z" fill="currentColor" /><path d="M13 6h14v20H13v-5h9V11h-9V6Z" fill="currentColor" opacity=".65" /></svg>{!compact && <span>{BRAND.name}<span className="brand-period">.</span></span>}</Link>;
}
const links = [{ href: "/studio", label: "Studio" }, { href: "/explore", label: "Explore" }, { href: "/models", label: "Models" }, { href: "/developers", label: "Developers" }, { href: "/pricing", label: "Pricing" }];
export function PublicHeader() {
  const { registration } = useConsumer();
  const registrationOpen = registration.data?.registerClosed === false;
  const { open, setOpen, panelRef, triggerRef } = useMobileNavigation(); const { user } = useAuth(); const pathname = usePathname();
  return <header ref={panelRef} className="site-header"><div className="header-inner"><BrandMark /><nav id="public-navigation" className={`${styles.publicMenu} ${open ? "public-nav open" : "public-nav"}`} aria-label="Main navigation">{links.map((link) => <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined} className={pathname === link.href ? "active" : ""} onClick={() => setOpen(false)}>{link.label}</Link>)}</nav><div className="header-actions">{user ? <Link className="button small" href="/account">Your account <ArrowUpRight size={14} /></Link> : <><Link className="text-link" href="/login">Log in</Link><Link className="button primary small" href={registrationOpen ? "/signup" : "/studio"}>{registrationOpen ? "Get started" : "Explore studio"} <ArrowUpRight size={14} /></Link></>}<button ref={triggerRef} aria-controls="public-navigation" className="icon-button mobile-toggle" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X size={21} /> : <Menu size={21} />}</button></div></div></header>;
}
export function Footer() {
  const { BRAND } = useBrand(); return <footer className="site-footer"><div className="footer-top"><div><BrandMark /><p>A little imagination.<br />An entirely new world.</p></div><div className="footer-links"><div><span>Create</span><Link href="/studio">Creative studio</Link><Link href="/models">Model collection</Link><Link href="/explore">Inspiration</Link><Link href="/library">Your library</Link></div><div><span>Build</span><Link href="/developers">For developers</Link><Link href="/docs">API documentation</Link><Link href="/playground">API playground</Link><Link href="/pricing">Pricing</Link></div><div><span>Get to know us</span><Link href="/about">About {BRAND.name}</Link><Link href="/help">Help center</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/refunds">Refund policy</Link><Link href="/aup">Acceptable use</Link></div></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} {BRAND.name}</span><span>More room for your imagination.</span><Link href="/help">Need a hand? <ArrowUpRight size={13} /></Link></div></footer>; }
export function PublicPage({ children }: { children: React.ReactNode }) { return <><PublicHeader /><main>{children}</main><Footer /></>; }
const workspaceLinks = [
  { href: "/studio", label: "Create", icon: Sparkles },
  { href: "/library", label: "Library", icon: Images },
  { href: "/history", label: "Activity", icon: LayoutGrid },
  { href: "/models", label: "Models", icon: Boxes },
  { href: "/tools", label: "Enhance", icon: Wand2 },
  { href: "/playground", label: "API playground", icon: Code2 },
  { href: "/usage", label: "Usage & credits", icon: BarChart3 },
  { href: "/account", label: "Account", icon: Settings2 },
];
export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const { BRAND } = useBrand();
  const pathname = usePathname(); const { user, logout } = useAuth(); const { open, setOpen, mobile, panelRef, triggerRef } = useMobileNavigation(true);
  return <div className="workspace"><aside ref={panelRef} id="workspace-navigation" className={`${styles.sidebar} ${open ? "workspace-sidebar open" : "workspace-sidebar"}`} data-open={open} inert={mobile && !open} role={open ? "dialog" : undefined} aria-modal={open || undefined} aria-label="Workspace menu"><div className="sidebar-brand"><BrandMark /><button data-close-navigation className="icon-button mobile-toggle" aria-label="Close workspace navigation" onClick={() => setOpen(false)}><X size={18} /></button></div><Link className="workspace-switcher" href="/studio"><span className="workspace-initial">{user?.nickname?.[0]?.toUpperCase() || user?.username?.[0]?.toUpperCase() || "P"}</span><span>{user?.nickname || user?.username || "Personal workspace"}<small>Your creative space</small></span><ChevronDown size={14} /></Link><nav aria-label="Workspace navigation">{workspaceLinks.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={pathname === href || (href === "/studio" && pathname.startsWith("/studio/")) ? "page" : undefined} className={pathname === href || (href === "/studio" && pathname.startsWith("/studio/")) ? "on" : ""} onClick={() => setOpen(false)}><Icon size={18} /><span>{label}</span></Link>)}</nav><div className="sidebar-bottom">{user ? <div className="credit-box"><div><CreditCard size={15} /><span>Available credits</span></div><strong>{number(user.points)}</strong><Link href="/pricing">Find your plan <ArrowRight size={14} /></Link></div> : <Link className="button primary" href="/login">Sign in to create <ArrowRight size={15} /></Link>}<Link className="sidebar-help" href="/docs"><BookOpen size={16} />Documentation <ArrowUpRight size={13} /></Link>{user && <button className="sidebar-help" onClick={() => void logout()}><LogOut size={16} />Sign out</button>}</div></aside><div className="workspace-body" inert={open}><div className="workspace-topbar"><button ref={triggerRef} className="icon-button mobile-toggle" aria-expanded={open} aria-controls="workspace-navigation" onClick={() => setOpen(!open)} aria-label="Open workspace navigation"><Menu size={20} /></button><span>{BRAND.name}<span className="topbar-slash">/</span>{workspaceLinks.find((link) => link.href === pathname)?.label || "Workspace"}</span><div><Link href="/help">Help</Link><Link href="/explore">Find inspiration <ArrowUpRight size={14} /></Link></div></div><main className="workspace-content">{children}</main></div>{open && <button aria-label="Dismiss navigation" className="sidebar-scrim" onClick={() => setOpen(false)} />}</div>;
}

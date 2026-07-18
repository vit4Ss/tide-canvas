"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ActionIcon, Box, Group, NavLink, Stack, Text, Tooltip } from "@mantine/core";
import { FolderOpen, LayoutGrid, Plus } from "lucide-react";
import { BrandMark } from "@/components/shared/brand-mark";
import { ConversationHistory } from "./conversation-history";
import { NEW_CREATION_EVENT } from "@/types/conversation";
import styles from "./sidebar.module.css";

export const SIDEBAR_COLLAPSED_STORAGE_KEY = "tc:sidebar:collapsed";

const PLATFORM_NAV = [
  { href: "/", key: "create", icon: Plus, match: (pathname: string) => pathname === "/" || pathname.startsWith("/canvas") },
  { href: "/user/assets", key: "assets", icon: FolderOpen, match: (pathname: string) => pathname.startsWith("/user/assets") },
  { href: "/user/projects", key: "projects", icon: LayoutGrid, match: (pathname: string) => pathname.startsWith("/user/projects") },
] as const;

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={styles.toggleIcon}
      data-collapsed={collapsed || undefined}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <path d="M9 3v18m7-6l-3-3l3-3" />
      </g>
    </svg>
  );
}

export function Sidebar({
  collapsed = false,
  onCollapsedChange,
}: {
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}) {
  const pathname = usePathname();
  const t = useTranslations("sidebar");

  const renderNavItem = (item: (typeof PLATFORM_NAV)[number]) => {
    const Icon = item.icon;
    const active = item.match(pathname);
    const label = t(item.key);

    if (collapsed) {
      const iconLink = (
        <ActionIcon
          component={Link}
          href={item.href}
          title={label}
          aria-current={active ? "page" : undefined}
          className={styles.iconNavItem}
          onClick={() => {
            if (item.key === "create") window.dispatchEvent(new Event(NEW_CREATION_EVENT));
          }}
          data-active={active || undefined}
          radius="md"
          size={36}
          variant="subtle"
        >
          <Icon size={17} strokeWidth={1.9} />
        </ActionIcon>
      );

      return (
        <Tooltip key={item.href} label={label} position="right" withArrow openDelay={250}>
          {iconLink}
        </Tooltip>
      );
    }

    return (
      <Box key={item.href}>
        <NavLink
          component={Link}
          href={item.href}
          title={label}
          aria-current={active ? "page" : undefined}
          active={active}
          variant="filled"
          color="dark"
          label={label}
          leftSection={<Icon size={16} strokeWidth={1.9} />}
          className={styles.navItem}
          classNames={{ label: styles.navLabel, section: styles.navSection }}
          onClick={() => {
            if (item.key === "create") window.dispatchEvent(new Event(NEW_CREATION_EVENT));
          }}
          noWrap
        />
      </Box>
    );
  };

  return (
    <Box component="aside" className={styles.root} data-collapsed={collapsed || undefined}>
      <Box className={styles.panel}>
        <Group className={styles.header} data-collapsed={collapsed || undefined} justify={collapsed ? "center" : "space-between"} wrap="nowrap">
          {!collapsed && (
            <Link href="/" className={styles.brandLink} title="TideCanvas">
              <BrandMark className="h-[30px] w-[35px]" />
              <span className={styles.brandText}>TideCanvas</span>
            </Link>
          )}
          <ActionIcon
            onClick={() => onCollapsedChange?.(!collapsed)}
            aria-label={collapsed ? t("expand") : t("collapse")}
            title={collapsed ? t("expand") : t("collapse")}
            className={styles.toggle}
            radius="md"
            size={collapsed ? 32 : 28}
            variant="subtle"
          >
            <SidebarToggleIcon collapsed={collapsed} />
          </ActionIcon>
        </Group>

        <Stack component="nav" className={styles.nav} data-collapsed={collapsed || undefined} gap={20} aria-label="Sidebar navigation">
          <section>
            {!collapsed && <Text className={styles.sectionLabel}>{t("platform")}</Text>}
            <Stack gap={6}>{PLATFORM_NAV.map(renderNavItem)}</Stack>
          </section>
        </Stack>
        {!collapsed && <ConversationHistory />}
      </Box>
    </Box>
  );
}

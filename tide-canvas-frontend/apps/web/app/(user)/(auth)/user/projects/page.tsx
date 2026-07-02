"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Group,
  Image,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import { ArrowUpDown, Image as ImageIcon, LayoutGrid, List as ListIcon, Plus, Search, User as UserIcon, Users } from "lucide-react";
import { ProjectCardMenu } from "@/components/project/project-card-menu";
import { useAuth } from "@/hooks/use-auth";
import { projectApi } from "@/lib/api";
import { displayProjectName, formatDateTime } from "@/lib/utils";
import type { ProjectVO } from "@/types/canvas";
import styles from "../library-page.module.css";

type ProjectFilter = "all" | "mine" | "team";

const MIN_SKELETON_VISIBLE_MS = 650;

function waitForSkeleton(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function FilterLabel({ icon: Icon, label }: { icon: typeof LayoutGrid; label: string }) {
  return (
    <span className={styles.segmentedLabel}>
      <Icon size={15} strokeWidth={1.9} />
      {label}
    </span>
  );
}

function ThumbPlaceholder() {
  return (
    <Center className={styles.mediaFallback}>
      <ThemeIcon variant="light" color="gray" size={52} radius="md">
        <ImageIcon size={26} />
      </ThemeIcon>
    </Center>
  );
}

function ProjectThumb({ project }: { project: ProjectVO }) {
  return project.thumbnail ? (
    <Image src={project.thumbnail} alt={displayProjectName(project.name)} className={styles.media} fit="cover" />
  ) : (
    <ThumbPlaceholder />
  );
}

export default function UserProjectsPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<ProjectVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [search, setSearch] = useState("");
  const [sortDesc, setSortDesc] = useState(true);
  const [view, setView] = useState<"grid" | "list">("grid");

  const loadProjects = useCallback(async () => {
    const startedAt = Date.now();
    setLoading(true);
    try {
      const res = await projectApi.list({ pageNum: 1, pageSize: 100 });
      if (res.success && res.data) setProjects(res.data.records);
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_SKELETON_VISIBLE_MS) await waitForSkeleton(MIN_SKELETON_VISIBLE_MS - elapsed);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadProjects();
    });
    return () => {
      active = false;
    };
  }, [loadProjects]);

  const isMine = (project: ProjectVO) => project.ownerId == null || project.ownerId === user?.id;

  const tabs = user?.inTeam
    ? [
        { value: "all", label: "全部", icon: LayoutGrid },
        { value: "mine", label: "我的", icon: UserIcon },
        { value: "team", label: "团队", icon: Users },
      ]
    : [];

  const shown = useMemo(() => {
    const kw = search.trim().toLowerCase();
    const list = projects.filter((project) => {
      if (filter === "mine" && !isMine(project)) return false;
      if (filter === "team" && isMine(project)) return false;
      if (kw && !displayProjectName(project.name).toLowerCase().includes(kw)) return false;
      return true;
    });

    return [...list].sort((a, b) => {
      const ta = new Date(a.updateTime).getTime();
      const tb = new Date(b.updateTime).getTime();
      return sortDesc ? tb - ta : ta - tb;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, filter, search, sortDesc, user?.id]);

  return (
    <Box className={styles.page}>
      <Group className={styles.header} justify="space-between">
        <Title order={1} size={28}>项目</Title>
      </Group>

      <Group className={styles.toolbar} gap="md">
        {tabs.length > 0 ? (
          <SegmentedControl
            value={filter}
            onChange={(value) => setFilter(value as ProjectFilter)}
            data={tabs.map((item) => ({ value: item.value, label: <FilterLabel icon={item.icon} label={item.label} /> }))}
            radius="md"
            size="sm"
            transitionDuration={0}
          />
        ) : (
          <Box />
        )}

        <Group className={styles.toolbarActions} gap="xs" wrap="wrap">
          <Button component={Link} href="/canvas/new" target="_blank" rel="noopener" leftSection={<Plus size={16} />} color="dark" radius="xl" size="sm">
            新增
          </Button>

          <TextInput
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="搜索项目"
            leftSection={<Search size={15} />}
            className={styles.searchInput}
            radius="xl"
            size="sm"
          />

          <Button variant="default" leftSection={<ArrowUpDown size={15} />} onClick={() => setSortDesc((value) => !value)} radius="xl" size="sm">
            {sortDesc ? "倒序" : "正序"}
          </Button>

          <Tooltip label={view === "grid" ? "切换为列表" : "切换为网格"}>
            <ActionIcon variant="default" radius="xl" size={36} onClick={() => setView((value) => (value === "grid" ? "list" : "grid"))} aria-label="切换视图">
              {view === "grid" ? <ListIcon size={16} /> : <LayoutGrid size={16} />}
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <Box className={styles.content}>
        {loading ? (
          <SimpleGrid cols={{ base: 1, sm: 3, lg: 4, xl: 5 }} spacing="lg">
            {Array.from({ length: 10 }).map((_, index) => (
              <Skeleton key={index} height={150} radius="md" />
            ))}
          </SimpleGrid>
        ) : shown.length === 0 ? (
          <Center className={styles.emptyState}>
            <Text size="sm" c="dimmed">暂无项目</Text>
          </Center>
        ) : view === "grid" ? (
          <SimpleGrid cols={{ base: 1, sm: 3, lg: 4, xl: 5 }} spacing="lg">
            {shown.map((project) => (
              <Card key={project.id} className={styles.card} radius="md" padding={0} withBorder>
                <Box component={Link} href={`/canvas/${project.urlToken}`} target="_blank" rel="noopener" className={styles.mediaButton}>
                  <div className={`${styles.mediaFrame} ${styles.projectMediaFrame}`}>
                    <ProjectThumb project={project} />
                    {user?.inTeam && !isMine(project) && (
                      <Badge className={styles.badge} color="dark" variant="filled" leftSection={<Users size={12} />}>
                        团队
                      </Badge>
                    )}
                  </div>
                </Box>

                <Group p="sm" justify="space-between" wrap="nowrap" align="flex-start">
                  <Box flex={1} miw={0}>
                    <Text size="sm" fw={600} truncate>{displayProjectName(project.name)}</Text>
                    <Text size="xs" c="dimmed">{formatDateTime(project.updateTime)}</Text>
                  </Box>
                  <ProjectCardMenu project={project} onChanged={loadProjects} />
                </Group>
              </Card>
            ))}
          </SimpleGrid>
        ) : (
          <Stack gap={0}>
            {shown.map((project) => (
              <Group key={project.id} className={styles.listRow} wrap="nowrap">
                <Box component={Link} href={`/canvas/${project.urlToken}`} target="_blank" rel="noopener" className={`${styles.mediaButton} ${styles.listThumb}`}>
                  <ProjectThumb project={project} />
                </Box>

                <Box flex={1} miw={0}>
                  <Group gap={6} wrap="nowrap">
                    <Text size="sm" fw={600} truncate>{displayProjectName(project.name)}</Text>
                    {user?.inTeam && !isMine(project) && (
                      <Badge size="xs" variant="light" color="gray" leftSection={<Users size={11} />}>团队</Badge>
                    )}
                  </Group>
                  <Text size="xs" c="dimmed">{formatDateTime(project.updateTime)}</Text>
                </Box>

                <ProjectCardMenu project={project} onChanged={loadProjects} />
              </Group>
            ))}
          </Stack>
        )}
      </Box>
    </Box>
  );
}
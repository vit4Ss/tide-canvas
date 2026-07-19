"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Center,
  FileButton,
  Group,
  Image,
  LoadingOverlay,
  Modal,
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
import { ArrowUpDown, FileIcon, Film, Image as ImageIcon, LayoutGrid, List as ListIcon, Plus, Search, Trash2, Users } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { fileApi, uploadFileSmart } from "@/lib/api";
import { formatDate, formatFileSize } from "@/lib/utils";
import { toast } from "@/components/shared/toast";
import type { FileQuery, FileVO } from "@/types/file";
import { FileType } from "@/types/file";
import styles from "../library-page.module.css";

type AssetFilter = "all" | FileType;

const MIN_SKELETON_VISIBLE_MS = 650;

function waitForSkeleton(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

const TABS = [
  { value: "all", label: "全部", icon: LayoutGrid },
  { value: FileType.IMAGE, label: "图片", icon: ImageIcon },
  { value: FileType.VIDEO, label: "视频", icon: Film },
  { value: FileType.OTHER, label: "其他", icon: FileIcon },
] as const;

const typeIcons: Record<FileType, typeof ImageIcon> = {
  [FileType.IMAGE]: ImageIcon,
  [FileType.VIDEO]: Film,
  [FileType.OTHER]: FileIcon,
};

function FilterLabel({ icon: Icon, label }: { icon: typeof ImageIcon; label: string }) {
  return (
    <span className={styles.segmentedLabel}>
      <Icon size={15} strokeWidth={1.9} />
      {label}
    </span>
  );
}

function AssetMedia({ file }: { file: FileVO }) {
  const Icon = typeIcons[file.fileType] || FileIcon;

  if (file.fileType === FileType.IMAGE) {
    return <Image src={file.fileUrl} alt={file.originalName} className={styles.media} fit="cover" />;
  }

  if (file.fileType === FileType.VIDEO) {
    return <video src={file.fileUrl} muted className={styles.media} />;
  }

  return (
    <div className={styles.mediaFallback}>
      <ThemeIcon variant="light" color="gray" size={44} radius="md">
        <Icon size={22} />
      </ThemeIcon>
    </div>
  );
}

export default function UserAssetsPage() {
  const { user } = useAuth();
  const [files, setFiles] = useState<FileVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [filterType, setFilterType] = useState<AssetFilter>("all");
  const [search, setSearch] = useState("");
  const [sortDesc, setSortDesc] = useState(true);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [preview, setPreview] = useState<FileVO | null>(null);
  const uploadResetRef = useRef<() => void>(null);
  const hasLoadedRef = useRef(false);

  const loadFiles = async ({ silent = false }: { silent?: boolean } = {}) => {
    const startedAt = Date.now();
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fileApi.list({
        pageNum: 1,
        pageSize: 100,
        fileType: (filterType === "all" ? undefined : filterType) as FileQuery["fileType"],
      });
      if (res.success && res.data) setFiles(res.data.records);
    } finally {
      if (!silent) {
        const elapsed = Date.now() - startedAt;
        if (elapsed < MIN_SKELETON_VISIBLE_MS) await waitForSkeleton(MIN_SKELETON_VISIBLE_MS - elapsed);
      }
      hasLoadedRef.current = true;
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadFiles();
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterType]);

  const handleUploadFiles = async (picked: File[] | File | null) => {
    const fileList = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (fileList.length === 0) return;

    setUploading(true);
    let uploaded = 0;
    try {
      for (const file of fileList) {
        const res = await uploadFileSmart(file);
        if (res.success) uploaded++;
        else toast.error(res.message || `上传失败：${file.name}`);
      }
      if (uploaded > 0) toast.success(uploaded > 1 ? `已上传 ${uploaded} 个文件` : "文件已上传");
      await loadFiles({ silent: hasLoadedRef.current });
    } finally {
      setUploading(false);
      uploadResetRef.current?.();
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确定要删除该文件吗？")) return;
    const res = await fileApi.delete(id);
    if (res.success) {
      setFiles((prev) => prev.filter((f) => f.id !== id));
      if (preview?.id === id) setPreview(null);
    }
  };

  const shown = useMemo(() => {
    const kw = search.trim().toLowerCase();
    const list = files.filter((f) => !kw || f.originalName.toLowerCase().includes(kw));
    return [...list].sort((a, b) => {
      const ta = new Date(a.createTime).getTime();
      const tb = new Date(b.createTime).getTime();
      return sortDesc ? tb - ta : ta - tb;
    });
  }, [files, search, sortDesc]);

  const isMine = (file: FileVO) => !file.ownerId || file.ownerId === user?.id;

  const segmentData = useMemo(() => TABS.map((item) => ({
    value: item.value,
    label: <FilterLabel icon={item.icon} label={item.label} />,
  })), []);

  const handleFilterChange = (value: string) => {
    const nextFilter = value as AssetFilter;
    if (nextFilter === filterType) return;
    setLoading(true);
    setFilterType(nextFilter);
  };

  return (
    <Box className={styles.page}>
      <Group className={styles.header} justify="space-between">
        <Title order={1} size={28}>资产库</Title>
      </Group>

      <Group className={styles.toolbar} gap="md">
        <SegmentedControl
          value={filterType}
          onChange={handleFilterChange}
          data={segmentData}
          radius="md"
          size="sm"
          transitionDuration={0}
        />

        <Group className={styles.toolbarActions} gap="xs" wrap="wrap">
          <FileButton resetRef={uploadResetRef} onChange={handleUploadFiles} multiple accept="image/*,video/*" disabled={uploading}>
            {(props) => (
              <Button {...props} loading={uploading} leftSection={<Plus size={16} />} color="dark" radius="xl" size="sm">
                新增
              </Button>
            )}
          </FileButton>

          <TextInput
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="搜索素材"
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

      <Box className={styles.content} pos="relative">
        <LoadingOverlay visible={refreshing} zIndex={3} overlayProps={{ backgroundOpacity: 0, blur: 0 }} loaderProps={{ size: "sm", color: "dark" }} />
        {loading ? (
          <SimpleGrid cols={{ base: 1, sm: 3, lg: 4, xl: 5 }} spacing="lg">
            {Array.from({ length: 10 }).map((_, index) => (
              <Skeleton key={index} height={180} radius="md" />
            ))}
          </SimpleGrid>
        ) : shown.length === 0 ? (
          <Center className={styles.emptyState}>
            <Text size="sm" c="dimmed">暂无素材</Text>
          </Center>
        ) : view === "grid" ? (
          <SimpleGrid cols={{ base: 1, sm: 3, lg: 4, xl: 5 }} spacing="lg">
            {shown.map((file) => (
              <Card key={file.id} className={styles.card} radius="md" padding={0} withBorder>
                <button type="button" className={styles.mediaButton} onClick={() => setPreview(file)}>
                  <div className={styles.mediaFrame}>
                    <AssetMedia file={file} />
                    {user?.inTeam && !isMine(file) && (
                      <Badge className={styles.badge} color="dark" variant="filled" leftSection={<Users size={12} />}>
                        团队
                      </Badge>
                    )}
                  </div>
                </button>

                {isMine(file) && (
                  <ActionIcon
                    className={styles.deleteAction}
                    color="red"
                    variant="filled"
                    radius="md"
                    size={30}
                    onClick={() => handleDelete(file.id)}
                    aria-label="删除素材"
                  >
                    <Trash2 size={15} />
                  </ActionIcon>
                )}

                <Stack gap={2} p="sm">
                  <Text size="sm" fw={600} truncate>{file.originalName}</Text>
                  <Text size="xs" c="dimmed">{formatDate(file.createTime)}</Text>
                </Stack>
              </Card>
            ))}
          </SimpleGrid>
        ) : (
          <Stack gap={0}>
            {shown.map((file) => {
              const Icon = typeIcons[file.fileType] || FileIcon;
              return (
                <Group key={file.id} className={styles.listRow} wrap="nowrap">
                  <button type="button" className={`${styles.mediaButton} ${styles.listThumb} ${styles.assetListThumb}`} onClick={() => setPreview(file)}>
                    {file.fileType === FileType.IMAGE || file.fileType === FileType.VIDEO ? (
                      <AssetMedia file={file} />
                    ) : (
                      <Center h="100%"><Icon size={20} color="var(--mantine-color-gray-4)" /></Center>
                    )}
                  </button>
                  <Box flex={1} miw={0}>
                    <Text size="sm" fw={600} truncate>{file.originalName}</Text>
                    <Text size="xs" c="dimmed">{formatDate(file.createTime)} · {formatFileSize(file.fileSize)}</Text>
                  </Box>
                  {isMine(file) && (
                    <ActionIcon variant="subtle" color="red" onClick={() => handleDelete(file.id)} aria-label="删除素材">
                      <Trash2 size={16} />
                    </ActionIcon>
                  )}
                </Group>
              );
            })}
          </Stack>
        )}
      </Box>

      <Modal opened={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.originalName || "素材预览"} centered size="auto" overlayProps={{ backgroundOpacity: 0.55, blur: 2 }}>
        {preview?.fileType === FileType.IMAGE ? (
          <Image src={preview.fileUrl} alt={preview.originalName} className={styles.previewImage} fit="contain" />
        ) : preview?.fileType === FileType.VIDEO ? (
          <video src={preview.fileUrl} controls className={styles.previewVideo} />
        ) : preview ? (
          <Stack className={styles.filePreviewFallback} align="center" gap="sm" py="xl">
            <ThemeIcon variant="light" color="gray" size={64} radius="md"><FileIcon size={30} /></ThemeIcon>
            <Text fw={600}>{preview.originalName}</Text>
            <Text size="sm" c="dimmed">{formatFileSize(preview.fileSize)}</Text>
          </Stack>
        ) : null}
      </Modal>
    </Box>
  );
}
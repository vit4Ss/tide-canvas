"use client";

import { useCallback, useState } from "react";
import { Group, Text, TextInput, UnstyledButton } from "@mantine/core";
import { Image as ImageIcon, Mountain, UserRound } from "lucide-react";
import { CHARACTER_NODE_TYPE, SCENE_NODE_TYPE } from "@/lib/canvas-node-types";
import { useCanvasStore } from "@/stores/use-canvas-store";
import type { CanvasNode } from "../../../domain/models/canvas-document";

export function EditableImageNodeTitle({ node }: { node: CanvasNode }) {
  const updateNode = useCanvasStore((state) => state.updateNode);
  const presentation = node.type === CHARACTER_NODE_TYPE
    ? { fallbackTitle: "角色节点", renameTitle: "双击重命名角色节点", Icon: UserRound }
    : node.type === SCENE_NODE_TYPE
      ? { fallbackTitle: "场景节点", renameTitle: "双击重命名场景节点", Icon: Mountain }
      : { fallbackTitle: "图片节点", renameTitle: "双击重命名图片节点", Icon: ImageIcon };
  const currentTitle = node.title?.trim() || presentation.fallbackTitle;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentTitle);

  const startEdit = useCallback((event: React.MouseEvent): void => {
    event.stopPropagation();
    setDraft(currentTitle);
    setEditing(true);
  }, [currentTitle]);

  const commit = useCallback((): void => {
    const nextTitle = draft.trim() || presentation.fallbackTitle;
    if (nextTitle !== node.title) updateNode(node.id, { title: nextTitle }, true);
    setEditing(false);
  }, [draft, node.id, node.title, presentation.fallbackTitle, updateNode]);

  const cancel = useCallback((): void => {
    setDraft(currentTitle);
    setEditing(false);
  }, [currentTitle]);

  if (editing) {
    return (
      <Group gap={4} wrap="nowrap" px={4} c="dimmed">
        <presentation.Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <TextInput
          autoFocus
          value={draft}
          onFocus={(event) => event.currentTarget.select()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
          size="xs"
          variant="unstyled"
          styles={{
            root: { width: 176 },
            input: {
              minHeight: 22,
              height: 22,
              paddingInline: 6,
              border: "1px solid var(--mantine-color-gray-4)",
              borderRadius: 5,
              background: "var(--mantine-color-white)",
              fontSize: 12,
              fontWeight: 500,
              lineHeight: "20px",
            },
          }}
        />
      </Group>
    );
  }

  return (
    <Group gap={4} wrap="nowrap" px={4} c="dimmed">
      <presentation.Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <UnstyledButton
        onMouseDown={(event) => event.stopPropagation()}
        onDoubleClick={startEdit}
        title={presentation.renameTitle}
        px={4}
        py={2}
        style={{ maxWidth: 180, borderRadius: 5 }}
      >
        <Text size="12px" fw={500} truncate c="dimmed">{currentTitle}</Text>
      </UnstyledButton>
    </Group>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GripVertical, RefreshCw } from "lucide-react";
import {
  AdminAlert,
  AdminEmptyState,
  AdminModal,
  FormCard,
  ListSkeleton,
  Panel,
  StatusPill,
  SwitchToggle,
} from "@/components/admin";
import { toast } from "@/components/shared/toast";
import { adminCanvasNodesApi } from "@/lib/admin-canvas-nodes-api";
import { useAuthStore } from "@/stores/use-auth-store";
import type {
  AdminCanvasNodeConfigVO,
  AdminCanvasNodeFeatureVO,
} from "@/types/admin-canvas-nodes";
import type {
  CanvasNodeFeatureKey,
  CanvasNodeRenderer,
  CanvasNodeTypeConfigVO,
} from "@/types/canvas-node-config";

const RENDERER_LABELS: Record<CanvasNodeRenderer, string> = {
  image: "图像",
  video: "视频",
  "3d": "3D 模型",
  scene_3d: "3D 场景",
  text: "文本",
  audio: "音频",
  script: "剧本",
};

const FEATURE_GROUP_LABELS: Record<string, string> = {
  skill: "Skill",
  image: "图像",
  media: "媒体",
  tool: "增强工具",
};

function orderNodes(nodes: CanvasNodeTypeConfigVO[]): CanvasNodeTypeConfigVO[] {
  return [...nodes]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))
    .map((node, index) => ({ ...node, sortOrder: index }));
}

export default function AdminCanvasNodesPage() {
  const ensureSession = useAuthStore((state) => state.ensureSession);
  const [version, setVersion] = useState<number | null>(null);
  const [nodes, setNodes] = useState<CanvasNodeTypeConfigVO[]>([]);
  const [catalog, setCatalog] = useState<AdminCanvasNodeFeatureVO[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const loadSeqRef = useRef(0);
  const [error, setError] = useState<string | null>(null);

  const acceptDocument = useCallback((document: AdminCanvasNodeConfigVO) => {
    setVersion(document.version);
    setNodes(orderNodes(document.nodeTypes));
    setCatalog(document.featureCatalog);
  }, []);

  const load = useCallback(async () => {
    const loadSeq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      await ensureSession();
      const response = await adminCanvasNodesApi.list();
      if (loadSeq !== loadSeqRef.current) return;
      if (response.success && response.data) {
        acceptDocument(response.data);
      } else {
        setError(response.message || "节点配置加载失败");
      }
    } catch {
      if (loadSeq === loadSeqRef.current) setError("节点配置加载失败，请稍后重试");
    } finally {
      if (loadSeq === loadSeqRef.current) setLoading(false);
    }
  }, [acceptDocument, ensureSession]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => {
      cancelAnimationFrame(frame);
      loadSeqRef.current += 1;
    };
  }, [load]);

  const persist = useCallback(
    async (nextNodes: CanvasNodeTypeConfigVO[]): Promise<boolean> => {
      if (savingRef.current || version == null) return false;

      const previous = nodes;
      const ordered = orderNodes(nextNodes);
      // A delayed load response must not overwrite this newer edit.
      loadSeqRef.current += 1;
      savingRef.current = true;
      setNodes(ordered);
      setSaving(true);
      try {
        const response = await adminCanvasNodesApi.update({
          version,
          nodeTypes: ordered.map((node) => ({
            key: node.key,
            enabled: node.enabled,
            sortOrder: node.sortOrder,
            features: node.features,
          })),
        });
        if (response.success && response.data) {
          acceptDocument(response.data);
          return true;
        }
        setNodes(previous);
        toast.error(response.message || "节点配置保存失败");
        return false;
      } catch {
        setNodes(previous);
        toast.error("节点配置保存失败，请稍后重试");
        return false;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [acceptDocument, nodes, version],
  );

  const moveNode = (from: number, direction: -1 | 1) => {
    if (saving) return;
    const to = from + direction;
    if (to < 0 || to >= nodes.length) return;
    const next = [...nodes];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void persist(next);
  };

  const toggleNode = (node: CanvasNodeTypeConfigVO, enabled: boolean) => {
    if (saving) return;
    void persist(nodes.map((item) => (item.key === node.key ? { ...item, enabled } : item)));
  };

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const dragFromHandle = useRef(false);

  const endDrag = () => {
    dragFromHandle.current = false;
    setDragIndex(null);
    setOverIndex(null);
  };

  useEffect(() => {
    const releaseHandle = () => {
      dragFromHandle.current = false;
    };
    window.addEventListener("mouseup", releaseHandle);
    return () => window.removeEventListener("mouseup", releaseHandle);
  }, []);

  const dropNode = (to: number) => {
    const from = dragIndex;
    endDrag();
    if (from == null || from === to || saving) return;
    const next = [...nodes];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void persist(next);
  };

  const editing = editingKey ? nodes.find((node) => node.key === editingKey) ?? null : null;

  return (
    <div className="adm-page">
      <Panel
        title="节点配置"
        sub={`${nodes.length} 个已注册节点类型 · 排序决定新增节点菜单的展示顺序`}
      >
        <div style={{ padding: "16px 18px" }} aria-busy={loading || saving}>
          <AdminAlert tone="info" title="节点与功能由代码注册">
            此处只配置启用状态、展示顺序和顶部功能组合，不支持任意新增或删除。关闭节点只会从新增入口隐藏，不影响画布中已经存在的节点。
          </AdminAlert>

          <div style={{ height: 12 }} aria-hidden />

          {loading ? (
            <ListSkeleton rows={6} height={64} />
          ) : error ? (
            <AdminAlert
              tone="error"
              title="节点配置加载失败"
              action={
                <button type="button" className="adm-btn ghost" onClick={load}>
                  <RefreshCw aria-hidden size={14} />
                  重新加载
                </button>
              }
            >
              {error}
            </AdminAlert>
          ) : nodes.length === 0 ? (
            <AdminEmptyState
              title="暂无已注册节点类型"
              description="服务端完成节点注册后会显示在这里。"
            />
          ) : (
            nodes.map((node, index) => (
              <div
                className={`floor${dragIndex === index ? " dragging" : ""}${
                  overIndex === index && dragIndex != null && dragIndex !== index
                    ? " drop-hint"
                    : ""
                }`}
                data-floor={node.key}
                key={node.key}
                draggable={!saving}
                onDragStart={(event) => {
                  if (!dragFromHandle.current) {
                    event.preventDefault();
                    return;
                  }
                  setDragIndex(index);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => {
                  if (dragIndex == null) return;
                  event.preventDefault();
                  setOverIndex(index);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  dropNode(index);
                }}
                onDragEnd={endDrag}
              >
                <span
                  className="grab"
                  onMouseDown={() => {
                    dragFromHandle.current = true;
                  }}
                  onMouseUp={() => {
                    dragFromHandle.current = false;
                  }}
                  title={`拖动调整 ${node.title} 顺序`}
                  aria-hidden="true"
                >
                  <GripVertical size={16} strokeWidth={1.8} />
                </span>
                <span className="ix">{index + 1}</span>
                <div>
                  <div className="nm">{node.title}</div>
                  <div className="meta">
                    {node.description || "暂无说明"} · {node.key} · {node.features.length} 项顶部功能
                  </div>
                </div>
                <div className="sp" />
                <StatusPill tone="blue">
                  {RENDERER_LABELS[node.renderer] ?? node.renderer}
                </StatusPill>
                <SwitchToggle
                  checked={node.enabled}
                  onChange={(next) => toggleNode(node, next)}
                  aria-label={`${node.title} 新增入口启用`}
                />
                <div className="rowacts">
                  <button
                    type="button"
                    disabled={saving || index === 0}
                    onClick={() => moveNode(index, -1)}
                  >
                    上移
                  </button>
                  <button
                    type="button"
                    disabled={saving || index === nodes.length - 1}
                    onClick={() => moveNode(index, 1)}
                  >
                    下移
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setEditingKey(node.key)}
                  >
                    编辑功能
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </Panel>

      {editing ? (
        <NodeFeatureModal
          key={editing.key}
          node={editing}
          catalog={catalog}
          onClose={() => setEditingKey(null)}
          onSave={(features) =>
            persist(
              nodes.map((node) =>
                node.key === editing.key ? { ...node, features } : node,
              ),
            )
          }
        />
      ) : null}
    </div>
  );
}

function NodeFeatureModal({
  node,
  catalog,
  onClose,
  onSave,
}: {
  node: CanvasNodeTypeConfigVO;
  catalog: AdminCanvasNodeFeatureVO[];
  onClose: () => void;
  onSave: (features: CanvasNodeFeatureKey[]) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState<CanvasNodeFeatureKey[]>([...node.features]);

  const featureByKey = useMemo(
    () => new Map(catalog.map((feature) => [feature.key, feature])),
    [catalog],
  );
  const available = useMemo(() => {
    const selectedSet = new Set(selected);
    return catalog.filter(
      (feature) =>
        feature.supportedRenderers.includes(node.renderer) && !selectedSet.has(feature.key),
    );
  }, [catalog, node.renderer, selected]);

  const removeFeature = (key: CanvasNodeFeatureKey) => {
    setSelected((current) => current.filter((item) => item !== key));
  };

  const addFeature = (key: CanvasNodeFeatureKey) => {
    setSelected((current) => (current.includes(key) ? current : [...current, key]));
  };

  const moveFeature = (from: number, direction: -1 | 1) => {
    const to = from + direction;
    if (to < 0 || to >= selected.length) return;
    setSelected((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  return (
    <AdminModal
      open
      size="lg"
      title={`编辑节点功能 · ${node.title}`}
      subtitle={`${node.key} · ${RENDERER_LABELS[node.renderer] ?? node.renderer} 渲染器（代码注册，不可修改）`}
      footNote="功能顺序即节点顶部工具栏顺序；空列表会隐藏全部顶部功能"
      onClose={onClose}
      onSave={() => onSave(selected)}
    >
      <FormCard title={`已启用功能（${selected.length}）`}>
        <p className="muted" style={{ margin: "0 0 12px", fontSize: 12 }}>
          使用上移、下移调整显示顺序。关闭最后一项后仍可正常保存为空列表。
        </p>
        {selected.length === 0 ? (
          <div
            className="muted"
            style={{ padding: "20px 12px", textAlign: "center", fontSize: 12 }}
          >
            当前不显示任何顶部功能
          </div>
        ) : (
          selected.map((key, index) => {
            const feature = featureByKey.get(key);
            return (
              <FeatureRow
                key={key}
                index={index}
                feature={feature}
                fallbackKey={key}
                checked
                onToggle={() => removeFeature(key)}
                actions={
                  <>
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => moveFeature(index, -1)}
                    >
                      上移
                    </button>
                    <button
                      type="button"
                      disabled={index === selected.length - 1}
                      onClick={() => moveFeature(index, 1)}
                    >
                      下移
                    </button>
                  </>
                }
              />
            );
          })
        )}
      </FormCard>

      <FormCard title={`可用功能（${available.length}）`}>
        <p className="muted" style={{ margin: "0 0 12px", fontSize: 12 }}>
          这里只列出当前渲染器已经实现的功能。开启后会追加到已启用功能末尾。
        </p>
        {available.length === 0 ? (
          <div
            className="muted"
            style={{ padding: "20px 12px", textAlign: "center", fontSize: 12 }}
          >
            没有更多可添加功能
          </div>
        ) : (
          available.map((feature, index) => (
            <FeatureRow
              key={feature.key}
              index={index}
              feature={feature}
              fallbackKey={feature.key}
              checked={false}
              onToggle={() => addFeature(feature.key)}
            />
          ))
        )}
      </FormCard>
    </AdminModal>
  );
}

function FeatureRow({
  index,
  feature,
  fallbackKey,
  checked,
  onToggle,
  actions,
}: {
  index: number;
  feature?: AdminCanvasNodeFeatureVO;
  fallbackKey: CanvasNodeFeatureKey;
  checked: boolean;
  onToggle: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <div className="floor">
      <span className="ix">{index + 1}</span>
      <div>
        <div className="nm">{feature?.title ?? fallbackKey}</div>
        <div className="meta">
          {feature
            ? `${FEATURE_GROUP_LABELS[feature.group] || feature.group || "通用"} · ${feature.description || feature.key}`
            : `未在当前功能目录中登记 · ${fallbackKey}`}
        </div>
      </div>
      <div className="sp" />
      <SwitchToggle
        checked={checked}
        onChange={onToggle}
        aria-label={`${feature?.title ?? fallbackKey} 顶部功能启用`}
      />
      {actions ? <div className="rowacts">{actions}</div> : null}
    </div>
  );
}

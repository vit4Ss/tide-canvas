"use client";

import { useEffect, useState } from "react";
import { Table, Input, Segmented, Tag, Button, Space, Alert, Image as AntdImage, Popconfirm } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DownloadOutlined, DeleteOutlined, FileOutlined, HddOutlined } from "@ant-design/icons";
import { http, toParams } from "@/lib/http";
import { useHasPerm } from "@/stores/use-permission-store";
import { AdminPageHead } from "@/components/admin/page-head";
import { formatDate } from "@/lib/utils";
import type { PageData } from "@/types/api";
import type { FileVO } from "@/types/file";

const PAGE_SIZE = 15;

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + " " + units[i];
}

const TYPE_TAG: Record<string, { label: string; color: string }> = {
  image: { label: "图片", color: "blue" },
  video: { label: "视频", color: "purple" },
  other: { label: "其他", color: "default" },
};

export default function AdminFilesPage() {
  const can = useHasPerm();
  const [files, setFiles] = useState<FileVO[]>([]);
  const [total, setTotal] = useState(0);
  const [totalStorageUsed, setTotalStorageUsed] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [fileType, setFileType] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [error, setError] = useState("");

  const loadFiles = async (page = pageNum, search = keyword, type = fileType) => {
    setLoading(true);
    setError("");
    try {
      const params = toParams({ pageNum: page, pageSize: PAGE_SIZE, keyword: search || undefined, fileType: type || undefined });
      const res = await http.get<PageData<FileVO>>("/api/admin/files", params);
      if (res.success && res.data) {
        const data = res.data as unknown as PageData<FileVO>;
        setFiles(data.records);
        setTotal(data.total);
        const storageSum = data.records.reduce((sum, f) => sum + (f.fileSize || 0), 0);
        setTotalStorageUsed((prev) => (page === 1 ? storageSum : prev));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载文件列表失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadFiles(1); }, []);

  const handleDelete = async (id: number) => {
    setDeleting(id);
    try {
      const res = await http.delete<void>(`/api/admin/files/${id}`);
      if (res.success) loadFiles();
    } finally {
      setDeleting(null);
    }
  };

  const isImage = (f: FileVO) => f.fileType === "image" || f.mimeType?.startsWith("image/");

  const columns: ColumnsType<FileVO> = [
    {
      title: "文件名", key: "name", render: (_, f) => (
        <Space>
          {isImage(f) && f.fileUrl
            ? <AntdImage src={f.fileUrl} alt={f.originalName} width={32} height={32} style={{ objectFit: "cover", borderRadius: 4 }} />
            : <span style={{ width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "#f5f5f5", borderRadius: 4 }}><FileOutlined style={{ color: "#bfbfbf" }} /></span>}
          <span style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }} title={f.originalName}>{f.originalName}</span>
        </Space>
      ),
    },
    { title: "类型", dataIndex: "fileType", key: "fileType", render: (t: string) => { const tag = TYPE_TAG[t] ?? TYPE_TAG.other; return <Tag color={tag.color}>{tag.label}</Tag>; } },
    { title: "大小", dataIndex: "fileSize", key: "fileSize", render: (v: number) => <span style={{ color: "var(--ant-color-text-secondary, #8c8c8c)" }}>{formatFileSize(v)}</span> },
    { title: "存储", dataIndex: "storageType", key: "storageType", responsive: ["md"], render: (v) => <Tag>{v ?? "local"}</Tag> },
    { title: "上传时间", dataIndex: "createTime", key: "createTime", responsive: ["lg"], render: (v: string) => v ? formatDate(v) : "-" },
    {
      title: "操作", key: "action", render: (_, f) => (
        <Space size={0}>
          {f.fileUrl && <Button type="text" size="small" icon={<DownloadOutlined />} href={f.fileUrl} target="_blank" title="下载" />}
          {can("file:delete") && (
            <Popconfirm title="确定删除该文件？此操作不可撤销。" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => handleDelete(f.id)}>
              <Button type="text" size="small" danger icon={<DeleteOutlined />} loading={deleting === f.id} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdminPageHead
        title="文件管理"
        desc={`共 ${total} 个文件`}
        extra={<Tag icon={<HddOutlined />} style={{ padding: "4px 10px", fontSize: 13 }}>本页已用 {formatFileSize(totalStorageUsed)}</Tag>}
      />
      {error && <Alert type="error" message={error} showIcon closable onClose={() => setError("")} />}

      <Space wrap>
        <Input.Search placeholder="搜索文件名..." allowClear enterButton style={{ width: 260 }}
          onSearch={(v) => { setKeyword(v); setPageNum(1); loadFiles(1, v, fileType); }} />
        <Segmented
          value={fileType}
          options={[{ label: "全部", value: "" }, { label: "图片", value: "image" }, { label: "视频", value: "video" }, { label: "其他", value: "other" }]}
          onChange={(v) => { const t = String(v); setFileType(t); setPageNum(1); loadFiles(1, keyword, t); }}
        />
      </Space>

      <Table<FileVO>
        rowKey="id"
        columns={columns}
        dataSource={files}
        loading={loading}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: "暂无文件数据" }}
        pagination={{ current: pageNum, pageSize: PAGE_SIZE, total, showSizeChanger: false, showTotal: (t) => `共 ${t} 条`, onChange: (p) => { setPageNum(p); loadFiles(p); } }}
      />
    </div>
  );
}

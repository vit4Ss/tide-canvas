"use client";

import { useEffect, useState } from "react";
import { Card, Col, Row, Statistic, Table, Empty, Alert } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  Users, Zap, FolderOpen, HardDrive, UserPlus, Activity,
} from "lucide-react";
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
  BarChart, Bar,
  AreaChart, Area,
} from "recharts";
import { adminApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import type { DashboardOverviewVO, DashboardChartsVO, LogVO } from "@/types/admin";

const CHART_COLORS = ["#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444", "#10b981", "#6b7280"];

export default function AdminDashboardPage() {
  const [overview, setOverview] = useState<DashboardOverviewVO | null>(null);
  const [charts, setCharts] = useState<DashboardChartsVO | null>(null);
  const [logs, setLogs] = useState<LogVO[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      adminApi.dashboard.overview()
        .then((res) => { if (res.success) setOverview(res.data); })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : "加载数据概览失败"));
      adminApi.dashboard.charts()
        .then((res) => { if (res.success) setCharts(res.data); })
        .catch(() => {});
      adminApi.logs.list({ pageNum: 1, pageSize: 5 })
        .then((res) => { if (res.success && res.data) setLogs(res.data.records); })
        .catch(() => {});
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const userTrendData = (charts?.userTrend ?? []).map((d) => ({ date: d.date, 新增: Number(d.newUsers), 活跃: Number(d.activeUsers) }));
  const dailyCreationData = (charts?.dailyCreation ?? []).map((d) => ({ date: d.date, 项目: Number(d.projects), AI调用: Number(d.aiCalls) }));
  const aiDistributionData = (charts?.aiDistribution ?? []).map((d, i) => ({ name: d.name, value: Number(d.value), color: CHART_COLORS[i % CHART_COLORS.length] }));
  const modelUsageData = (charts?.modelUsage ?? []).map((d) => ({ name: d.name, 调用次数: Number(d.value) }));

  const cards = [
    { title: "用户总数", value: overview?.totalUsers ?? 0, today: overview?.todayNewUsers, icon: <Users size={18} />, color: "#2563eb" },
    { title: "今日新增", value: overview?.todayNewUsers ?? 0, today: undefined, icon: <UserPlus size={18} />, color: "#16a34a" },
    { title: "活跃用户", value: overview?.activeUsers ?? 0, today: undefined, icon: <Activity size={18} />, color: "#9333ea" },
    { title: "API 调用", value: overview?.totalApiCalls ?? 0, today: overview?.todayApiCalls, icon: <Zap size={18} />, color: "#d97706" },
    { title: "项目总数", value: overview?.totalProjects ?? 0, today: overview?.todayNewProjects, icon: <FolderOpen size={18} />, color: "#e11d48" },
    { title: "存储使用", value: overview?.totalStorageBytes ? `${(overview.totalStorageBytes / 1073741824).toFixed(1)} GB` : "0 GB", today: undefined, icon: <HardDrive size={18} />, color: "#0891b2" },
  ];

  const logColumns: ColumnsType<LogVO> = [
    { title: "用户", dataIndex: "username", key: "username", render: (v: string) => v || "-" },
    { title: "操作", dataIndex: "action", key: "action" },
    { title: "目标", dataIndex: "target", key: "target", render: (v: string) => v || "-" },
    { title: "时间", dataIndex: "createTime", key: "createTime", render: (v: string) => formatDate(v) },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>数据面板</h2>
        <p style={{ marginTop: 4, color: "#8c8c8c", fontSize: 14 }}>平台整体运营数据概览</p>
      </div>

      {error && <Alert type="error" message={error} showIcon />}

      {/* 概览卡片 */}
      <Row gutter={[16, 16]}>
        {cards.map((card) => (
          <Col key={card.title} xs={24} sm={12} lg={8}>
            <Card>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Statistic title={card.title} value={card.value} />
                <span style={{ display: "inline-flex", height: 44, width: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, background: `${card.color}14`, color: card.color }}>
                  {card.icon}
                </span>
              </div>
              {card.today !== undefined && (
                <div style={{ marginTop: 8, fontSize: 13, color: "#16a34a", fontWeight: 500 }}>今日 +{card.today}</div>
              )}
            </Card>
          </Col>
        ))}
      </Row>

      {/* 图表第一行 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="用户增长趋势" extra={<span style={{ fontSize: 12, color: "#bfbfbf" }}>近 7 天</span>}>
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={userTrendData}>
                  <defs>
                    <linearGradient id="colorActive" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorNew" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#999" />
                  <YAxis tick={{ fontSize: 12 }} stroke="#999" allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e5e5", fontSize: 13 }} />
                  <Area type="monotone" dataKey="活跃" stroke="#3b82f6" fill="url(#colorActive)" strokeWidth={2} />
                  <Area type="monotone" dataKey="新增" stroke="#10b981" fill="url(#colorNew)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="AI 调用分布" extra={<span style={{ fontSize: 12, color: "#bfbfbf" }}>各 Handler 占比</span>}>
            <div style={{ height: 260 }}>
              {aiDistributionData.length === 0 ? (
                <Empty description="暂无调用数据" style={{ paddingTop: 60 }} />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={aiDistributionData}
                      cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value"
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      label={({ name, percent }: any) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                      style={{ fontSize: 11 }}
                    >
                      {aiDistributionData.map((entry, index) => <Cell key={index} fill={entry.color} />)}
                    </Pie>
                    <Tooltip formatter={(value) => [`${value} 次`, "调用次数"]} contentStyle={{ borderRadius: 8, fontSize: 13 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
        </Col>
      </Row>

      {/* 图表第二行 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="每日创作量" extra={<span style={{ fontSize: 12, color: "#bfbfbf" }}>项目 / AI 调用</span>}>
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyCreationData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#999" />
                  <YAxis yAxisId="left" tick={{ fontSize: 12 }} stroke="#999" allowDecimals={false} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} stroke="#999" allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e5e5", fontSize: 13 }} />
                  <Bar yAxisId="left" dataKey="项目" fill="#8b5cf6" radius={[4, 4, 0, 0]} barSize={20} />
                  <Bar yAxisId="right" dataKey="AI调用" fill="#f59e0b" radius={[4, 4, 0, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="模型使用排行" extra={<span style={{ fontSize: 12, color: "#bfbfbf" }}>Top 5</span>}>
            <div style={{ height: 260 }}>
              {modelUsageData.length === 0 ? (
                <Empty description="暂无调用数据" style={{ paddingTop: 60 }} />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={modelUsageData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 12 }} stroke="#999" allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="#999" width={100} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e5e5", fontSize: 13 }} />
                    <Bar dataKey="调用次数" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={18}>
                      {modelUsageData.map((_, index) => <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
        </Col>
      </Row>

      {/* 最近操作日志 */}
      <Card title="最近操作日志">
        <Table<LogVO>
          rowKey="id"
          columns={logColumns}
          dataSource={logs}
          pagination={false}
          size="middle"
          locale={{ emptyText: "暂无操作记录" }}
        />
      </Card>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import type { DashboardOverviewVO, DashboardChartsVO, LogVO } from "@/types/admin";
import {
  Users,
  Zap,
  FolderOpen,
  HardDrive,
  UserPlus,
  Activity,
} from "lucide-react";
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  BarChart, Bar,
  AreaChart, Area,
} from "recharts";

/** 饼图/条形图配色(按序取色) */
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

  // recharts 中文图例键由真实数据映射而来;后端 Long 全局序列化为字符串,这里统一转 number
  const userTrendData = (charts?.userTrend ?? []).map((d) => ({ date: d.date, 新增: Number(d.newUsers), 活跃: Number(d.activeUsers) }));
  const dailyCreationData = (charts?.dailyCreation ?? []).map((d) => ({ date: d.date, 项目: Number(d.projects), AI调用: Number(d.aiCalls) }));
  const aiDistributionData = (charts?.aiDistribution ?? []).map((d, i) => ({ name: d.name, value: Number(d.value), color: CHART_COLORS[i % CHART_COLORS.length] }));
  const modelUsageData = (charts?.modelUsage ?? []).map((d) => ({ name: d.name, 调用次数: Number(d.value) }));

  const cards = [
    { title: "用户总数", value: overview?.totalUsers ?? 0, today: overview?.todayNewUsers, icon: Users, color: "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400" },
    { title: "今日新增", value: overview?.todayNewUsers ?? 0, today: undefined, icon: UserPlus, color: "bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400" },
    { title: "活跃用户", value: overview?.activeUsers ?? 0, today: undefined, icon: Activity, color: "bg-purple-50 text-purple-600 dark:bg-purple-950 dark:text-purple-400" },
    { title: "API 调用", value: overview?.totalApiCalls ?? 0, today: overview?.todayApiCalls, icon: Zap, color: "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400" },
    { title: "项目总数", value: overview?.totalProjects ?? 0, today: overview?.todayNewProjects, icon: FolderOpen, color: "bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-400" },
    { title: "存储使用", value: overview?.totalStorageBytes ? `${(overview.totalStorageBytes / 1073741824).toFixed(1)} GB` : "0 GB", today: undefined, icon: HardDrive, color: "bg-cyan-50 text-cyan-600 dark:bg-cyan-950 dark:text-cyan-400" },
  ];

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}
      <div>
        <h2 className="text-2xl font-bold">数据面板</h2>
        <p className="mt-1 text-sm text-neutral-500">平台整体运营数据概览</p>
      </div>

      {/* 概览卡片 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <div key={card.title} className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-neutral-500">{card.title}</p>
                <p className="mt-1 text-2xl font-bold">{card.value}</p>
              </div>
              <div className={`rounded-xl p-3 ${card.color}`}>
                <card.icon className="h-5 w-5" />
              </div>
            </div>
            {card.today !== undefined && (
              <div className="mt-3 flex items-center gap-1 text-sm">
                <span className="font-medium text-green-600">今日 +{card.today}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 图表区域 - 第一行 */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* 用户增长趋势 - 面积折线图 */}
        <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
          <h3 className="font-semibold">用户增长趋势</h3>
          <p className="mt-1 text-xs text-neutral-400">近 7 天新增用户与活跃用户</p>
          <div className="mt-4 h-64">
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
        </div>

        {/* AI 调用分布 - 饼图 */}
        <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
          <h3 className="font-semibold">AI 调用分布</h3>
          <p className="mt-1 text-xs text-neutral-400">各 Handler 调用占比</p>
          <div className="mt-4 h-64">
            {aiDistributionData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-neutral-400">暂无调用数据</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={aiDistributionData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    label={({ name, percent }: any) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                    labelLine={{ strokeWidth: 1 }}
                    style={{ fontSize: 11 }}
                  >
                    {aiDistributionData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => [`${value} 次`, "调用次数"]} contentStyle={{ borderRadius: 8, fontSize: 13 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* 图表区域 - 第二行 */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* 每日创作量 - 柱状图 */}
        <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
          <h3 className="font-semibold">每日创作量</h3>
          <p className="mt-1 text-xs text-neutral-400">项目创建数与 AI 调用次数</p>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyCreationData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#999" />
                <YAxis yAxisId="left" tick={{ fontSize: 12 }} stroke="#999" allowDecimals={false} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} stroke="#999" allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e5e5", fontSize: 13 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="left" dataKey="项目" fill="#8b5cf6" radius={[4, 4, 0, 0]} barSize={20} />
                <Bar yAxisId="right" dataKey="AI调用" fill="#f59e0b" radius={[4, 4, 0, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 模型使用排行 - 横向条形图 */}
        <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
          <h3 className="font-semibold">模型使用排行</h3>
          <p className="mt-1 text-xs text-neutral-400">Top 5 最常用模型</p>
          <div className="mt-4 h-64">
            {modelUsageData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-neutral-400">暂无调用数据</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={modelUsageData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} stroke="#999" allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="#999" width={100} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e5e5", fontSize: 13 }} />
                  <Bar dataKey="调用次数" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={18}>
                    {modelUsageData.map((_, index) => (
                      <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* 最近操作日志 */}
      <div className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h3 className="font-semibold">最近操作日志</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-neutral-500 dark:border-neutral-800">
                <th className="px-5 py-3 font-medium">用户</th>
                <th className="px-5 py-3 font-medium">操作</th>
                <th className="px-5 py-3 font-medium">目标</th>
                <th className="px-5 py-3 font-medium">时间</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-neutral-400">暂无操作记录</td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="border-b border-neutral-50 last:border-0 dark:border-neutral-900">
                    <td className="px-5 py-3 font-medium">{log.username || "-"}</td>
                    <td className="px-5 py-3">{log.action}</td>
                    <td className="px-5 py-3 text-neutral-500">{log.target || "-"}</td>
                    <td className="px-5 py-3 text-neutral-400">{formatDate(log.createTime)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

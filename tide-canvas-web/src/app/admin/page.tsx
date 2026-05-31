"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import type { DashboardOverviewVO } from "@/types/admin";
import {
  Users,
  Zap,
  FolderOpen,
  HardDrive,
  TrendingUp,
  UserPlus,
  Activity,
  Coins,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  BarChart, Bar,
  AreaChart, Area,
} from "recharts";

const userTrendData = [
  { date: "05/21", 新增: 12, 活跃: 320 },
  { date: "05/22", 新增: 18, 活跃: 345 },
  { date: "05/23", 新增: 15, 活跃: 360 },
  { date: "05/24", 新增: 22, 活跃: 390 },
  { date: "05/25", 新增: 28, 活跃: 420 },
  { date: "05/26", 新增: 20, 活跃: 438 },
  { date: "05/27", 新增: 23, 活跃: 456 },
];

const aiDistributionData = [
  { name: "文生图", value: 4520, color: "#3b82f6" },
  { name: "图生图", value: 2830, color: "#8b5cf6" },
  { name: "文生视频", value: 1960, color: "#f59e0b" },
  { name: "创意描述", value: 1540, color: "#ef4444" },
  { name: "图生视频", value: 1200, color: "#10b981" },
  { name: "其他", value: 797, color: "#6b7280" },
];

const dailyCreationData = [
  { date: "05/21", 项目: 45, AI调用: 1820 },
  { date: "05/22", 项目: 52, AI调用: 2040 },
  { date: "05/23", 项目: 48, AI调用: 1930 },
  { date: "05/24", 项目: 61, AI调用: 2250 },
  { date: "05/25", 项目: 55, AI调用: 2100 },
  { date: "05/26", 项目: 42, AI调用: 1760 },
  { date: "05/27", 项目: 58, AI调用: 2150 },
];

const modelUsageData = [
  { name: "Gemini 3 Pro", 调用次数: 3200 },
  { name: "Flux Kontext", 调用次数: 2100 },
  { name: "Doubao Seed", 调用次数: 1800 },
  { name: "Veo 3.1", 调用次数: 1400 },
  { name: "GPT Image 2", 调用次数: 950 },
];

const recentLogs = [
  { user: "admin", action: "更新系统配置", target: "站点设置", time: "2 分钟前" },
  { user: "user123", action: "创建项目", target: "赛博朋克城市", time: "5 分钟前" },
  { user: "designer", action: "上传文件", target: "reference.png", time: "10 分钟前" },
  { user: "admin", action: "审核内容", target: "作品 #1024", time: "15 分钟前" },
  { user: "creator", action: "AI 生成", target: "文生图 - Gemini", time: "20 分钟前" },
];

export default function AdminDashboardPage() {
  const [overview, setOverview] = useState<DashboardOverviewVO | null>(null);

  const [error, setError] = useState("");

  useEffect(() => {
    adminApi.dashboard.overview()
      .then((res) => {
        if (res.success) setOverview(res.data);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "加载数据概览失败");
      });
  }, []);

  const cards = [
    { title: "用户总数", value: overview?.totalUsers ?? 0, change: "+12%", icon: Users, color: "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400" },
    { title: "今日新增", value: overview?.todayNewUsers ?? 0, change: "+5%", icon: UserPlus, color: "bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400" },
    { title: "活跃用户", value: overview?.activeUsers ?? 0, change: "+8%", icon: Activity, color: "bg-purple-50 text-purple-600 dark:bg-purple-950 dark:text-purple-400" },
    { title: "API 调用", value: overview?.totalApiCalls ?? 0, change: "+15%", icon: Zap, color: "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400" },
    { title: "项目总数", value: overview?.totalProjects ?? 0, change: "+10%", icon: FolderOpen, color: "bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-400" },
    { title: "存储使用", value: overview?.totalStorageBytes ? `${(overview.totalStorageBytes / 1073741824).toFixed(1)} GB` : "0 GB", change: "+3%", icon: HardDrive, color: "bg-cyan-50 text-cyan-600 dark:bg-cyan-950 dark:text-cyan-400" },
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
            <div className="mt-3 flex items-center gap-1 text-sm">
              <TrendingUp className="h-3.5 w-3.5 text-green-500" />
              <span className="font-medium text-green-600">{card.change}</span>
              <span className="text-neutral-500">较昨日</span>
            </div>
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
                <YAxis tick={{ fontSize: 12 }} stroke="#999" />
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
                <YAxis yAxisId="left" tick={{ fontSize: 12 }} stroke="#999" />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} stroke="#999" />
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
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={modelUsageData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 12 }} stroke="#999" />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="#999" width={100} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e5e5", fontSize: 13 }} />
                <Bar dataKey="调用次数" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={18}>
                  {modelUsageData.map((_, index) => (
                    <Cell key={index} fill={["#3b82f6", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444"][index]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
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
              {recentLogs.map((log, i) => (
                <tr key={i} className="border-b border-neutral-50 last:border-0 dark:border-neutral-900">
                  <td className="px-5 py-3 font-medium">{log.user}</td>
                  <td className="px-5 py-3">{log.action}</td>
                  <td className="px-5 py-3 text-neutral-500">{log.target}</td>
                  <td className="px-5 py-3 text-neutral-400">{log.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

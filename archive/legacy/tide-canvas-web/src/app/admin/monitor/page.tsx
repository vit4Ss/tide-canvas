"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Row, Col, Card, Progress, Tag, Statistic, Avatar, Empty, Button, theme } from "antd";
import {
  Cpu, MemoryStick, HardDrive, Layers, RefreshCw, Database, Wifi,
  Activity, CheckCircle2, XCircle,
} from "lucide-react";
import { adminApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { AdminPageHead } from "@/components/admin/page-head";
import type { SystemMetricsVO, RedisInfoVO, SessionVO } from "@/types/monitor";
import type { LoginLogVO } from "@/types/admin";

const REFRESH_MS = 8000;

function fmtBytes(n: number): string {
  if (!n || n <= 0) return "0";
  const gb = n / 1073741824;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(n / 1048576).toFixed(0)} MB`;
}

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d > 0 ? `${d}天 ` : ""}${h}时 ${m}分`;
}

function parseUA(ua?: string | null): string {
  if (!ua) return "未知设备";
  const browser = /Edg/.test(ua) ? "Edge" : /Chrome/.test(ua) ? "Chrome" : /Firefox/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "其他";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "未知";
  return `${browser} / ${os}`;
}

function barColor(pct: number): string {
  if (pct >= 85) return "#ff4d4f";
  if (pct >= 60) return "#faad14";
  return "#52c41a";
}

function toMs(s: string): number {
  return new Date(s.replace(" ", "T")).getTime();
}

export default function AdminMonitorPage() {
  const { token } = theme.useToken();
  const [sys, setSys] = useState<SystemMetricsVO | null>(null);
  const [redis, setRedis] = useState<RedisInfoVO | null>(null);
  const [sessions, setSessions] = useState<SessionVO[]>([]);
  const [logins, setLogins] = useState<LoginLogVO[]>([]);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, r, ss, lg] = await Promise.all([
        adminApi.monitor.system(),
        adminApi.monitor.redis(),
        adminApi.monitor.sessions(),
        adminApi.loginLogs.list({ pageNum: 1, pageSize: 8 }),
      ]);
      if (s.success) setSys(s.data);
      if (r.success) setRedis(r.data);
      if (ss.success) setSessions(ss.data ?? []);
      if (lg.success && lg.data) setLogins((lg.data as unknown as { records: LoginLogVO[] }).records ?? []);
    } catch {
      /* ignore，保留上次数据 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, REFRESH_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [load]);

  const muted = { color: token.colorTextTertiary, fontSize: 12 };

  const metricBar = (icon: ReactNode, label: string, pct: number, sub: string) => (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 500 }}>{icon}{label}</span>
        <span style={{ fontWeight: 600 }}>{pct}%</span>
      </div>
      <Progress percent={pct} showInfo={false} strokeColor={barColor(pct)} size="small" />
      <div style={muted}>{sub}</div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdminPageHead
        title="监控总览"
        desc="服务器运行状态与认证概况"
        extra={<Button icon={<RefreshCw size={14} />} loading={loading} onClick={load}>刷新</Button>}
      />

      {/* 顶部统计 */}
      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}>
          <Card><Statistic title="近7天认证成功" value={sys?.authSuccess ?? 0} valueStyle={{ color: "#16a34a" }} /></Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card><Statistic title="近7天认证失败" value={sys?.authFail ?? 0} valueStyle={{ color: "#ef4444" }} /></Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card><Statistic title="认证成功率" value={sys?.authSuccessRate ?? 100} suffix="%" /></Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <Statistic title="健康评分" value={sys?.healthScore ?? 0} valueStyle={{ color: token.colorPrimary }} />
              <span style={{ ...muted, textAlign: "right" }}>{sys ? `${sys.osName}` : "-"}<br />{sys?.osArch} · PID {sys?.pid}</span>
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        {/* 系统资源 + 磁盘网络 */}
        <Col xs={24} lg={16}>
          <Card title="系统资源" extra={<span style={muted}>{sys ? `运行 ${fmtUptime(sys.uptimeMs)}` : ""}</span>} style={{ marginBottom: 16 }}>
            <Row gutter={[24, 20]}>
              <Col xs={24} sm={12}>{metricBar(<Cpu size={14} />, "CPU", sys?.cpuUsage ?? 0, `${sys?.cpuCores ?? 0} 核 · 负载 ${sys?.loadAverage ?? 0}`)}</Col>
              <Col xs={24} sm={12}>{metricBar(<MemoryStick size={14} />, "内存", sys?.memUsage ?? 0, `${fmtBytes(sys?.memUsed ?? 0)} / ${fmtBytes(sys?.memTotal ?? 0)}`)}</Col>
              <Col xs={24} sm={12}>{metricBar(<HardDrive size={14} />, "存储", sys?.disks?.[0]?.usage ?? 0, `${fmtBytes(sys?.disks?.[0]?.free ?? 0)} 可用`)}</Col>
              <Col xs={24} sm={12}>{metricBar(<Layers size={14} />, "JVM 堆", sys?.jvmHeapUsage ?? 0, `${fmtBytes(sys?.jvmHeapUsed ?? 0)} / ${fmtBytes(sys?.jvmHeapMax ?? 0)}`)}</Col>
            </Row>
          </Card>

          <Card title="磁盘与网络" extra={<span style={{ display: "inline-flex", alignItems: "center", gap: 4, ...muted }}><Wifi size={13} />在线网卡 {sys?.onlineNics ?? 0}</span>}>
            {(sys?.disks ?? []).length === 0 ? (
              <Empty description="无磁盘数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (sys?.disks ?? []).map((d) => (
              <div key={d.path} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                  <span style={{ fontFamily: "monospace", fontSize: 13 }}>{d.path}</span>
                  <span style={muted}>{fmtBytes(d.free)} 可用 / {fmtBytes(d.total)}</span>
                </div>
                <Progress percent={d.usage} showInfo strokeColor={barColor(d.usage)} size="small" />
              </div>
            ))}
          </Card>
        </Col>

        {/* Redis */}
        <Col xs={24} lg={8}>
          <Card title={<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Database size={16} />缓存接入 (Redis)</span>}
            extra={<Tag color={redis?.connected ? "green" : "red"}>{redis?.connected ? "已连接" : "未连接"}</Tag>}>
            <Row gutter={[12, 16]}>
              <Col span={12}><Statistic title="命中率" value={redis?.hitRate ?? 0} suffix="%" /></Col>
              <Col span={12}><Statistic title="Key 数量" value={redis?.keyCount ?? 0} /></Col>
              <Col span={12}><div style={muted}>版本</div><div>{redis?.version || "-"}</div></Col>
              <Col span={12}><div style={muted}>已用内存</div><div>{redis?.usedMemoryHuman || "-"}</div></Col>
            </Row>
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${token.colorBorderSecondary}`, ...muted }}>
              {redis?.connected ? `Redis 已连接，运行 ${fmtUptime((redis?.uptimeSeconds ?? 0) * 1000)}` : "Redis 未连接，请检查配置"}
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        {/* 在线会话 */}
        <Col xs={24} lg={12}>
          <Card title={<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Activity size={16} />最近在线会话</span>}>
            {sessions.length === 0 ? (
              <Empty description="暂无会话" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : sessions.map((s, i) => {
              const active = Date.now() - toMs(s.lastActiveTime) < 120000;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: i ? `1px solid ${token.colorBorderSecondary}` : undefined }}>
                  <Avatar size={32} style={{ background: token.colorPrimary, flexShrink: 0 }}>{(s.username || "游").charAt(0).toUpperCase()}</Avatar>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500 }}>{s.username || "游客"}</div>
                    <div style={muted}>{parseUA(s.userAgent)} · {s.ip}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <Tag color={active ? "green" : "default"}>{active ? "活跃" : "空闲"}</Tag>
                    <div style={muted}>{formatDate(s.lastActiveTime)}</div>
                  </div>
                </div>
              );
            })}
          </Card>
        </Col>

        {/* 登录事件 */}
        <Col xs={24} lg={12}>
          <Card title="登录事件" extra={<span style={muted}>最近 8 条</span>}>
            {logins.length === 0 ? (
              <Empty description="暂无登录记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : logins.map((l) => (
              <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: `1px solid ${token.colorBorderSecondary}` }}>
                <span style={{ color: l.status === 1 ? "#16a34a" : "#ef4444", flexShrink: 0 }}>
                  {l.status === 1 ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{l.username || "-"} · {l.status === 1 ? "登录成功" : "登录失败"}</div>
                  <div style={muted}>{parseUA(l.userAgent)} · {l.ip}{l.status === 0 && l.failReason ? ` · ${l.failReason}` : ""}</div>
                </div>
                <div style={muted}>{formatDate(l.createTime)}</div>
              </div>
            ))}
          </Card>
        </Col>
      </Row>
    </div>
  );
}

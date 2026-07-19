export interface DiskVO {
  path: string;
  total: number;
  free: number;
  used: number;
  usage: number;
}

export interface SystemMetricsVO {
  cpuUsage: number;
  cpuCores: number;
  loadAverage: number;
  memUsed: number;
  memTotal: number;
  memUsage: number;
  jvmHeapUsed: number;
  jvmHeapMax: number;
  jvmHeapUsage: number;
  pid: number;
  osName: string;
  osArch: string;
  uptimeMs: number;
  onlineNics: number;
  healthScore: number;
  disks: DiskVO[];
  authSuccess: number;
  authFail: number;
  authSuccessRate: number;
}

export interface RedisInfoVO {
  connected: boolean;
  keyCount: number;
  hitRate: number;
  version: string;
  uptimeSeconds: number;
  usedMemoryHuman: string;
}

export interface SessionVO {
  username: string | null;
  ip: string;
  userAgent: string | null;
  lastActiveTime: string;
}

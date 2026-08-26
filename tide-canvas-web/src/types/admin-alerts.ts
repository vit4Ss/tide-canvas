export type AlertChannelType = "feishu" | "dingtalk" | "telegram";
export type AlertSeverity = "info" | "warning" | "error" | "critical";

export interface AlertChannelConfig {
  webhook?: string;
  secret?: string;
  botToken?: string;
  chatId?: string;
  threadId?: string;
}

export interface AlertChannelInput {
  name: string;
  type: AlertChannelType;
  enabled: boolean;
  minSeverity: AlertSeverity;
  config: AlertChannelConfig;
}

export interface AlertChannel extends AlertChannelInput {
  id: string;
  configured: boolean;
  lastSuccessAt: string;
  lastFailureAt: string;
  lastError: string;
  createTime: string;
  updateTime: string;
}

export interface AlertRuleInput {
  name: string;
  enabled: boolean;
  eventPatterns: string[];
  minSeverity: AlertSeverity;
  channelIds: string[];
  cooldownSeconds: number;
  aggregateSeconds: number;
  sendRecovery: boolean;
}

export interface AlertRule extends AlertRuleInput {
  id: string;
  createTime: string;
  updateTime: string;
}

export interface AlertEvent {
  id: string;
  eventType: string;
  category: string;
  severity: AlertSeverity;
  state: "firing" | "resolved";
  fingerprint: string;
  title: string;
  content: string;
  details: Record<string, unknown>;
  source: string;
  environment: string;
  instanceId: string;
  occurrenceCount: number;
  firstOccurredAt: string;
  lastOccurredAt: string;
  resolvedAt: string;
  createTime: string;
}

export interface AlertDelivery {
  id: string;
  eventId: string;
  channelId: string;
  channelName: string;
  channelType: AlertChannelType;
  kind: "firing" | "recovery";
  status: "pending" | "processing" | "retry" | "sent" | "failed";
  attemptCount: number;
  httpStatus: number;
  responseExcerpt: string;
  errorMessage: string;
  nextAttemptAt: string;
  sentAt: string;
  createTime: string;
}

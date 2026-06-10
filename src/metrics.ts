/**
 * 请求指标收集模块。
 *
 * 在内存中维护一个近期请求的环形缓冲区，用于仪表盘展示
 * 延迟分布、吞吐量和错误率。不做持久化，重启后清零。
 *
 * 性能考量：所有操作 O(1)，无锁（Node.js 单线程）。
 */

import { getUpstreamPoolStats } from "./http.js";

interface RequestRecord {
  ts: number;           // 请求开始时间戳 (ms)
  latencyMs: number;    // 上游往返耗时
  status: number;       // 返回给客户端的状态码
  inputTokens: number;  // 请求 token 数（从响应 usage 提取，SSE 可能为 0）
  outputTokens: number; // 响应 token 数
  stream: boolean;      // 是否 SSE 流式响应
  provider: string;     // 上游 provider 名称
  model: string;        // 外部模型名
}

export interface MetricsSnapshot {
  total: number;
  active: number;
  errors: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  requestsPerSec: number;
  tokensPerSec: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  poolActive: number;
  poolMax: number;
}

const MAX_RECORDS = 200;
const records: RequestRecord[] = [];
let activeCount = 0;
let totalCount = 0;
let errorCount = 0;
let totalInputTokens = 0;
let totalOutputTokens = 0;

/** 请求开始时调用 */
export function recordRequestStart(): void {
  activeCount += 1;
}

/** 请求完成时调用 */
export function recordRequestDone(rec: Omit<RequestRecord, "ts">): void {
  activeCount = Math.max(0, activeCount - 1);
  totalCount += 1;

  if (rec.status >= 400) {
    errorCount += 1;
  }

  totalInputTokens += rec.inputTokens;
  totalOutputTokens += rec.outputTokens;

  // 环形缓冲区
  if (records.length >= MAX_RECORDS) {
    records.shift();
  }
  records.push({ ...rec, ts: Date.now() });
}

/** 获取当前指标快照 */
export function getMetricsSnapshot(): MetricsSnapshot {
  const pool = getUpstreamPoolStats();

  const now = Date.now();
  const recent = records.filter((r) => now - r.ts < 60_000); // 最近 60s

  // 延迟分布
  const latencies = recent.map((r) => r.latencyMs).sort((a, b) => a - b);
  const p50 = percentile(latencies, 0.5);
  const p95 = percentile(latencies, 0.95);
  const p99 = percentile(latencies, 0.99);

  const avgLatency = latencies.length > 0
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : 0;

  // 吞吐量（最近 60s）
  const elapsedSec = Math.max(1, (now - (recent[0]?.ts ?? now)) / 1000);
  const requestsPerSec = recent.length / elapsedSec;

  const recentTokens = recent.reduce((a, r) => a + r.inputTokens + r.outputTokens, 0);
  const tokensPerSec = recentTokens / elapsedSec;

  return {
    total: totalCount,
    active: activeCount,
    errors: errorCount,
    avgLatencyMs: Math.round(avgLatency),
    p50LatencyMs: p50,
    p95LatencyMs: p95,
    p99LatencyMs: p99,
    requestsPerSec: Math.round(requestsPerSec * 10) / 10,
    tokensPerSec: Math.round(tokensPerSec),
    totalInputTokens,
    totalOutputTokens,
    poolActive: pool.active,
    poolMax: pool.max
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

/* ═══════════════════════════════════════════════════════
   指标轮询
   ═══════════════════════════════════════════════════════ */

let metricsTimer = null;

export function startMetricsPoll() {
  pollMetrics();
  if (metricsTimer) clearInterval(metricsTimer);
  metricsTimer = setInterval(pollMetrics, 5000);
}

export function stopMetricsPoll() {
  if (metricsTimer) {
    clearInterval(metricsTimer);
    metricsTimer = null;
  }
}

async function pollMetrics() {
  try {
    const r = await fetch('/api/admin/metrics').then(r => r.json());
    setText('mTotal', r.total != null ? r.total : '-');
    setText('mActive', r.active != null ? r.active : '-');
    setText('mAvgLatency', r.avgLatencyMs != null ? r.avgLatencyMs + 'ms' : '-');
    setText('mP95', r.p95LatencyMs != null ? r.p95LatencyMs + 'ms' : '-');
    setText('mP99', r.p99LatencyMs != null ? r.p99LatencyMs + 'ms' : '-');
    setText('mRPS', r.requestsPerSec != null ? r.requestsPerSec.toFixed(1) + '/s' : '-');
    setText('mTPS', r.tokensPerSec != null
      ? (r.tokensPerSec >= 1000 ? (r.tokensPerSec / 1000).toFixed(1) + 'k/s' : r.tokensPerSec + '/s')
      : '-');
    const pool = r.poolActive != null && r.poolMax != null ? r.poolActive + ' / ' + r.poolMax : '-';
    setText('mPool', pool);
    setText('mErrors', r.errors != null ? r.errors : '-');
    setText('mInputTokens', r.totalInputTokens != null
      ? (r.totalInputTokens >= 1000 ? (r.totalInputTokens / 1000).toFixed(1) + 'k' : r.totalInputTokens)
      : '-');
    setText('mOutputTokens', r.totalOutputTokens != null
      ? (r.totalOutputTokens >= 1000 ? (r.totalOutputTokens / 1000).toFixed(1) + 'k' : r.totalOutputTokens)
      : '-');
    setText('metricsUpdated', '更新于 ' + new Date().toLocaleTimeString('zh-CN'));
  } catch {
    setText('metricsUpdated', '获取中…');
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value);
}

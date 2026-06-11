/* ═══════════════════════════════════════════════════════
   API Client — 后端通信统一入口
   ═══════════════════════════════════════════════════════ */

/** 快捷 DOM 查询 */
export function $(id) {
  return document.getElementById(id);
}

/** HTML 转义 */
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 内容块类型常量 */
export const CB = ['text', 'tool_use', 'tool_result', 'thinking', 'image', 'document', 'mcp_tool_use', 'mcp_tool_result'];

export const PROVIDER_TEMPLATES = {
  'https://api.deepseek.com/anthropic': { name: 'deepseek', modelsUrl: 'https://api.deepseek.com/models' },
  'http://127.0.0.1:3000': { name: 'newapi', modelsUrl: '' },
  'https://api.openai.com/v1': { name: 'openai', modelsUrl: '' }
};

/** 通用 fetch 封装 */
export async function api(method, url, body) {
  const o = { method };
  if (body !== undefined) {
    o.headers = { 'Content-Type': 'application/json' };
    o.body = JSON.stringify(body);
  }
  const r = await fetch(url, o);
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.ok === false) throw new Error(d.error || 'HTTP ' + r.status);
  return d;
}

/** 获取所有配置方案 */
export async function fetchProfiles() {
  return api('GET', '/api/admin/profiles');
}

/** 保存配置方案 */
export async function saveProfile(id, name, config) {
  return api('PUT', `/api/admin/profiles/${id}`, { name, config });
}

/** 激活配置方案 */
export async function activateProfileApi(id) {
  return api('POST', '/api/admin/profiles/activate', { id });
}

/** 热重载配置 */
export async function reloadConfig() {
  return api('POST', '/api/admin/reload');
}

/** 获取方案历史版本 */
export async function fetchHistory(profileId) {
  return api('GET', `/api/admin/profiles/${profileId}/history`);
}

/** 回滚到历史版本 */
export async function rollbackProfileApi(profileId, historyId) {
  return api('POST', `/api/admin/profiles/${profileId}/rollback`, { historyId });
}

/** 获取上游模型列表 */
export async function fetchUpstreamModels(provider) {
  return api('POST', '/api/admin/upstream-models', { provider });
}

/** 强制释放端口重启 */
export async function killPort() {
  return api('POST', '/api/admin/kill-port');
}

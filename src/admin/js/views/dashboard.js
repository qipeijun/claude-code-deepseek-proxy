/* ═══════════════════════════════════════════════════════
   Dashboard 视图 — 仪表盘渲染
   ═══════════════════════════════════════════════════════ */

import { $, esc, api, fetchUpstreamModels } from '../api.js';
import { store } from '../state.js';
import { toast } from '../ui/toast.js';

export function getActiveConfig() {
  const activeProfileId = store.get('activeProfileId');
  if (!activeProfileId) return null;
  const profiles = store.get('profiles');
  const p = profiles.find(x => x.id === activeProfileId);
  return p ? p.config : null;
}

export function renderDashboard() {
  const cfg = getActiveConfig();
  const hasActive = !!cfg;

  if (hasActive) {
    const dashStatusDot = document.getElementById('dashStatusDot');
    const dashStatusLabel = document.getElementById('dashStatusLabel');
    const topServerAddr = document.getElementById('topServerAddr');
    const dashMetrics = document.getElementById('dashMetrics');
    const dashEmpty = document.getElementById('dashEmpty');

    if (dashStatusDot) dashStatusDot.className = 'status-pulse';
    if (dashStatusLabel) dashStatusLabel.innerHTML = '服务运行中 <small>' + esc(cfg.server.host) + ':' + cfg.server.port + '</small>';
    if (topServerAddr) topServerAddr.textContent = cfg.server.host + ':' + cfg.server.port;

    const profiles = store.get('profiles');
    const pname = profiles.find(x => x.id === store.get('activeProfileId'));
    const routeCount = cfg.routes.length;
    const providerCount = Object.keys(cfg.providers).length;
    const authOn = !!(cfg.server.authToken);

    if (dashMetrics) {
      dashMetrics.innerHTML =
        '<div class="metric"><div class="val">' + esc(pname ? pname.name : '-') + '</div><div class="lbl">当前方案</div></div>' +
        '<div class="metric"><div class="val">' + providerCount + '</div><div class="lbl">Provider</div></div>' +
        '<div class="metric"><div class="val">' + routeCount + '</div><div class="lbl">路由规则</div></div>' +
        '<div class="metric"><div class="val">' + (authOn ? '已启用' : '未启用') + '</div><div class="lbl">认证</div></div>';
    }

    const dashBanner = document.getElementById('dashBanner');
    if (dashBanner) dashBanner.style.display = '';
    if (dashEmpty) dashEmpty.classList.add('hidden');
  } else {
    const dashStatusDot = document.getElementById('dashStatusDot');
    const dashStatusLabel = document.getElementById('dashStatusLabel');
    const dashMetrics = document.getElementById('dashMetrics');
    const dashBanner = document.getElementById('dashBanner');

    if (dashStatusDot) dashStatusDot.className = 'status-pulse off';
    if (dashStatusLabel) dashStatusLabel.textContent = '未激活方案';
    if (dashMetrics) dashMetrics.innerHTML = '<span style="color:var(--text-tertiary);font-size:13px">前往「配置管理」创建并激活方案</span>';
    if (dashBanner) dashBanner.style.display = '';
    renderEmptyDashboard();
    return;
  }

  const host = cfg.server.host, port = cfg.server.port, key = cfg.server.authToken || 'your-auth-token-here';
  const envBlock = document.getElementById('envBlock');
  if (envBlock) {
    envBlock.textContent =
      'export ANTHROPIC_BASE_URL=http://' + host + ':' + port + '\n' +
      (cfg.server.authToken ? 'export ANTHROPIC_API_KEY=' + key : '# export ANTHROPIC_API_KEY=(无需鉴权)');
  }

  const firstModel = cfg.routes.length ? (cfg.routes[0].match.exact || cfg.routes[0].match.prefix || '{model}') : '{model}';
  let curlCmd = 'curl -X POST http://' + host + ':' + port + '/v1/messages \\\n' +
    '  -H "Content-Type: application/json" \\\n' +
    (cfg.server.authToken ? '  -H "x-api-key: ' + key + '" \\\n' : '') +
    '  -d \'{\n' +
    '    "model": "' + firstModel + '",\n' +
    '    "max_tokens": 100,\n' +
    '    "messages": [{"role": "user", "content": "hello"}]\n' +
    '  }\'';
  const curlBlock = document.getElementById('curlBlock');
  if (curlBlock) curlBlock.textContent = curlCmd;
  resetCopyBtn('copyEnvBtn'); resetCopyBtn('copyCurlBtn');

  // 路由表
  const routeCount = document.getElementById('routeCount');
  if (routeCount) routeCount.textContent = cfg.routes.length + ' 条规则';
  const routeTableBody = document.getElementById('routeTableBody');
  if (routeTableBody && cfg.routes.length) {
    let rows = '';
    cfg.routes.forEach((r) => {
      const type = r.match && r.match.exact !== undefined ? 'exact' : 'prefix';
      const val = r.match ? (r.match.exact || r.match.prefix || '') : '';
      const fbs = (r.fallback || []);
      let fbHtml = '-';
      if (fbs.length) {
        fbHtml = '<span class="fb-pop" data-tip="' + esc(fbs.map((f) => f.provider + '/' + f.upstreamModel).join(', ')) + '">' + fbs.length + ' 个</span>';
      }
      rows += '<tr>' +
        '<td><span class="r-type-badge ' + type + '">' + type + '</span></td>' +
        '<td>' + esc(val) + '</td>' +
        '<td>' + esc(r.provider) + '</td>' +
        '<td>' + esc(r.upstreamModel) + '</td>' +
        '<td>' + fbHtml + '</td></tr>';
    });
    routeTableBody.innerHTML = rows;
  } else if (routeTableBody) {
    routeTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-tertiary);padding:36px">暂无路由数据</td></tr>';
  }

  const routeTableCard = document.getElementById('routeTableCard');
  if (routeTableCard) routeTableCard.style.display = '';

  // Provider 卡片（模板渲染）
  const pvNames = Object.keys(cfg.providers);
  const pvCount = document.getElementById('pvCount');
  if (pvCount) pvCount.textContent = pvNames.length + ' 个';
  const dashProviderGrid = document.getElementById('dashProviderGrid');
  const pvTmpl = document.getElementById('tmpl-dash-pv-card');
  if (dashProviderGrid && pvNames.length && pvTmpl) {
    dashProviderGrid.innerHTML = '';
    pvNames.forEach((name) => {
      const p = cfg.providers[name];
      const clone = pvTmpl.content.firstElementChild.cloneNode(true);
      clone.setAttribute('data-pv', name);
      clone.querySelector('.pv-dash-name-text').textContent = name;
      clone.querySelector('.pv-dash-url').textContent = p.baseUrl || '(环境变量)';
      clone.querySelector('.pv-dash-timeout').textContent = (p.timeoutMs || 120000) + 'ms';
      clone.querySelector('.pv-dash-blocks').textContent = ((p.capabilities && p.capabilities.contentBlocks) || []).join(', ');
      const safeName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
      const testBtn = clone.querySelector('.test-btn');
      testBtn.setAttribute('onclick', "window.__testDashProvider('" + safeName + "')");
      dashProviderGrid.appendChild(clone);
    });
  } else if (dashProviderGrid) {
    dashProviderGrid.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:36px">暂无 Provider 数据</div>';
  }

  const guideCard = document.getElementById('guideCard');
  if (guideCard) guideCard.style.display = '';
}

export function renderEmptyDashboard() {
  const guideCard = document.getElementById('guideCard');
  const routeTableCard = document.getElementById('routeTableCard');
  const dashProviderGrid = document.getElementById('dashProviderGrid');
  const dashEmpty = document.getElementById('dashEmpty');

  if (guideCard) guideCard.style.display = 'none';
  if (routeTableCard) routeTableCard.style.display = 'none';
  if (dashProviderGrid && dashProviderGrid.parentElement) dashProviderGrid.parentElement.style.display = 'none';
  if (dashEmpty) dashEmpty.classList.remove('hidden');
}

/** 仪表盘上测试 Provider 连接 */
export async function testDashProvider(pvName) {
  const cfg = getActiveConfig();
  if (!cfg) return;
  const p = cfg.providers[pvName];
  if (!p) return;
  const card = document.querySelector('.pv-dash-card[data-pv="' + pvName.replace(/"/g, '\\"') + '"]');
  if (!card) return;
  const dot = card.querySelector('.conn-dot');
  const btn = card.querySelector('.test-btn');
  const cnt = card.querySelector('.model-count');

  if (dot) dot.className = 'conn-dot testing';
  if (btn) { btn.textContent = '测试中…'; btn.classList.add('testing'); }
  if (cnt) cnt.textContent = '';

  try {
    const r = await fetchUpstreamModels(p);
    if (dot) dot.className = 'conn-dot ok';
    if (btn) { btn.textContent = '测试连接'; btn.classList.remove('testing'); }
    if (cnt) cnt.textContent = (r.models || []).length + ' 个模型';
  } catch {
    if (dot) dot.className = 'conn-dot fail';
    if (btn) { btn.textContent = '测试连接'; btn.classList.remove('testing'); }
    if (cnt) { cnt.textContent = '失败'; cnt.style.color = 'var(--danger)'; }
  }
}

/** 复制环境变量 */
export function copyEnv() {
  const envBlock = document.getElementById('envBlock');
  if (envBlock) copyToClipboard(envBlock.textContent || '', 'copyEnvBtn');
}
/** 复制 curl 命令 */
export function copyCurl() {
  const curlBlock = document.getElementById('curlBlock');
  if (curlBlock) copyToClipboard(curlBlock.textContent || '', 'copyCurlBtn');
}

function copyToClipboard(text, btnId) {
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById(btnId);
    if (btn) { btn.textContent = '已复制'; btn.classList.add('copied'); }
    setTimeout(() => resetCopyBtn(btnId), 1800);
    toast('已复制到剪贴板', 'ok');
  }).catch(() => toast('复制失败', 'err'));
}

function resetCopyBtn(btnId) {
  const btn = document.getElementById(btnId);
  if (btn) { btn.textContent = '复制'; btn.classList.remove('copied'); }
}

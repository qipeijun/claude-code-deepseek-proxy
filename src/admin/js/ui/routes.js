/* ═══════════════════════════════════════════════════════
   路由行 + Fallback 编辑器渲染（纯渲染，无副作用）
   ═══════════════════════════════════════════════════════ */

import { esc } from '../api.js';

export function renderRoutes(routes, modelsByProvider) {
  if (!routes.length) {
    return '<div style="padding:10px 0;color:var(--text-tertiary);font-size:13px">暂无路由，点击"+ 添加"创建。</div>';
  }
  return routes.map(r => routeRowHtml(r, modelsByProvider)).join('');
}

export function routeRowHtml(r, modelsByProvider) {
  const type = r.match && r.match.exact !== undefined ? 'exact' : 'prefix';
  const val = r.match ? (r.match.exact || r.match.prefix || '') : '';
  const models = modelsByProvider[r.provider] || [];
  let modelSelect = '';
  if (models.length) {
    modelSelect = '<select class="r-model" onchange="window.__markDirty()"><option value="">选择模型…</option>';
    models.forEach(m => {
      modelSelect += '<option value="' + esc(m) + '"' + (m === r.upstreamModel ? ' selected' : '') + '>' + esc(m) + '</option>';
    });
    modelSelect += '</select>';
  } else {
    modelSelect = '<input class="r-model" value="' + esc(r.upstreamModel || '') + '" placeholder="先获取模型列表" oninput="window.__markDirty()">';
  }
  return '<div class="r-row">'
    + '<select class="r-type" onchange="window.__onRouteProviderInput(this)"><option value="prefix"' + (type === 'prefix' ? ' selected' : '') + '>前缀</option><option value="exact"' + (type === 'exact' ? ' selected' : '') + '>精确</option></select>'
    + '<input class="r-match r-value" value="' + esc(val) + '" placeholder="claude-sonnet" oninput="window.__markDirty()">'
    + '<span class="r-arrow">→</span>'
    + '<input class="r-provider" value="' + esc(r.provider || '') + '" placeholder="provider" onchange="window.__onRouteProviderInput(this)">'
    + '<span class="r-sep">/</span>'
    + modelSelect
    + '<button class="r-rem" onclick="window.__removeRoute(this)" title="移除">×</button></div>';
}

export function renderFallbackEditor(routes) {
  if (!routes.length) {
    return '<div style="color:var(--text-tertiary);font-size:13px;padding:8px 0">暂无路由规则</div>';
  }
  let h = '';
  routes.forEach((r, i) => {
    const fbs = r.fallback || [];
    const label = (r.match && (r.match.prefix || r.match.exact)) || '路由 ' + (i + 1);
    h += '<div class="fb-section"><div class="fb-title">' + esc(label) + '</div>';
    fbs.forEach(fb => { h += fallbackRowHtml(fb); });
    h += '<button class="btn ghost sm" onclick="window.__addFallbackRow(this)">+ 添加</button></div>';
  });
  return h;
}

export function fallbackRowHtml(fb) {
  return '<div class="fb-row"><input value="' + esc(fb && fb.provider || '') + '" placeholder="provider" oninput="window.__markDirty()">'
    + '<input value="' + esc(fb && fb.upstreamModel || '') + '" placeholder="model" oninput="window.__markDirty()">'
    + '<button class="btn ghost sm danger" onclick="this.closest(\'.fb-row\').remove();window.__markDirty()">×</button></div>';
}

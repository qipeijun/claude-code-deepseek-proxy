/* ═══════════════════════════════════════════════════════
   Provider 卡片渲染
   ═══════════════════════════════════════════════════════ */

import { esc, CB } from '../api.js';

export function renderModelDatalists(modelsByProvider) {
  let h = '';
  Object.keys(modelsByProvider).forEach(pv => {
    h += '<datalist id="' + modelListId(pv) + '">';
    modelsByProvider[pv].forEach(m => { h += '<option value="' + esc(m) + '">'; });
    h += '</datalist>';
  });
  return h;
}

export function modelListId(pv) {
  return 'ml-' + pv.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function providerCardHtml(name, p) {
  const blocks = (p.capabilities && p.capabilities.contentBlocks) || [];
  let h = '<div class="pv-card"><div class="pv-head"><span class="pv-name">' + esc(name) + '</span><div style="display:flex;gap:5px">';
  h += '<button class="btn ghost sm" onclick="window.__fetchExtraModels(this)">获取模型</button>';
  h += '<button class="btn ghost sm danger" onclick="this.closest(\'.pv-card\').remove();window.__markDirty()">移除</button></div></div>';
  h += '<div class="pv-grid-inner">';
  h += '<div class="field"><label>Name</label><input class="pvcard-name" value="' + esc(name) + '" oninput="window.__markDirty()"></div>';
  h += '<div class="field"><label>API Key</label><input type="text" class="pvcard-key" value="' + esc(p.apiKey || '') + '" oninput="window.__markDirty()" autocomplete="off"></div>';
  h += '<div class="field"><label>Base URL</label><input class="pvcard-url" value="' + esc(p.baseUrl || '') + '" oninput="window.__markDirty()"></div>';
  h += '<div class="field"><label>Models URL</label><input value="' + esc(p.modelsUrl || '') + '" oninput="window.__markDirty()"></div>';
  h += '<div class="field"><label>Timeout MS</label><input type="number" value="' + (p.timeoutMs || 120000) + '" oninput="window.__markDirty()"></div>';
  h += '</div><div class="field" style="margin-top:14px"><label>Content Blocks</label><div class="chips">';
  CB.forEach(b => {
    h += '<button class="chip' + (blocks.indexOf(b) >= 0 ? ' on' : '') + '" onclick="this.classList.toggle(\'on\');window.__markDirty()">' + b + '</button>';
  });
  h += '</div></div><div class="field" style="margin-top:14px"><div class="model-preview hidden" data-mp></div></div></div>';
  return h;
}

export function renderExtraProviders(providers, mainName) {
  const entries = Object.entries(providers);
  const extra = entries.filter(e => e[0] !== mainName);
  if (!extra.length) {
    return '<div style="color:var(--text-tertiary);font-size:13px;padding:8px 0">暂无额外 Provider</div>';
  }
  return extra.map(e => providerCardHtml(e[0], e[1])).join('');
}

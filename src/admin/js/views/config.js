/* ═══════════════════════════════════════════════════════
   Config 配置编辑器 — 三步向导 / Profile CRUD / 保存激活
   ═══════════════════════════════════════════════════════ */

import { $, esc, api, saveProfile as saveProfileApi, activateProfileApi, reloadConfig, fetchUpstreamModels, fetchHistory, rollbackProfileApi, CB, PROVIDER_TEMPLATES } from '../api.js';
import { store } from '../state.js';
import { toast } from '../ui/toast.js';
import { renderSidebar } from '../ui/sidebar.js';
import { renderRoutes, routeRowHtml, renderFallbackEditor, fallbackRowHtml } from '../ui/routes.js';
import { renderModelDatalists, modelListId, providerCardHtml, renderExtraProviders } from '../ui/providerCards.js';
import { getActiveConfig, renderDashboard } from './dashboard.js';

// ═══════════════════════════════════════════
// 从 app.js 注入的回调（避免循环导入）
// ═══════════════════════════════════════════
let _loadProfiles;
let _switchTab;

/** 由 app.js 在初始化时调用，注入回调 */
export function initConfigView(loadProfilesFn, switchTabFn) {
  _loadProfiles = loadProfilesFn;
  _switchTab = switchTabFn;
}

// ═══════════════════════════════════════════
// Show / Hide
// ═══════════════════════════════════════════

export function showEmpty() {
  store.set('currentId', null);
  store.set('dirty', false);
  $('emptyState').classList.remove('hidden');
  $('editor').classList.add('hidden');
}

export function showEditor() {
  $('emptyState').classList.add('hidden');
  $('editor').classList.remove('hidden');
  $('editor').style.display = 'flex';
}

// ═══════════════════════════════════════════
// Profile CRUD
// ═══════════════════════════════════════════

export async function selectProfile(id) {
  const profiles = store.get('profiles');
  let p = profiles.find(x => x.id === id);
  if (!p) {
    await _loadProfiles();
    const refreshed = store.get('profiles');
    p = refreshed.find((x) => x.id === id);
    if (!p) return;
  }
  store.set('currentId', id);
  store.set('dirty', false);
  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.textContent = '保存';
  setErrors([]);
  showEditor(); renderSidebar();

  const profileName = document.getElementById('profileName');
  if (profileName) profileName.value = p.name;

  const savedAt = document.getElementById('savedAt');
  if (savedAt) savedAt.textContent = '更新于 ' + new Date(p.updatedAt).toLocaleString('zh-CN');

  const c = p.config || emptyConfig();
  const svHost = document.getElementById('svHost');
  const svPort = document.getElementById('svPort');
  const svAuth = document.getElementById('svAuth');
  if (svHost) svHost.value = (c.server && c.server.host) || '127.0.0.1';
  if (svPort) svPort.value = (c.server && c.server.port) || 8787;
  if (svAuth) svAuth.value = (c.server && c.server.authToken) || '';

  loadMainProvider(c.providers || {});
  _renderRoutesInternal(c.routes || []);
  _renderFallbackEditorInternal(c.routes || []);
  _renderExtraProvidersInternal(c.providers || {});
  store.set('currentStep', 1);
  updateStepUI();

  // 加载版本历史
  loadHistory();
}

export function createAndEdit() {
  const profiles = store.get('profiles');
  const names = profiles.map(x => x.name);
  let name = '新配置', i = 1;
  while (names.indexOf(name) >= 0) { i++; name = '新配置 ' + i; }
  _createProfile(name, emptyConfig());
}

async function _createProfile(name, config) {
  try {
    const r = await api('POST', '/api/admin/profiles', { name, config });
    await _loadProfiles();
    await selectProfile(r.profile.id);
    toast('已创建配置', 'ok');
  } catch (e) { toast(e.message || '创建失败', 'err'); }
}

export async function deleteProfile(id) {
  if (!confirm('确定删除此方案？')) return;
  try {
    await api('DELETE', '/api/admin/profiles/' + id);
    const currentId = store.get('currentId');
    if (currentId === id) { store.set('currentId', null); showEmpty(); }
    await _loadProfiles();
    toast('已删除', 'ok');
  } catch (e) { toast(e.message || '删除失败', 'err'); }
}

export async function activateProfile(id) {
  try {
    await activateProfileApi(id);
    await reloadConfig();
    await _loadProfiles();
    toast('已设为当前方案并生效', 'ok');
  } catch (e) { toast(e.message || '激活失败', 'err'); }
}

// ═══════════════════════════════════════════
// Form Logic
// ═══════════════════════════════════════════

export function emptyConfig() {
  return { server: { host: '127.0.0.1', port: 8787 }, providers: {}, routes: [] };
}

export function markDirty() {
  const currentId = store.get('currentId');
  const dirty = store.get('dirty');
  if (!currentId || dirty) return;
  store.set('dirty', true);
  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.textContent = '保存 *';
  // 用户开始编辑时清除字段级错误
  clearFieldErrors();
}

/** 清除所有字段级错误提示 */
function clearFieldErrors() {
  document.querySelectorAll('.field-error').forEach(el => el.remove());
}

export function onBaseUrlSelect() {
  const baseUrlSelect = document.getElementById('pvBaseUrlSelect');
  const url = baseUrlSelect?.value;
  if (!url) return;
  const baseUrl = document.getElementById('pvBaseUrl');
  if (baseUrl) baseUrl.value = url;
  const t = PROVIDER_TEMPLATES[url];
  if (t) {
    const name = document.getElementById('pvName');
    const modelsUrl = document.getElementById('pvModelsUrl');
    if (name) name.value = t.name || '';
    if (modelsUrl) modelsUrl.value = t.modelsUrl || '';
  }
  markDirty();
}

export function onCustomUrlInput() {
  const baseUrl = document.getElementById('pvBaseUrl');
  const name = document.getElementById('pvName');
  const url = baseUrl?.value.trim();
  if (!name?.value) {
    try { const h = new URL(url).hostname; const p = h.split('.')[0]; if (name) name.value = p || ''; } catch { /* */ }
  }
  markDirty();
}

export function loadMainProvider(providers) {
  const pvChips = document.getElementById('pvChips');
  if (pvChips && !pvChips.children.length) {
    pvChips.innerHTML = CB.map(b =>
      '<button class="chip" data-block="' + b + '" onclick="this.classList.toggle(\'on\');window.__markDirty()">' + b + '</button>'
    ).join('');
  }
  const entries = Object.entries(providers);
  if (!entries.length) {
    const pvName = document.getElementById('pvName');
    const pvApiKey = document.getElementById('pvApiKey');
    const pvBaseUrl = document.getElementById('pvBaseUrl');
    const pvModelsUrl = document.getElementById('pvModelsUrl');
    const pvTimeout = document.getElementById('pvTimeout');
    if (pvName) pvName.value = '';
    if (pvApiKey) pvApiKey.value = '';
    if (pvBaseUrl) pvBaseUrl.value = '';
    if (pvModelsUrl) pvModelsUrl.value = '';
    if (pvTimeout) pvTimeout.value = '120000';
    setMainChips([]);
    return;
  }
  const first = entries[0], p = first[1];
  setField('pvName', first[0]);
  setField('pvApiKey', p.apiKey || '');
  setField('pvBaseUrl', p.baseUrl || '');
  setField('pvModelsUrl', p.modelsUrl || '');
  setField('pvTimeout', p.timeoutMs || 120000);
  setMainChips((p.capabilities && p.capabilities.contentBlocks) || []);
}

function setField(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = String(value);
}

export function setMainChips(blocks) {
  const pvChips = document.getElementById('pvChips');
  if (!pvChips) return;
  pvChips.querySelectorAll('.chip').forEach((c) => {
    c.classList.toggle('on', blocks.indexOf(c.dataset.block) >= 0);
  });
}

export function collectMainProvider() {
  const pvChips = document.getElementById('pvChips');
  const blocks = [];
  if (pvChips) {
    pvChips.querySelectorAll('.chip.on').forEach((c) => { blocks.push(c.dataset.block); });
  }
  const pvTimeout = document.getElementById('pvTimeout');
  const pvModelsUrl = document.getElementById('pvModelsUrl');
  const pvApiKey = document.getElementById('pvApiKey');
  const pvBaseUrl = document.getElementById('pvBaseUrl');

  const timeout = parseInt(pvTimeout?.value, 10) || 120000;
  const modelsUrl = pvModelsUrl?.value.trim() || undefined;
  const p = { type: 'anthropic', apiKey: pvApiKey?.value.trim() || undefined, timeoutMs: timeout, capabilities: { contentBlocks: blocks } };
  if (modelsUrl) p.modelsUrl = modelsUrl;
  const url = pvBaseUrl?.value.trim();
  if (url) p.baseUrl = url;
  return p;
}

export function collectExtraProvider(card) {
  const inputs = card.querySelectorAll('input');
  let apiKey = '', baseUrl = '', modelsUrl = '', timeoutMs = 120000;
  if (inputs.length >= 2) apiKey = inputs[1].value.trim();
  if (inputs.length >= 3) baseUrl = inputs[2].value.trim();
  if (inputs.length >= 4) { const mu = inputs[3].value.trim(); if (mu) modelsUrl = mu; }
  if (inputs.length >= 5) timeoutMs = parseInt(inputs[4].value, 10) || 120000;
  const blocks = [];
  card.querySelectorAll('.chip.on').forEach((c) => { blocks.push(c.textContent); });
  const p = { type: 'anthropic', apiKey: apiKey || undefined, timeoutMs: timeoutMs, capabilities: { contentBlocks: blocks } };
  if (baseUrl) p.baseUrl = baseUrl;
  if (modelsUrl) p.modelsUrl = modelsUrl;
  return p;
}

export function addProviderCard() {
  const pvName = document.getElementById('pvName');
  const existing = [pvName?.value.trim() || ''];
  document.querySelectorAll('.pvcard-name').forEach((inp) => {
    const n = inp.value.trim(); if (n) existing.push(n);
  });
  let name = 'provider', i = 1;
  while (existing.indexOf(name) >= 0) { i++; name = 'provider' + i; }
  const cards = document.getElementById('providerCards');
  if (!cards) return;
  const ph = cards.querySelector('div[style]');
  if (ph && !cards.querySelector('.pv-card')) ph.remove();
  cards.insertAdjacentHTML('beforeend', providerCardHtml(name, {
    type: 'anthropic', baseUrl: '', apiKey: '', timeoutMs: 120000,
    capabilities: { contentBlocks: ['text', 'tool_use', 'tool_result', 'thinking'] }
  }));
  markDirty();
}

// ═══════════════════════════════════════════
// Steps
// ═══════════════════════════════════════════

export function goStep(n) {
  if (n < 1 || n > 3) return;
  if (n > store.get('currentStep')) {
    if (store.get('currentStep') === 1 && !canProceedFromStep1()) { toast('请先填写上游地址和 API Key', 'err'); return; }
    if (store.get('currentStep') === 2 && !canProceedFromStep2()) { toast('请至少添加一条路由规则', 'err'); return; }
  }
  store.set('currentStep', n);
  updateStepUI();
}

function canProceedFromStep1() {
  const baseUrl = document.getElementById('pvBaseUrl');
  const apiKey = document.getElementById('pvApiKey');
  return !!(baseUrl?.value.trim() && apiKey?.value.trim());
}

function canProceedFromStep2() {
  return document.querySelectorAll('.r-row').length > 0;
}

export function updateStepUI() {
  const step = store.get('currentStep');
  ['step1', 'step2', 'step3'].forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', i + 1 !== step);
  });
  const stepNum = document.getElementById('stepNum');
  if (stepNum) stepNum.textContent = String(step);
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  if (prevBtn) prevBtn.style.visibility = step === 1 ? 'hidden' : 'visible';
  if (nextBtn) nextBtn.style.visibility = step === 3 ? 'hidden' : 'visible';

  document.querySelectorAll('.step').forEach((s, i) => {
    s.classList.remove('active', 'done');
    if (i + 1 < step) s.classList.add('done');
    if (i + 1 === step) s.classList.add('active');
  });
  document.querySelectorAll('.step-line').forEach((l, i) => {
    l.classList.toggle('done', i + 1 < step);
  });
}

// ═══════════════════════════════════════════
// Model Fetching
// ═══════════════════════════════════════════

export async function fetchMainModels() {
  const pvName = document.getElementById('pvName');
  const name = pvName?.value.trim();
  if (!name) { toast('请先填写 Provider 名称', 'err'); return; }
  const p = collectMainProvider();
  const pvModelPreview = document.getElementById('pvModelPreview');
  await doFetchModels(name, p, pvModelPreview);
}

export async function fetchExtraModels(btn) {
  const card = btn.closest('.pv-card');
  if (!card) return;
  const nameInput = card.querySelector('.pvcard-name');
  const name = nameInput?.value.trim();
  if (!name) { toast('请先填写 Provider 名称', 'err'); return; }
  const p = collectExtraProvider(card);
  const preview = card.querySelector('[data-mp]');
  await doFetchModels(name, p, preview);
}

async function doFetchModels(name, provider, previewEl) {
  if (!provider.apiKey) { toast('请先填写 API Key', 'err'); return; }
  try {
    const r = await fetchUpstreamModels(provider);
    const modelsByProvider = store.get('modelsByProvider') || {};
    modelsByProvider[name] = r.models || [];
    store.set('modelsByProvider', modelsByProvider);

    _renderModelDatalistsInternal();
    _updateRouteListsInternal();

    if (previewEl) {
      previewEl.classList.remove('hidden');
      const cnt = modelsByProvider[name].length;
      previewEl.innerHTML = modelsByProvider[name].slice(0, 15).map(esc).join(' · ') + (cnt > 15 ? ' · …' : '');
      const pvModelCount = document.getElementById('pvModelCount');
      if (pvModelCount) pvModelCount.textContent = cnt ? cnt + ' 个模型可用' : '';
    }
    toast(cnt ? '已获取 ' + cnt + ' 个模型' : '上游无可用模型', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

// ═══════════════════════════════════════════
// Routes
// ═══════════════════════════════════════════

export function onRouteProviderInput(_inp) {
  markDirty();
  _updateRouteListsInternal();
}

export function addRoutePreset(matchPattern, upstreamModel) {
  const list = document.getElementById('routeList');
  if (!list) return;
  if (!list.querySelector('.r-row')) list.innerHTML = '';
  const pvName = document.getElementById('pvName');
  const pv = pvName?.value.trim() || '';
  const modelsByProvider = store.get('modelsByProvider') || {};
  const models = modelsByProvider[pv] || [];
  let modelHtml = '';
  if (models.length) {
    modelHtml = '<select class="r-model" onchange="window.__markDirty()"><option value="">选择模型…</option>';
    models.forEach((m) => {
      modelHtml += '<option value="' + esc(m) + '"' + (m === upstreamModel ? ' selected' : '') + '>' + esc(m) + '</option>';
    });
    modelHtml += '</select>';
  } else {
    modelHtml = '<input class="r-model" value="' + esc(upstreamModel) + '" placeholder="model" oninput="window.__markDirty()">';
  }
  list.insertAdjacentHTML('beforeend',
    '<div class="r-row"><select class="r-type" onchange="window.__markDirty()"><option value="prefix" selected>前缀</option><option value="exact">精确</option></select>'
    + '<input class="r-match r-value" value="' + esc(matchPattern) + '" oninput="window.__markDirty()">'
    + '<span class="r-arrow">→</span>'
    + '<input class="r-provider" value="' + esc(pv) + '" placeholder="provider" onchange="window.__onRouteProviderInput(this)">'
    + '<span class="r-sep">/</span>' + modelHtml
    + '<button class="r-rem" onclick="window.__removeRoute(this)" title="移除">×</button></div>');
  markDirty();
}

export function addRoute() {
  addRoutePreset('', '');
}

export function removeRoute(btn) {
  btn.closest('.r-row')?.remove();
  markDirty();
}

// ═══════════════════════════════════════════
// Fallback
// ═══════════════════════════════════════════

export function addFallbackRow(btn) {
  btn.insertAdjacentHTML('beforebegin', fallbackRowHtml({ provider: '', upstreamModel: '' }));
  markDirty();
}

// ═══════════════════════════════════════════
// Config Collection & Validation
// ═══════════════════════════════════════════

export function collectConfig() {
  const providers = {};
  const pvName = document.getElementById('pvName');
  const mainName = pvName?.value.trim() || '';
  if (!mainName) { setErrors(['请填写 Provider 名称']); return null; }
  providers[mainName] = collectMainProvider();

  document.querySelectorAll('.pv-card').forEach(card => {
    const nameInput = card.querySelector('.pvcard-name');
    const name = nameInput?.value.trim();
    if (!name || name === mainName) return;
    providers[name] = collectExtraProvider(card);
  });

  const routes = [];
  document.querySelectorAll('.r-row').forEach((row) => {
    const val = row.querySelector('.r-value').value.trim();
    if (!val) return;
    const type = row.querySelector('.r-type').value;
    const match = type === 'exact' ? { exact: val } : { prefix: val };
    const pv = row.querySelector('.r-provider').value.trim() || mainName;
    const modelEl = row.querySelector('.r-model');
    const model = modelEl ? (modelEl.tagName === 'SELECT' ? modelEl.value : modelEl.value.trim()) : '';
    routes.push({ match, provider: pv, upstreamModel: model, fallback: [] });
  });

  const fallbackEditor = document.getElementById('fallbackEditor');
  if (fallbackEditor) {
    fallbackEditor.querySelectorAll('.fb-section').forEach((sec, idx) => {
      if (idx >= routes.length) return;
      const fbs = [];
      sec.querySelectorAll('.fb-row').forEach(row => {
        const inputs = row.querySelectorAll('input');
        const p = inputs[0].value.trim();
        const m = inputs[1].value.trim();
        if (p && m) fbs.push({ provider: p, upstreamModel: m });
      });
      routes[idx].fallback = fbs;
    });
  }

  const svHost = document.getElementById('svHost');
  const svPort = document.getElementById('svPort');
  const svAuth = document.getElementById('svAuth');

  return {
    server: {
      host: svHost?.value.trim() || '127.0.0.1',
      port: parseInt(svPort?.value, 10) || 8787,
      authToken: svAuth?.value.trim() || undefined
    },
    providers,
    routes
  };
}

function validateProfile(name, config) {
  const fieldErrors = {};
  const globalErrors = [];
  const names = Object.keys(config.providers);

  if (!name) fieldErrors['profileName'] = '请填写配置方案名称';
  if (!names.length) globalErrors.push('至少需要一个 Provider');

  // 只校验主 Provider 的字段（表单里展示的那个）
  const mainProviderName = document.getElementById('pvName')?.value.trim() || names[0];
  if (names.length > 0 && config.providers[mainProviderName]) {
    const perr = validateProviderFields(mainProviderName, config.providers[mainProviderName]);
    Object.assign(fieldErrors, perr);
  }

  if (!config.routes.length) globalErrors.push('至少需要一条路由规则');
  config.routes.forEach((r) => {
    if (!r.provider) globalErrors.push('路由 ' + routeLabel(r) + ' 缺少 Provider');
    if (!r.upstreamModel) globalErrors.push('路由 ' + routeLabel(r) + ' 缺少 Upstream Model');
    if (r.provider && names.indexOf(r.provider) < 0) globalErrors.push('路由引用了不存在的 Provider: ' + r.provider);
    (r.fallback || []).forEach((f) => {
      if (names.indexOf(f.provider) < 0) globalErrors.push('Fallback 引用了不存在的 Provider: ' + f.provider);
    });
  });
  return { fieldErrors, globalErrors, valid: Object.keys(fieldErrors).length === 0 && globalErrors.length === 0 };
}

/** 校验单个 Provider 的字段，返回 fieldId → error 映射 */
function validateProviderFields(name, p) {
  const errs = {};
  // 只校验表单中的主 Provider，extra provider 不做字段映射
  if (!p.apiKey) errs['pvApiKey'] = name + ' 缺少 API Key';
  if (!p.baseUrl) errs['pvBaseUrl'] = name + ' 需要 Base URL';
  if (p.baseUrl && !isURL(p.baseUrl)) errs['pvBaseUrl'] = name + ' Base URL 无效';
  if (p.modelsUrl && !isURL(p.modelsUrl)) errs['pvModelsUrl'] = name + ' Models URL 无效';
  if (!p.capabilities || !p.capabilities.contentBlocks.length) errs['pvChips'] = '至少需要一个 Content Block';
  return errs;
}

function routeLabel(r) {
  return r.match && (r.match.exact || r.match.prefix) || '(空匹配)';
}

function isURL(v) {
  try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}

export function setErrors(result) {
  // 清除所有之前的字段错误
  document.querySelectorAll('.field-error').forEach(el => el.remove());

  // 兼容旧的 string[] 格式
  if (Array.isArray(result)) {
    const errBox = document.getElementById('errorBox');
    if (!errBox) return;
    if (!result.length) { errBox.classList.add('hidden'); errBox.innerHTML = ''; return; }
    errBox.innerHTML = result.map(e => '<div>' + esc(e) + '</div>').join('');
    errBox.classList.remove('hidden');
    return;
  }

  // 新格式：字段错误 + 全局错误
  const { fieldErrors, globalErrors } = result;

  // 渲染字段级错误
  for (const [fieldId, msg] of Object.entries(fieldErrors)) {
    const field = document.getElementById(fieldId);
    if (field) {
      const err = document.createElement('div');
      err.className = 'field-error';
      err.textContent = msg;
      field.parentElement?.appendChild(err);
    } else {
      globalErrors.unshift(msg);
    }
  }

  // 渲染全局错误
  const errBox = document.getElementById('errorBox');
  if (!errBox) return;
  if (globalErrors.length) {
    errBox.innerHTML = globalErrors.map(e => '<div>' + esc(e) + '</div>').join('');
    errBox.classList.remove('hidden');
  } else {
    errBox.classList.add('hidden');
    errBox.innerHTML = '';
  }
}

// ═══════════════════════════════════════════
// Save & Activate
// ═══════════════════════════════════════════

export async function doSave() {
  const currentId = store.get('currentId');
  if (!currentId) { toast('请先创建一个配置方案', 'err'); return; }
  const profileName = document.getElementById('profileName');
  const name = profileName?.value.trim() || '';
  const config = collectConfig();
  if (!config) return;
  const vResult = validateProfile(name, config);
  setErrors(vResult);
  if (!vResult.valid) return;
  try {
    const r = await saveProfileApi(currentId, name, config);
    await reloadConfig();
    store.set('dirty', false);
    const saveBtn = document.getElementById('saveBtn');
    if (saveBtn) saveBtn.textContent = '保存';
    const savedAt = document.getElementById('savedAt');
    if (savedAt) savedAt.textContent = '保存于 ' + new Date().toLocaleString('zh-CN') + '，已生效';
    await _loadProfiles();
    store.set('currentId', r.profile.id);
    renderSidebar();
    toast('已保存并生效', 'ok');
  } catch (e) { setErrors([e.message || '保存失败']); toast(e.message || '保存失败', 'err'); }
}

export async function doActivate() {
  const currentId = store.get('currentId');
  if (!currentId) { toast('请先创建一个配置方案', 'err'); return; }
  const profileName = document.getElementById('profileName');
  const name = profileName?.value.trim() || '';
  const config = collectConfig();
  if (!config) return;
  const vResult = validateProfile(name, config);
  setErrors(vResult);
  if (!vResult.valid) return;
  try {
    await saveProfileApi(currentId, name, config);
    await activateProfileApi(currentId);
    await reloadConfig();
    store.set('dirty', false);
    const saveBtn = document.getElementById('saveBtn');
    if (saveBtn) saveBtn.textContent = '保存';
    const savedAt = document.getElementById('savedAt');
    if (savedAt) savedAt.textContent = '已设为当前并保存于 ' + new Date().toLocaleString('zh-CN') + '，已生效';
    await _loadProfiles();
    renderSidebar();
    toast('已设为当前方案并生效', 'ok');
  } catch (e) { setErrors([e.message || '激活失败']); toast(e.message || '激活失败', 'err'); }
}

// ═══════════════════════════════════════════
// Internal rendering helpers (wrap imports)
// ═══════════════════════════════════════════

function _renderRoutesInternal(routes) {
  const routeList = document.getElementById('routeList');
  if (!routeList) return;
  const modelsByProvider = store.get('modelsByProvider') || {};
  routeList.innerHTML = renderRoutes(routes, modelsByProvider);
}

function _renderFallbackEditorInternal(routes) {
  const fallbackEditor = document.getElementById('fallbackEditor');
  if (!fallbackEditor) return;
  fallbackEditor.innerHTML = renderFallbackEditor(routes);
}

function _renderExtraProvidersInternal(providers) {
  const providerCards = document.getElementById('providerCards');
  if (!providerCards) return;
  const pvName = document.getElementById('pvName');
  const mainName = pvName?.value.trim() || '';
  providerCards.innerHTML = renderExtraProviders(providers, mainName);
}

function _renderModelDatalistsInternal() {
  const modelDatalists = document.getElementById('modelDatalists');
  if (!modelDatalists) return;
  const modelsByProvider = store.get('modelsByProvider') || {};
  modelDatalists.innerHTML = renderModelDatalists(modelsByProvider);
}

function _updateRouteListsInternal() {
  const routes = [];
  document.querySelectorAll('.r-row').forEach((row) => {
    const val = row.querySelector('.r-value').value.trim();
    const pv = row.querySelector('.r-provider').value.trim();
    const modelEl = row.querySelector('.r-model');
    const model = modelEl ? (modelEl.tagName === 'SELECT' ? modelEl.value : modelEl.value.trim()) : '';
    const type = row.querySelector('.r-type').value;
    const match = type === 'exact' ? { exact: val } : { prefix: val };
    routes.push({ match, provider: pv, upstreamModel: model, fallback: [] });
  });
  _renderRoutesInternal(routes);
}

// ═══════════════════════════════════════════
// Version History
// ═══════════════════════════════════════════

export async function loadHistory() {
  const currentId = store.get('currentId');
  const historyCard = document.getElementById('historyCard');
  const historyList = document.getElementById('historyList');
  if (!currentId || !historyCard || !historyList) return;

  try {
    const r = await fetchHistory(currentId);
    const entries = r.history || [];

    if (!entries.length) {
      historyCard.style.display = 'none';
      return;
    }

    historyCard.style.display = '';
    let h = '';
    entries.forEach((entry) => {
      const time = new Date(entry.timestamp).toLocaleString('zh-CN');
      const routeCount = entry.config?.routes?.length ?? 0;
      h += '<div class="history-item">' +
        '<div style="flex:1">' +
          '<span class="h-name">' + esc(entry.profileName) + '</span>' +
          '<span class="h-time">' + esc(time) + ' · ' + routeCount + ' 条路由</span>' +
        '</div>' +
        '<div class="h-actions">' +
          '<button class="btn ghost sm" onclick="window.__previewHistory(\'' + entry.id + '\')">预览</button>' +
          '<button class="btn ghost sm" onclick="window.__rollbackHistory(\'' + entry.id + '\')">回滚</button>' +
        '</div>' +
      '</div>';
    });
    historyList.innerHTML = h || '<div style="color:var(--text-tertiary);text-align:center;padding:12px">暂无历史版本</div>';
  } catch {
    historyList.innerHTML = '<div style="color:var(--text-tertiary);text-align:center;padding:12px">加载失败</div>';
  }
}

/** 预览历史版本 JSON（同步打开窗口避免浏览器拦截弹窗） */
export function previewHistory(historyId) {
  const currentId = store.get('currentId');
  if (!currentId) return;

  // 先同步打开空窗口（必须在点击事件同步调用栈中），再异步写入内容
  const w = window.open('', '_blank', 'width=700,height=600');
  if (!w) { toast('弹窗被浏览器拦截，请允许弹窗后重试', 'err'); return; }
  w.document.write('<pre style="font-family:monospace;font-size:12px;padding:16px;background:#0e0e14;color:#e0e0e8">加载中…</pre>');

  fetchHistory(currentId).then(r => {
    const entry = (r.history || []).find((e) => e.id === historyId);
    if (!entry) { w.document.write('<p>版本不存在</p>'); w.close(); return; }
    const json = JSON.stringify(entry.config, null, 2);
    w.document.write('<pre style="font-family:monospace;font-size:12px;padding:16px;background:#0e0e14;color:#e0e0e8;white-space:pre-wrap;word-break:break-all">' + esc(json) + '</pre>');
  }).catch(e => {
    w.document.write('<p style="color:#ff5252;padding:16px">加载失败: ' + esc(e.message) + '</p>');
  });
}

/** 回滚到指定历史版本 */
export async function rollbackHistory(historyId) {
  const currentId = store.get('currentId');
  if (!currentId) return;
  if (!confirm('确定回滚到此历史版本？\n\n当前配置将被替换为所选版本的配置。')) return;
  try {
    const r = await rollbackProfileApi(currentId, historyId);
    if (!r.ok) { toast(r.error || '回滚失败', 'err'); return; }
    await reloadConfig();
    await _loadProfiles();
    // 重新加载编辑器
    await selectProfile(currentId);
    toast('已回滚到历史版本并生效', 'ok');
  } catch (e) { toast(e.message || '回滚失败', 'err'); }
}

// ═══════════════════════════════════════════
// 暴露到 window 供 innerHTML 中的 onclick 使用
// ═══════════════════════════════════════════

// 这些由 app.js 统一挂载

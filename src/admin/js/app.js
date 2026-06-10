/* ═══════════════════════════════════════════════════════
   App 入口 — 初始化 / Tab 切换 / 全局事件绑定
   ═══════════════════════════════════════════════════════ */

import { $, api, fetchProfiles } from './api.js';
import { store } from './state.js';
import { renderDashboard, renderEmptyDashboard, getActiveConfig, testDashProvider, copyEnv, copyCurl } from './views/dashboard.js';
import {
  initConfigView, showEmpty, showEditor, selectProfile, createAndEdit,
  deleteProfile, activateProfile, onBaseUrlSelect, onCustomUrlInput, markDirty,
  loadMainProvider, setMainChips, collectMainProvider, collectExtraProvider, addProviderCard,
  goStep, updateStepUI, fetchMainModels, fetchExtraModels, onRouteProviderInput,
  addRoutePreset, addRoute, removeRoute, addFallbackRow,
  collectConfig, setErrors, doSave, doActivate, emptyConfig,
  loadHistory, previewHistory, rollbackHistory
} from './views/config.js';
import { renderSidebar } from './ui/sidebar.js';
import { startMetricsPoll, stopMetricsPoll } from './ui/metrics.js';
import { toast } from './ui/toast.js';

// ═══════════════════════════════════════════
// Tab 切换
// ═══════════════════════════════════════════

function switchTab(tab) {
  store.set('currentTab', tab);
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.classList.toggle('on', b.dataset.tab === tab);
  });
  const dashboardView = document.getElementById('dashboardView');
  const configView = document.getElementById('configView');
  if (dashboardView) dashboardView.style.display = tab === 'dashboard' ? 'flex' : 'none';
  if (configView) configView.style.display = tab === 'config' ? 'flex' : 'none';
  if (tab === 'dashboard') renderDashboard();
}

// ═══════════════════════════════════════════
// Profile 加载
// ═══════════════════════════════════════════

async function loadProfiles() {
  try {
    const d = await fetchProfiles();
    store.set('profiles', d.profiles || []);
    store.set('activeProfileId', d.activeProfileId || null);
    renderSidebar();
    if (store.get('currentTab') === 'dashboard') renderDashboard();
    const currentId = store.get('currentId');
    const profiles = store.get('profiles');

    if (!currentId && profiles.length) {
      await selectProfile(store.get('activeProfileId') || profiles[0].id);
    } else if (currentId && !profiles.some((x) => x.id === currentId)) {
      store.set('currentId', null);
      showEmpty();
    } else if (!currentId && !profiles.length) {
      showEmpty();
    }
  } catch (e) { toast(e.message || '读取配置失败', 'err'); }
}

// ═══════════════════════════════════════════
// 强制重启
// ═══════════════════════════════════════════

async function forceRestart() {
  if (!confirm('确定要强制重启服务吗？\n\n这会释放当前端口并退出进程。\n仅在 tsx watch 模式下会自动重启。')) return;
  const btn = document.getElementById('restartBtn');
  if (btn) { btn.textContent = '重启中…'; btn.disabled = true; }
  try {
    const r = await api('POST', '/api/admin/kill-port');
    toast(r.message || '端口已释放', 'ok');
  } catch (e) {
    const btn2 = document.getElementById('restartBtn');
    if (btn2) { btn2.textContent = '重启'; btn2.disabled = false; }
    toast(e.message || '重启失败', 'err');
  }
}

// ═══════════════════════════════════════════
// 挂载到 window 供 innerHTML onclick 使用
// ═══════════════════════════════════════════

function mountWindowGlobals() {
  window.__switchTab = switchTab;
  window.__markDirty = markDirty;
  window.__createAndEdit = createAndEdit;
  window.__selectProfile = selectProfile;
  window.__deleteProfile = deleteProfile;
  window.__activateProfile = activateProfile;
  window.__onBaseUrlSelect = onBaseUrlSelect;
  window.__onCustomUrlInput = onCustomUrlInput;
  window.__addProviderCard = addProviderCard;
  window.__goStep = goStep;
  window.__fetchMainModels = fetchMainModels;
  window.__fetchExtraModels = fetchExtraModels;
  window.__onRouteProviderInput = onRouteProviderInput;
  window.__addRoutePreset = addRoutePreset;
  window.__addRoute = addRoute;
  window.__removeRoute = removeRoute;
  window.__addFallbackRow = addFallbackRow;
  window.__doSave = doSave;
  window.__doActivate = doActivate;
  window.__forceRestart = forceRestart;
  window.__testDashProvider = testDashProvider;
  window.__copyEnv = copyEnv;
  window.__copyCurl = copyCurl;
  window.__previewHistory = previewHistory;
  window.__rollbackHistory = rollbackHistory;
}

// ═══════════════════════════════════════════
// 初始化
// ═══════════════════════════════════════════

async function init() {
  // 注入回调给 config 视图（避免循环导入）
  initConfigView(loadProfiles, switchTab);

  // 挂载全局函数供 innerHTML onclick 使用
  mountWindowGlobals();

  // 绑定 tab 按钮
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // 绑定重启按钮
  const restartBtn = document.getElementById('restartBtn');
  if (restartBtn) restartBtn.addEventListener('click', forceRestart);

  // 绑定配置视图按钮（不在 innerHTML 中的）
  const emptyStateBtn = document.querySelector('#emptyState .btn.primary');
  if (emptyStateBtn) emptyStateBtn.addEventListener('click', createAndEdit);

  // 绑定仪表盘空状态按钮
  const dashEmptyBtn = document.querySelector('#dashEmpty .btn.primary');
  if (dashEmptyBtn) {
    dashEmptyBtn.addEventListener('click', () => {
      switchTab('config');
      setTimeout(() => createAndEdit(), 200);
    });
  }

  // 绑定 quick action copy 按钮
  const copyEnvBtn = document.getElementById('copyEnvBtn');
  if (copyEnvBtn) copyEnvBtn.addEventListener('click', copyEnv);
  const copyCurlBtn = document.getElementById('copyCurlBtn');
  if (copyCurlBtn) copyCurlBtn.addEventListener('click', copyCurl);

  // 绑定接入指南折叠
  const guideHeader = document.getElementById('guideHeader');
  if (guideHeader) {
    guideHeader.addEventListener('click', () => {
      const body = document.getElementById('guideBody');
      const icon = document.getElementById('guideIcon');
      const toggle = document.getElementById('guideToggle');
      if (body) {
        const collapsed = body.classList.toggle('collapsed');
        if (icon) icon.textContent = collapsed ? '▸' : '▾';
        if (toggle) toggle.textContent = collapsed ? '展开' : '收起';
      }
    });
  }

  // 绑定步骤导航
  document.querySelectorAll('.step').forEach((s) => {
    s.addEventListener('click', () => goStep(parseInt(s.dataset.step, 10)));
  });

  // 绑定版本历史折叠
  const historyHeader = document.getElementById('historyHeader');
  if (historyHeader) {
    historyHeader.addEventListener('click', () => {
      const body = document.getElementById('historyBody');
      const toggle = document.getElementById('historyToggle');
      if (body) {
        const collapsed = body.classList.toggle('collapsed');
        if (toggle) toggle.textContent = collapsed ? '展开' : '收起';
      }
    });
  }

  // 绑定上一步/下一步按钮
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  if (prevBtn) prevBtn.addEventListener('click', () => goStep(store.get('currentStep') - 1));
  if (nextBtn) nextBtn.addEventListener('click', () => goStep(store.get('currentStep') + 1));

  // 初始加载
  loadProfiles();
  startMetricsPoll();
}

init();

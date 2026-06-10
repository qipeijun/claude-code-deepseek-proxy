/* ═══════════════════════════════════════════════════════
   方案侧边栏渲染
   ═══════════════════════════════════════════════════════ */

import { $, esc } from '../api.js';
import { store } from '../state.js';

export function renderSidebar() {
  const profiles = store.get('profiles');
  const activeProfileId = store.get('activeProfileId');
  const currentId = store.get('currentId');

  let h = '';
  profiles.forEach(p => {
    const isActive = p.id === activeProfileId;
    const isSel = p.id === currentId;
    h += '<div class="profile-item' + (isSel ? ' current' : '') + (isActive ? ' active' : '')
      + '" onclick="window.__selectProfile(\'' + p.id + '\')">';
    h += '<div class="profile-name">' + esc(p.name) + (isActive ? ' <span class="badge">当前</span>' : '') + '</div>';
    h += '<div class="profile-meta">' + (p.config && p.config.routes ? p.config.routes.length : 0) + ' 条路由</div>';
    h += '<div class="profile-actions">';
    if (!isActive) h += '<button class="btn ghost sm" onclick="event.stopPropagation();window.__activateProfile(\'' + p.id + '\')">设为当前</button>';
    h += '<button class="btn ghost sm danger" onclick="event.stopPropagation();window.__deleteProfile(\'' + p.id + '\')">删除</button>';
    h += '</div></div>';
  });
  if (!profiles.length) h = '<div style="padding:20px;text-align:center;color:var(--text-tertiary);font-size:12px">暂无方案</div>';
  h += '<div style="padding:8px 10px"><button class="btn ghost" style="width:100%" onclick="window.__createAndEdit()">+ 新建</button></div>';
  $('profileList').innerHTML = h;
}

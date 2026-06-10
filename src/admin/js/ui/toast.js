/* ═══════════════════════════════════════════════════════
   Toast 通知
   ═══════════════════════════════════════════════════════ */

import { $ } from '../api.js';

export function toast(m, t) {
  const el = document.createElement('div');
  el.className = 'toast ' + (t === 'err' ? 'err' : 'ok');
  el.textContent = m;
  $('toastWrap').appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

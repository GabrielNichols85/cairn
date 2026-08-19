/* ============================================================
   Cairn — shared UI primitives: icons, toasts, modals.
   ============================================================ */
import { el } from './util.js';

/* ---------- icons (CSS masks, so they inherit text colour) ---------- */
const S = (body, opts = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23000" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${opts}>${body}</svg>`;

export const ICONS = {
  today: S(`<circle cx='12' cy='12' r='4'/><path d='M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M6 18l-1.4 1.4M19.4 4.6L18 6'/>`),
  wall: S(`<rect x='3.2' y='3.2' width='7.2' height='7.2' rx='1.8'/><rect x='13.6' y='3.2' width='7.2' height='7.2' rx='1.8'/><rect x='3.2' y='13.6' width='7.2' height='7.2' rx='1.8'/><rect x='13.6' y='13.6' width='7.2' height='7.2' rx='1.8'/>`),
  answered: S(`<circle cx='12' cy='12' r='9'/><path d='m8.2 12.3 2.5 2.5 5.1-5.4'/>`),
  journal: S(`<path d='M5.5 4.2A2.2 2.2 0 0 1 7.7 2H19v20H7.7a2.2 2.2 0 0 1-2.2-2.2z'/><path d='M5.5 17.4h13.5'/><path d='M9.5 7h5.5'/>`),
  settings: S(`<path d='M3.5 7h17M3.5 12h17M3.5 17h17'/><circle cx='9' cy='7' r='2.1' fill='%23fff'/><circle cx='15' cy='12' r='2.1' fill='%23fff'/><circle cx='8' cy='17' r='2.1' fill='%23fff'/>`),
};

export function applyIcons(root = document) {
  root.querySelectorAll('[data-ico]').forEach((n) => {
    const svg = ICONS[n.dataset.ico];
    if (!svg) return;
    const url = `url("data:image/svg+xml,${svg.replace(/"/g, "'").replace(/</g, '%3C').replace(/>/g, '%3E')}")`;
    n.style.webkitMaskImage = url;
    n.style.maskImage = url;
  });
}

/* ---------- toast ---------- */
const toastRoot = () => document.getElementById('toastRoot');

export function toast(message, { action, actionLabel, duration = 3600 } = {}) {
  const root = toastRoot();
  const node = el('div', { class: 'toast' }, el('span', { text: message }));
  let done = false;
  const close = () => {
    if (done) return; done = true;
    node.classList.add('out');
    setTimeout(() => node.remove(), 240);
  };
  if (action && actionLabel) {
    node.append(el('button', {
      type: 'button', text: actionLabel,
      onclick: () => { action(); close(); },
    }));
  }
  root.append(node);
  setTimeout(close, duration);
  return close;
}

/* ---------- modal ---------- */
let closeCurrentModal = null;

export function modal({ title, subtitle, content, actions = [], onClose, width }) {
  closeModal();
  const root = document.getElementById('modalRoot');
  const box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' });
  if (width) box.style.maxWidth = width;
  if (title) box.append(el('h2', { class: 'modal-title', text: title }));
  if (subtitle) box.append(el('p', { class: 'modal-sub', text: subtitle }));
  if (content) box.append(content);

  if (actions.length) {
    const bar = el('div', { class: 'modal-actions' });
    actions.forEach((a) => {
      bar.append(el('button', {
        type: 'button',
        class: `btn ${a.variant === 'primary' ? 'btn-primary' : a.variant === 'danger' ? 'btn-danger' : 'btn-ghost'}`,
        text: a.label,
        onclick: () => { const keep = a.onClick?.(); if (!keep) closeModal(); },
      }));
    });
    box.append(bar);
  }

  root.replaceChildren(box);
  root.hidden = false;

  const onKey = (e) => {
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Tab') trapFocus(e, box);
  };
  const onBackdrop = (e) => { if (e.target === root) closeModal(); };
  document.addEventListener('keydown', onKey);
  root.addEventListener('mousedown', onBackdrop);

  closeCurrentModal = () => {
    document.removeEventListener('keydown', onKey);
    root.removeEventListener('mousedown', onBackdrop);
    root.hidden = true;
    root.replaceChildren();
    closeCurrentModal = null;
    onClose?.();
  };

  setTimeout(() => (box.querySelector('[data-autofocus]') ?? box.querySelector('input,textarea,button'))?.focus(), 30);
  return closeModal;
}

export function closeModal() { closeCurrentModal?.(); }

function trapFocus(e, box) {
  const items = [...box.querySelectorAll('a[href],button,textarea,input,select,[tabindex]:not([tabindex="-1"])')]
    .filter((n) => !n.disabled && n.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/* ---------- confirm ---------- */
export function confirmDialog({ title, subtitle, confirmLabel = 'Delete', danger = true, onConfirm }) {
  modal({
    title, subtitle,
    actions: [
      { label: 'Cancel' },
      { label: confirmLabel, variant: danger ? 'danger' : 'primary', onClick: onConfirm },
    ],
  });
}

/* ---------- checkbox markup helper ---------- */
export const checkSvg = () => {
  const wrap = el('span', { class: 'check-box' });
  wrap.innerHTML = `<svg viewBox="0 0 16 16"><polyline points="2.5,8.5 6.2,12 13.5,4.5"/></svg>`;
  return wrap;
};

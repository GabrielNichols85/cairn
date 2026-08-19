/* ============================================================
   Cairn — the prayer wall.

   Wide screens: a real board. Click any empty spot and start
   typing; drag a note anywhere; drag it onto the ribbon at the
   bottom to move it to Answered.

   Narrow screens: the same notes in a tidy flow layout, because
   free-dragging on a phone is worse than useless. Same data,
   same actions, different surface.
   ============================================================ */
import { el, clamp, fmtDate, debounce } from '../util.js';
import { prayers } from '../store.js';
import { toast, modal, confirmDialog } from '../ui.js';

const NOTE_W = 186, NOTE_H = 108;
const CANVAS_MIN = 720;

export function renderWall(root, ctx) {
  const canvasMode = window.innerWidth >= CANVAS_MIN;

  const head = el('div', { class: 'page-head' },
    el('div', { class: 'eyebrow', text: 'Prayer wall' }),
    el('h1', { class: 'page-title', text: 'What are you bringing to God?' }),
    el('p', {
      class: 'page-sub',
      text: canvasMode
        ? 'Click anywhere on the wall and start typing. Drag a note to move it, or drag it down to the ribbon when God answers.'
        : 'Add a prayer, and tap Answered when God comes through.',
    }),
  );

  const bar = el('div', { class: 'wall-bar' });
  const addBtn = el('button', { class: 'btn btn-primary', type: 'button' }, '+ Add a prayer');
  bar.append(addBtn);
  const count = prayers.active().length;
  bar.append(el('span', {
    class: 'wall-hint',
    text: count ? `${count} open ${count === 1 ? 'prayer' : 'prayers'}` : '',
  }));

  const wall = el('div', { class: `wall ${canvasMode ? 'canvas' : 'flow'}` });
  const dropzone = el('div', { class: 'dropzone' }, '↓  Drop here when it has been answered');
  if (canvasMode) wall.append(dropzone);

  root.replaceChildren(el('div', { class: 'wrap-wide' }, head, bar, wall));

  /* ---------- rendering ---------- */
  const draw = () => {
    [...wall.querySelectorAll('.note,.wall-placeholder')].forEach((n) => n.remove());
    const list = prayers.active();

    if (!list.length) {
      wall.append(el('div', { class: 'wall-placeholder' },
        el('div', {},
          el('div', { class: 'ph-title', text: 'The wall is empty' }),
          el('p', { text: canvasMode ? 'Click anywhere here to write your first prayer.' : 'Tap “Add a prayer” to begin.' }),
        ),
      ));
    }
    list.slice().reverse().forEach((p) => wall.append(noteEl(p)));
  };

  function noteEl(p, isNew = false) {
    const n = el('div', { class: `note c${p.color || 1}${isNew ? ' is-new' : ''}`, dataset: { id: p.id } });
    if (canvasMode) place(n, p);

    const bodyEl = el('div', { class: 'note-body', text: p.body || '' });
    n.append(bodyEl);

    const colorBtn = el('button', {
      class: 'note-tool', type: 'button', title: 'Change colour', 'aria-label': 'Change colour',
      onclick: (e) => {
        e.stopPropagation();
        const next = ((p.color || 1) % 6) + 1;
        prayers.update(p.id, { color: next });
        n.className = `note c${next}`;
        if (canvasMode) place(n, p);
      },
    }, '\u25D0');

    const delBtn = el('button', {
      class: 'note-tool del', type: 'button', title: 'Delete', 'aria-label': 'Delete prayer',
      onclick: (e) => { e.stopPropagation(); removePrayer(p, n); },
    }, '\u00D7');

    const dateEl = el('span', { class: 'note-date', text: `prayed ${fmtDate(p.createdAt, { month: 'short', day: 'numeric' })}` });

    if (canvasMode) {
      // Board: date tucked in the corner, tools revealed on hover.
      n.append(dateEl);
      n.append(el('div', { class: 'note-tools' }, colorBtn, delBtn));
    } else {
      // Phone: one honest row of controls, nothing overlapping anything.
      n.append(el('div', { class: 'note-foot' },
        dateEl,
        el('span', { class: 'spacer' }),
        el('button', {
          class: 'note-answer-btn', type: 'button',
          onclick: (e) => { e.stopPropagation(); askAnswered(p, n); },
        }, '\u2713 Answered'),
        colorBtn,
        delBtn,
      ));
    }

    /* click to edit / drag to move */
    let start = null, moved = false, ghost = null;

    const beginEdit = () => editNote(n, p);

    n.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.note-tool, .note-answer-btn') || n.querySelector('textarea')) return;
      if (e.button !== undefined && e.button !== 0) return;
      moved = false;
      if (!canvasMode) { start = { fired: false }; return; }
      const rect = n.getBoundingClientRect();
      start = { px: e.clientX, py: e.clientY, ox: e.clientX - rect.left, oy: e.clientY - rect.top };
      n.setPointerCapture(e.pointerId);
    });

    n.addEventListener('pointermove', (e) => {
      if (!start || !canvasMode) return;
      const dx = e.clientX - start.px, dy = e.clientY - start.py;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved) {
        moved = true;
        n.classList.add('dragging');
        wall.classList.add('dragging-note');
      }
      const wr = wall.getBoundingClientRect();
      n.style.left = `${clamp(e.clientX - wr.left - start.ox, 0, wr.width - n.offsetWidth)}px`;
      n.style.top = `${clamp(e.clientY - wr.top - start.oy, 0, wr.height - n.offsetHeight)}px`;
      dropzone.classList.toggle('hot', overDropzone(e));
      ghost = e;
    });

    const finish = (e) => {
      if (!start) return;
      const wasDrag = moved;
      start = null; moved = false;
      n.classList.remove('dragging');
      wall.classList.remove('dragging-note');
      dropzone.classList.remove('hot');

      if (!wasDrag) { beginEdit(); return; }
      if (canvasMode && overDropzone(e ?? ghost)) { askAnswered(p, n); return; }

      const wr = wall.getBoundingClientRect();
      prayers.update(p.id, {
        x: (parseFloat(n.style.left) / wr.width) * 100,
        y: (parseFloat(n.style.top) / wr.height) * 100,
      });
    };

    n.addEventListener('pointerup', finish);
    n.addEventListener('pointercancel', () => { start = null; moved = false; n.classList.remove('dragging'); wall.classList.remove('dragging-note'); });

    n.tabIndex = 0;
    n.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !n.querySelector('textarea')) { e.preventDefault(); beginEdit(); }
    });

    return n;
  }

  function place(n, p) {
    const wr = wall.getBoundingClientRect();
    const w = wr.width || 800, h = wr.height || 600;
    n.style.left = `${clamp(((p.x ?? 10) / 100) * w, 0, Math.max(0, w - NOTE_W))}px`;
    n.style.top = `${clamp(((p.y ?? 10) / 100) * h, 0, Math.max(0, h - NOTE_H))}px`;
  }

  const overDropzone = (e) => {
    if (!e) return false;
    const r = dropzone.getBoundingClientRect();
    return e.clientX >= r.left - 26 && e.clientX <= r.right + 26 &&
           e.clientY >= r.top - 26 && e.clientY <= r.bottom + 26;
  };

  /* ---------- editing ---------- */
  function editNote(n, p) {
    if (n.querySelector('textarea')) return;
    const body = n.querySelector('.note-body');
    const ta = el('textarea', {
      class: 'note-editor', rows: 3, placeholder: 'Type your prayer…',
      'aria-label': 'Prayer text',
    });
    ta.value = p.body || '';
    body.replaceWith(ta);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);

    const save = debounce((v) => prayers.update(p.id, { body: v }), 500);
    ta.addEventListener('input', () => save(ta.value));
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); ta.blur(); }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); ta.blur(); }
    });
    ta.addEventListener('blur', () => {
      save.flush(ta.value);
      const text = ta.value.trim();
      if (!text) { prayers.remove(p.id); n.remove(); return; }
      const fresh = el('div', { class: 'note-body', text });
      ta.replaceWith(fresh);
    });
  }

  /* ---------- create ---------- */
  function addAt(xPct, yPct) {
    const p = prayers.create({ x: xPct, y: yPct, color: (prayers.all().length % 6) + 1 });
    const n = noteEl(p, true);
    wall.querySelector('.wall-placeholder')?.remove();
    wall.append(n);
    editNote(n, p);
  }

  addBtn.addEventListener('click', () => {
    if (!canvasMode) return addAt(0, 0);
    const wr = wall.getBoundingClientRect();
    const cols = Math.max(1, Math.floor(wr.width / (NOTE_W + 22)));
    const i = prayers.active().length;
    addAt(((i % cols) * (NOTE_W + 22) + 20) / wr.width * 100,
          (Math.floor(i / cols) * (NOTE_H + 22) + 20) / wr.height * 100);
  });

  if (canvasMode) {
    wall.addEventListener('click', (e) => {
      if (e.target !== wall && !e.target.closest('.wall-placeholder')) return;
      const wr = wall.getBoundingClientRect();
      addAt(clamp(e.clientX - wr.left - NOTE_W / 2, 0, wr.width - NOTE_W) / wr.width * 100,
            clamp(e.clientY - wr.top - 22, 0, wr.height - NOTE_H) / wr.height * 100);
    });
  }

  /* ---------- answered ---------- */
  function askAnswered(p, n) {
    const ta = el('textarea', {
      class: 'field', rows: 3, 'data-autofocus': '',
      placeholder: 'How did God answer? (optional, but you will be glad you wrote it)',
    });
    const commit = () => {
      prayers.markAnswered(p.id, ta.value.trim());
      n.classList.add('leaving');
      setTimeout(() => { n.remove(); ctx.refreshChrome(); if (!prayers.active().length) draw(); }, 300);
      toast('Moved to Answered. Cairn will bring this back to you later.');
    };
    modal({
      title: 'Answered',
      subtitle: p.body,
      content: ta,
      actions: [
        { label: 'Cancel' },
        { label: 'Save', variant: 'primary', onClick: commit },
      ],
    });
  }

  function removePrayer(p, n) {
    confirmDialog({
      title: 'Delete this prayer?',
      subtitle: 'It will not move to Answered — it will be gone.',
      onConfirm: () => {
        const copy = prayers.remove(p.id);
        n.classList.add('leaving');
        setTimeout(() => { n.remove(); if (!prayers.active().length) draw(); }, 300);
        toast('Prayer deleted.', { actionLabel: 'Undo', action: () => { prayers.restore(copy); draw(); } });
      },
    });
  }

  requestAnimationFrame(draw);

  const onResize = () => {
    if ((window.innerWidth >= CANVAS_MIN) !== canvasMode) { ctx.rerender(); return; }
    if (canvasMode) wall.querySelectorAll('.note').forEach((n) => {
      const p = prayers.get(n.dataset.id); if (p) place(n, p);
    });
  };
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}

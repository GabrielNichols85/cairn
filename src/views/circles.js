/* ============================================================
   Cairn, prayer circles.

   A circle is a small group of people who pray for each other.
   Your wall stays private. You lift individual prayers into a
   circle, one at a time, on purpose.
   ============================================================ */
import { el, fmtDate, waitText } from '../util.js';
import { circles, circleWall, circlesAvailable, cloudReady, pendingJoin, me } from '../circles.js';
import { modal, closeModal, toast, confirmDialog } from '../ui.js';

const SORTS = [
  ['newest', 'Newest'],
  ['needs', 'Needs prayer'],
  ['most', 'Most prayed for'],
  ['answered', 'Answered'],
];

export function renderCircles(root, ctx, params = {}) {
  // An invite comes first. Somebody arriving from a link has not signed in yet,
  // and turning them away at the door loses the invite.
  if (params.join) return renderJoin(root, ctx, params.join);
  if (!circlesAvailable()) return renderSignedOut(root, ctx);
  if (params.id) return renderCircle(root, ctx, params);
  return renderIndex(root, ctx);
}

/* ================================================================
   Not signed in
   ================================================================ */
function renderSignedOut(root, ctx) {
  root.replaceChildren(el('div', { class: 'wrap' },
    el('div', { class: 'page-head' },
      el('div', { class: 'eyebrow', text: 'Circles' }),
      el('h1', { class: 'page-title', text: 'Pray with people you trust' }),
      el('p', { class: 'page-sub', text: 'A circle is a small group who pray for each other. Your wall stays private. You choose individual prayers to share, one at a time.' }),
    ),
    el('div', { class: 'empty' },
      el('div', { class: 'empty-title', text: 'Circles need an account' }),
      el('p', { text: 'Sign in so your circles can follow you between devices.' }),
      el('div', { style: 'margin-top:18px' },
        el('button', { class: 'btn btn-primary', type: 'button', onclick: () => ctx.showAuth() }, 'Sign in'),
      ),
    ),
  ));
}

/* ================================================================
   The list of your circles
   ================================================================ */
function renderIndex(root, ctx) {
  const wrap = el('div', { class: 'wrap' });
  wrap.append(el('div', { class: 'page-head' },
    el('div', { class: 'eyebrow', text: 'Circles' }),
    el('h1', { class: 'page-title', text: 'Pray with people you trust' }),
    el('p', { class: 'page-sub', text: 'Your wall stays private. You lift individual prayers into a circle when you want people praying with you.' }),
  ));

  wrap.append(el('div', { class: 'row', style: 'margin-bottom:18px' },
    el('button', { class: 'btn btn-primary', type: 'button', onclick: () => createDialog(ctx) }, '+ New circle'),
    el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => joinDialog(ctx) }, 'Join with a link'),
  ));

  const list = el('div', { class: 'entry-list' }, el('div', { class: 'scripture-loading', text: 'Loading your circles…' }));
  wrap.append(list);
  root.replaceChildren(wrap);

  circles.list().then((rows) => {
    if (!rows.length) {
      list.replaceChildren(el('div', { class: 'empty' },
        el('div', { class: 'empty-title', text: 'No circles yet' }),
        el('p', { text: 'Make one for your small group, your family, or the two friends who always ask how you are.' }),
      ));
      return;
    }
    list.replaceChildren(...rows.map((c) => el('button', {
      class: 'entry', type: 'button', onclick: () => ctx.go('circles', { id: c.id, name: c.name }),
    },
      el('div', { class: 'entry-top' },
        el('span', { class: 'entry-kind', text: c.isOwner ? 'You started this' : 'Member' }),
        el('span', { class: 'entry-date', text: `${c.memberCount} ${c.memberCount === 1 ? 'person' : 'people'}` }),
      ),
      el('div', { class: 'entry-title', text: c.name }),
    )));
  }).catch(() => {
    list.replaceChildren(el('div', { class: 'callout', text: 'Could not load your circles. Check your connection and try again.' }));
  });
}

function createDialog(ctx) {
  const input = el('input', { class: 'field', type: 'text', 'data-autofocus': '', placeholder: 'Tuesday small group' });
  modal({
    title: 'New circle',
    subtitle: 'Name it something the people in it would recognise.',
    content: input,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Create', variant: 'primary',
        onClick: () => {
          const name = input.value.trim();
          if (!name) return true;
          circles.create(name)
            .then((id) => { toast('Circle created.'); ctx.go('circles', { id, name }); })
            .catch(() => toast('Could not create that circle.'));
        },
      },
    ],
  });
}

function joinDialog(ctx) {
  const input = el('input', { class: 'field', type: 'text', 'data-autofocus': '', placeholder: 'Paste the invite link' });
  modal({
    title: 'Join a circle',
    subtitle: 'Paste the link somebody sent you.',
    content: input,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Join', variant: 'primary',
        onClick: () => {
          const token = (input.value.trim().split('/join/')[1] || input.value.trim()).replace(/[#?].*$/, '');
          if (!token) return true;
          ctx.go('circles', { join: token });
        },
      },
    ],
  });
}

/* ================================================================
   Joining from a link
   ================================================================ */
function renderJoin(root, ctx, token) {
  const box = el('div', { class: 'card card-pad', style: 'text-align:center;max-width:420px;margin:60px auto' },
    el('div', { class: 'scripture-loading', text: 'Checking that invite…' }),
  );
  root.replaceChildren(el('div', { class: 'wrap' }, box));

  if (!cloudReady()) {
    box.replaceChildren(el('div', { class: 'callout', text: 'This copy of Cairn is not set up for accounts, so invites cannot be opened here.' }));
    return;
  }

  circles.preview(token).then((info) => {
    if (!info) {
      box.replaceChildren(
        el('div', { class: 'empty-title', text: 'That invite is not valid' }),
        el('p', { class: 'page-sub', style: 'margin:8px auto 0', text: 'It may have been revoked, or the link may be incomplete. Ask whoever sent it for a fresh one.' }),
        el('div', { style: 'margin-top:18px' },
          el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => ctx.go('circles') }, 'Back to circles'),
        ),
      );
      return;
    }
    box.replaceChildren(
      el('div', { class: 'eyebrow', text: 'You have been invited to' }),
      el('h2', { class: 'page-title', style: 'margin:6px 0 4px', text: info.name }),
      el('p', { class: 'page-sub', style: 'margin:0 auto', text: `${info.member_count} ${info.member_count === 1 ? 'person is' : 'people are'} in this circle. You will be able to see prayers they have shared, including ones shared before you joined.` }),
      el('div', { class: 'row', style: 'justify-content:center;margin-top:20px' },
        circlesAvailable()
          ? el('button', {
              class: 'btn btn-primary', type: 'button',
              onclick: (e) => {
                e.currentTarget.disabled = true;
                circles.join(token)
                  .then((id) => { toast(`You are in ${info.name}.`); ctx.go('circles', { id, name: info.name }); })
                  .catch(() => { toast('Could not join that circle.'); e.currentTarget.disabled = false; });
              },
            }, 'Join this circle')
          : el('button', {
              class: 'btn btn-primary', type: 'button',
              onclick: () => { pendingJoin.set(token); ctx.showAuth(); },
            }, 'Sign in to join'),
        el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => ctx.go('today') }, 'Not now'),
      ),
      circlesAvailable() ? null : el('p', { class: 'hint', style: 'margin-top:12px', text: 'Cairn will bring you straight back here once you are signed in.' }),
    );
  }).catch(() => {
    box.replaceChildren(el('div', { class: 'callout', text: 'Could not check that invite right now.' }));
  });
}

/* ================================================================
   One circle
   ================================================================ */
function renderCircle(root, ctx, params) {
  const { id } = params;
  let sort = params.sort || 'newest';

  const wrap = el('div', { class: 'wrap' });
  const title = el('h1', { class: 'page-title', text: params.name || 'Circle' });

  wrap.append(el('div', { class: 'page-head' },
    el('div', { class: 'row' },
      el('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: () => ctx.go('circles') }, '← All circles'),
    ),
    title,
    el('p', { class: 'page-sub', text: 'Everything people in this circle have chosen to share.' }),
  ));

  const bar = el('div', { class: 'row', style: 'margin-bottom:16px' });
  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Sort' });
  SORTS.forEach(([key, label]) => {
    seg.append(el('button', {
      type: 'button', 'aria-pressed': String(sort === key),
      onclick: () => { sort = key; [...seg.children].forEach((b, i) => b.setAttribute('aria-pressed', String(SORTS[i][0] === key))); load(); },
    }, label));
  });
  bar.append(seg, el('span', { class: 'spacer' }),
    el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => peopleDialog(ctx, params) }, 'People'),
    el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => inviteDialog(ctx, params) }, 'Invite'),
  );
  wrap.append(bar);

  const list = el('div', { class: 'entry-list' }, el('div', { class: 'scripture-loading', text: 'Loading…' }));
  wrap.append(list);
  root.replaceChildren(wrap);

  function load() {
    list.replaceChildren(el('div', { class: 'scripture-loading', text: 'Loading…' }));
    circleWall.prayers(id, sort).then((rows) => {
      if (!rows.length) {
        list.replaceChildren(el('div', { class: 'empty' },
          el('div', { class: 'empty-title', text: sort === 'answered' ? 'Nothing answered yet' : 'Nothing shared yet' }),
          el('p', { text: sort === 'answered' ? 'When somebody marks a shared prayer answered, it will be kept here.' : 'Go to your prayer wall, open a prayer, and share it with this circle.' }),
          el('div', { style: 'margin-top:18px' },
            el('button', { class: 'btn btn-primary', type: 'button', onclick: () => ctx.go('wall') }, 'Go to your wall'),
          ),
        ));
        return;
      }
      list.replaceChildren(...rows.map((p) => prayerCard(p, load)));
    }).catch(() => {
      list.replaceChildren(el('div', { class: 'callout', text: 'Could not load this circle.' }));
    });
  }
  load();
}

function prayerCard(p, reload) {
  const card = el('div', { class: `circle-prayer${p.status === 'answered' ? ' is-answered' : ''}` });

  card.append(el('div', { class: 'cp-head' },
    avatar(p),
    el('div', {},
      el('div', { class: 'cp-author', text: p.isMine ? 'You' : p.author }),
      el('div', { class: 'cp-when', text: `prayed ${fmtDate(p.createdAt, { month: 'short', day: 'numeric' })}` }),
    ),
  ));

  card.append(el('div', { class: 'cp-body', text: (p.body || '').trim() }));

  if (p.status === 'answered') {
    card.append(el('div', { class: 'cp-answered' },
      el('span', { class: 'pill' }, '✓ answered'),
      el('span', { style: 'font-size:12px;color:var(--muted);margin-left:8px', text: waitText(p.createdAt, p.answeredAt) }),
    ));
    if (p.answeredNote) card.append(el('div', { class: 'answered-note', text: p.answeredNote }));
  }

  const count = el('span', { class: 'cp-count', text: countText(p.prayerCount) });

  const btn = el('button', {
    class: `cp-pray${p.prayedToday ? ' done' : ''}`, type: 'button',
    disabled: p.status === 'answered',
  }, p.prayedToday ? '✓ Prayed today' : 'I prayed for this');

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      if (p.prayedToday) { await circleWall.unpray(p.id); p.prayerCount = Math.max(0, p.prayerCount - 1); }
      else { await circleWall.pray(p.id); p.prayerCount += 1; toast('Recorded. Thank you for praying.'); }
      p.prayedToday = !p.prayedToday;
      btn.textContent = p.prayedToday ? '✓ Prayed today' : 'I prayed for this';
      btn.classList.toggle('done', p.prayedToday);
      count.textContent = countText(p.prayerCount);
    } catch {
      toast('Could not record that.');
    }
    btn.disabled = false;
  });

  const foot = el('div', { class: 'cp-foot' }, count, el('span', { class: 'spacer' }));
  if (p.status !== 'answered') foot.append(btn);
  card.append(foot);
  return card;
}

const countText = (n) =>
  n === 0 ? 'Nobody has prayed for this yet'
  : n === 1 ? '1 person has prayed for this'
  : `${n} people have prayed for this`;

function avatar(p) {
  const a = el('span', { class: 'avatar', style: 'width:30px;height:30px;font-size:12px' });
  if (p.avatar) a.append(el('img', { src: p.avatar, alt: '', referrerpolicy: 'no-referrer' }));
  else a.textContent = (p.isMine ? 'You' : p.author || '?').slice(0, 1).toUpperCase();
  return a;
}

/* ---------- invite ---------- */
function inviteDialog(ctx, params) {
  const body = el('div');
  body.append(el('div', { class: 'scripture-loading', text: 'Loading the link…' }));

  modal({
    title: 'Invite people',
    subtitle: 'Anyone holding this link can join this circle and read everything shared in it.',
    content: body,
    actions: [{ label: 'Done', variant: 'primary' }],
  });

  circles.list().then((rows) => {
    const c = rows.find((x) => x.id === params.id);
    if (!c) { body.replaceChildren(el('div', { class: 'callout', text: 'Could not load the invite link.' })); return; }
    const link = circles.linkFor(c.join_token);
    const field = el('input', { class: 'field', type: 'text', readonly: '', value: link });
    field.addEventListener('focus', () => field.select());

    body.replaceChildren(
      field,
      el('div', { class: 'row', style: 'margin-top:10px' },
        el('button', {
          class: 'btn btn-primary btn-sm', type: 'button',
          onclick: () => navigator.clipboard?.writeText(link).then(() => toast('Link copied.')).catch(() => toast('Select the link and copy it.')),
        }, 'Copy link'),
        c.isOwner ? el('button', {
          class: 'btn btn-ghost btn-sm', type: 'button',
          onclick: () => confirmDialog({
            title: 'Make a new link?',
            subtitle: 'Every link you have already given out will stop working. People already in the circle stay in.',
            confirmLabel: 'Make a new link', danger: false,
            onConfirm: () => circles.regenerateLink(params.id).then(() => { closeModal(); toast('New link created.'); }),
          }),
        }, 'Replace link') : null,
      ),
      el('div', { class: 'hint', text: 'Treat it like a house key. If it reaches somebody it should not, replace it.' }),
    );
  });
}

/* ---------- people ---------- */
function peopleDialog(ctx, params) {
  const body = el('div', {}, el('div', { class: 'scripture-loading', text: 'Loading…' }));
  modal({ title: 'People in this circle', content: body, actions: [{ label: 'Done', variant: 'primary' }] });

  Promise.all([circles.members(params.id), circles.list()]).then(([members, all]) => {
    const c = all.find((x) => x.id === params.id);
    const rows = members.map((m) => el('div', { class: 'set-row' },
      el('span', { class: 'row', style: 'gap:10px' },
        avatar({ avatar: m.avatar, author: m.name, isMine: m.user_id === me() }),
        el('span', {},
          el('div', { class: 'set-t', text: m.user_id === me() ? `${m.name} (you)` : m.name }),
          el('div', { class: 'set-s', text: m.role === 'owner' ? 'Started this circle' : `Joined ${fmtDate(m.joined_at)}` }),
        ),
      ),
      el('span', { class: 'spacer' }),
      c?.isOwner && m.user_id !== me()
        ? el('button', {
            class: 'btn btn-quiet btn-sm', type: 'button',
            onclick: () => confirmDialog({
              title: `Remove ${m.name}?`,
              subtitle: 'They will immediately lose access to everything shared in this circle.',
              confirmLabel: 'Remove',
              onConfirm: () => circles.removeMember(params.id, m.user_id).then(() => { closeModal(); toast(`${m.name} removed.`); }),
            }),
          }, 'Remove')
        : null,
    ));

    body.replaceChildren(...rows, el('div', { style: 'margin-top:16px;padding-top:14px;border-top:1px solid var(--line)' },
      c?.isOwner
        ? el('button', {
            class: 'btn btn-danger btn-sm', type: 'button',
            onclick: () => confirmDialog({
              title: 'Delete this circle?',
              subtitle: 'Nobody loses a prayer. The prayers people shared stay on their own walls, they simply stop being shared here.',
              confirmLabel: 'Delete circle',
              onConfirm: () => circles.remove(params.id).then(() => { closeModal(); toast('Circle deleted.'); ctx.go('circles'); }),
            }),
          }, 'Delete circle')
        : el('button', {
            class: 'btn btn-danger btn-sm', type: 'button',
            onclick: () => confirmDialog({
              title: 'Leave this circle?',
              subtitle: 'Your shared prayers will be pulled out of it. You can rejoin with a fresh invite.',
              confirmLabel: 'Leave',
              onConfirm: () => circles.leave(params.id).then(() => { closeModal(); toast('You left the circle.'); ctx.go('circles'); }),
            }),
          }, 'Leave circle'),
    ));
  });
}

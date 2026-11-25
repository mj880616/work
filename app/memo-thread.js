// S69-94 NOTE-메모통일: 원문 기록 아래 메모 칸(노트·읽을 거리 글·저장한 글이 같은 부품 하나) + 모아 보기 줄 그리기.
// 메모 칸(createMemoThread): 이 칸의 유일한 renderer. 머리 '메모 n' · 시간순 줄(글 · 날짜 · [수정] · ✕) · 한 줄 쓰기 칸 + 옆 작은 [남기기](이름 '메모 남기기', S70-06).
//  - 자료는 memo-store.js 목록 하나(서버 표 app_memos). 남기기·고치기·지우기 뒤 그 목록이 바뀌면 이 칸과 모아 보기가 함께 다시 그려진다.
//  - 생각·질문·인용 같은 종류는 없다(옛 댓글의 종류 값은 표에 그대로 두고 화면에서 쓰지 않음). 옛 인용 글이 있는 메모는 그 글을 작게 위에 보인다.
//  - [수정]은 그 줄이 쓰기 칸이 되고 [취소][저장]. 지우기는 바로 지우고 알림 '메모를 삭제했어요 · [되돌리기]'(같은 글로 다시 남김).
//  - 쓰다 만 글은 이 화면 메모리에만 둔다(원문마다, 기기 저장 없음). Ctrl+Enter(PC) 저장은 공용 규칙(enter-save.js, 가장 가까운 칸).
//  - 모아 보기에서 이 원문을 열었으면(memo-open.js) 붙을 때 그 메모 줄로 내려가 잠깐 칠한다(reveal).
// 모아 보기 줄(memoRowHtml): 메모 글 + 출처 꼬리표(노트·읽을 거리·저장한 글) + 원문 제목. 원문이 없으면 '원래 기록이 없어요'(링크만 꺼짐).
import {partStyles} from './part-styles.js';
import {MEMO_LIMITS, memoDraft, memosOf, memoSource, memoLink, memoFeature, GONE_LINE} from './memo-model.mjs';
import {memosNow, memoState, loadMemos, onMemos, leaveMemo, editMemo, removeMemo, restoreMemo} from './memo-store.js';
import {takeMemoReveal} from './memo-reveal.js';
import {noteLineDate} from './note-tree.mjs';
import {notify} from './small-notice.js';
import {waitInlineHtml} from './wait-state.js';
import {fitAll} from './auto-grow.js';

await partStyles('memo-thread');

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
let seq = 0;

// 원문 아래 메모 칸. onChange() = 메모 수가 바뀜(껍데기가 목록 쪽 수만 다시 맞출 때).
export function createMemoThread({onChange = () => {}} = {}) {
  const uid = `memoText${++seq}`;
  let box = null, target = null, busy = false, editing = null, editText = '', reveal = null, flashId = null, flashUntil = 0, waitTimer = 0, waitLeft = 180;
  const drafts = new Map(); // 원문 열쇠 → 쓰던 글(화면 메모리만)
  const key = () => (target ? `${target.type}:${target.id}` : '');
  // [남기기]는 글자가 있을 때만 누를 수 있다(빈 칸·빈칸만이면 흐리게). 저장 중에는 save()가 끈다.
  const canSave = () => { const b = box?.querySelector('[data-cm-save]'), t = box?.querySelector('[data-cm-text]'); if (b && !busy) b.disabled = !(t?.value || '').trim(); };
  const say = text => { const p = box?.querySelector('[data-cm-status]'); if (p) { p.textContent = text; p.hidden = !text; } };
  function rowHtml(m, canEdit) {
    if (editing === m.id) {
      return `<li class="memo-th-row memo-th-editing" data-cm-row="${esc(m.id)}" tabindex="-1"><div class="memo-th-text"><label class="a11y-only" for="${uid}e">메모 수정</label><textarea id="${uid}e" data-cm-edit-text rows="1" data-autogrow="8" maxlength="${MEMO_LIMITS.body}">${esc(editText)}</textarea><div class="save-row memo-th-actions" data-enter-save="[data-cm-edit-save]"><button type="button" class="secondary" data-cm-edit-cancel>취소</button><button type="button" class="primary" data-cm-edit-save>저장</button></div></div></li>`;
    }
    const edited = m.updated_at && m.created_at && Date.parse(m.updated_at) - Date.parse(m.created_at) > 1000;
    const flash = m.id === flashId && Date.now() < flashUntil ? ' memo-th-flash' : '';
    return `<li class="memo-th-row${flash}" data-cm-row="${esc(m.id)}" tabindex="-1"><div class="memo-th-text">${m.quote ? `<q class="memo-th-quote">${esc(m.quote)}</q>` : ''}<p>${esc(m.body)}</p></div><time datetime="${esc(m.created_at || '')}">${esc(noteLineDate(m.created_at))}${edited ? ' · 수정됨' : ''}</time>${canEdit ? `<button type="button" class="row-act memo-th-btn" data-cm-edit="${esc(m.id)}" aria-label="메모 수정" title="수정">수정</button>` : ''}<button type="button" class="icon-btn memo-th-btn" data-cm-del="${esc(m.id)}" aria-label="메모 삭제" title="삭제">✕</button></li>`;
  }
  let openOff = false; // 남긴 직후 다시 그릴 때 쓰기 칸을 한 줄로(아래 paint·save)
  function paint() {
    if (!box || !target) return;
    const st = memoState();
    if (!st.loaded) { box.innerHTML = `<p class="memo-th-head">메모</p>${waitInlineHtml()}`; return; }
    if (!st.ready) { box.innerHTML = `<p class="memo-th-head">메모</p><p class="memo-th-wait" data-cm-wait>${st.missing ? '메모는 준비 중이에요.' : '메모를 읽지 못했어요.'}</p>`; return; }
    const rows = memosOf(memosNow(), target.type, target.id);
    const canWrite = !st.legacy || target.type === 'note', canEdit = !st.legacy;
    const keepFocus = box.contains(document.activeElement) && document.activeElement.matches?.('[data-cm-text]');
    // 누른 쓰기 칸(.memo-th-open)은 메모 목록이 늦게 와 다시 그려도 큰 채로. 남긴 직후(save가 openOff를 켬)만 한 줄로 돌아간다.
    const keepOpen = !openOff && !!box.querySelector('[data-cm-text].memo-th-open');
    openOff = false;
    box.innerHTML = `<div class="memo-th-head"><span data-cm-count>메모 ${rows.length}</span></div>${rows.length ? `<ol class="memo-th-list" data-cm-list>${rows.map(m => rowHtml(m, canEdit)).join('')}</ol>` : ''}${canWrite
      ? `<div class="memo-th-write" data-cm-write data-enter-save="[data-cm-save]"><label class="a11y-only" for="${uid}">메모 남기기</label><div class="memo-th-line"><textarea id="${uid}" data-cm-text rows="1" data-autogrow="5" maxlength="${MEMO_LIMITS.body}" placeholder="메모 남기기…"></textarea><button type="button" class="secondary memo-th-save" data-cm-save aria-label="메모 남기기" disabled>남기기</button></div><p class="memo-th-status" data-cm-status role="status" hidden></p></div>`
      : '<p class="memo-th-wait" data-cm-wait>메모는 준비 중이에요.</p>'}`;
    const ta = box.querySelector('[data-cm-text]');
    if (ta) { ta.value = drafts.get(key()) || ''; if (keepOpen) ta.classList.add('memo-th-open'); canSave(); if (keepFocus) ta.focus({preventScroll: true}); }
    fitAll(box); // 쓰던 글·고치는 글이 있으면 열자마자 그만큼(없으면 한 줄)
    if (editing) box.querySelector('[data-cm-edit-text]')?.focus({preventScroll: true});
    showReveal();
  }
  // 모아 보기에서 연 메모: 줄이 그려지고 화면에 보이면 그 줄로 내려가 잠깐 칠한다(한 번). 칸을 다시 그려도 칠한 동안은 그대로(flashUntil).
  // 화면이 아직 숨어 있으면(화면 옮기는 중) 다음 그리기까지 기다린다.
  function showReveal() {
    if (!reveal || !box) return;
    const row = box.querySelector(`[data-cm-row="${CSS.escape(reveal)}"]`);
    if (!row) { if (memoState().loaded && !memosNow().some(m => m.id === reveal)) reveal = null; return; }
    // S69-95: 원문 창이 아직 숨어 있으면(창을 채운 뒤에 띄우는 보고 창·자료 창) 몇 프레임 뒤 다시 본다(약 3초까지).
    if (!row.getClientRects().length) { if (!waitTimer && waitLeft-- > 0) waitTimer = requestAnimationFrame(() => { waitTimer = 0; showReveal(); }); return; }
    waitLeft = 180;
    const id = reveal;
    reveal = null; flashId = id; flashUntil = Date.now() + 2400;
    row.classList.add('memo-th-flash');
    requestAnimationFrame(() => {
      const now = box?.querySelector(`[data-cm-row="${CSS.escape(id)}"]`);
      if (!now) return;
      now.scrollIntoView({block: 'center', behavior: 'instant'});
      now.focus({preventScroll: true});
    });
    setTimeout(() => { if (flashId !== id) return; flashId = null; box?.querySelector(`[data-cm-row="${CSS.escape(id)}"]`)?.classList.remove('memo-th-flash'); }, 2400);
  }
  async function save() {
    if (busy || !target) return;
    let body;
    try { body = memoDraft(drafts.get(key())); } catch (e) { say(e.message); return; }
    const t = target, k = key(); busy = true; say('');
    const button = box?.querySelector('[data-cm-save]'); if (button) button.disabled = true;
    try {
      await leaveMemo(t, body);
      drafts.delete(k);
      openOff = true; onChange(); paint();
      box?.querySelector('[data-cm-text]')?.focus({preventScroll: true});
    } catch { if (key() === k) { say('메모를 저장하지 못했어요. 다시 눌러 주세요.'); if (button) button.disabled = false; } }
    finally { busy = false; }
  }
  async function saveEdit() {
    if (busy || !editing) return;
    let body;
    try { body = memoDraft(editText); } catch (e) { notify(e.message, {error: true, record: false}); return; }
    const id = editing; busy = true;
    try { await editMemo(id, body); if (editing === id) { editing = null; editText = ''; } paint(); box?.querySelector(`[data-cm-row="${CSS.escape(id)}"]`)?.focus({preventScroll: true}); }
    catch { notify('메모를 수정하지 못했어요. 다시 눌러 주세요.', {error: true, record: false}); }
    finally { busy = false; }
  }
  async function remove(id) {
    if (busy) return;
    busy = true;
    try {
      const was = await removeMemo(id);
      if (editing === id) { editing = null; editText = ''; }
      onChange(); paint();
      if (was) notify('메모를 삭제했어요', {undo: async () => {
        try { await restoreMemo(was); onChange(); } catch { notify('메모를 되돌리지 못했어요.', {error: true}); }
      }});
    } catch { notify('메모를 삭제하지 못했어요. 다시 눌러 주세요.', {error: true, record: false}); }
    finally { busy = false; }
  }
  function onClick(e) {
    const b = e.target.closest('button'); if (!b || b.disabled || !box?.contains(b)) return;
    e.stopPropagation();
    if (b.hasAttribute('data-cm-save')) void save();
    else if (b.hasAttribute('data-cm-del')) void remove(b.dataset.cmDel);
    else if (b.hasAttribute('data-cm-edit')) { const m = memosNow().find(x => x.id === b.dataset.cmEdit); if (m) { editing = m.id; editText = m.body; paint(); } }
    else if (b.hasAttribute('data-cm-edit-cancel')) { const id = editing; editing = null; editText = ''; paint(); if (id) box?.querySelector(`[data-cm-row="${CSS.escape(id)}"]`)?.focus({preventScroll: true}); }
    else if (b.hasAttribute('data-cm-edit-save')) void saveEdit();
  }
  // S70-40b(reading-screens.md 5절 ④ (가)): 비어 있는 쓰기 칸은 한 줄, 누르면 세 줄 높이로 커진다(memo-thread.css .memo-th-open).
  // 남기면 칸을 새로 그려 다시 한 줄(초점은 그대로). 글이 길면 auto-grow.js가 5줄까지.
  function onPress(e) { if (e.target.matches?.('[data-cm-text]')) e.target.classList.add('memo-th-open'); }
  function onInput(e) {
    if (e.target.matches('[data-cm-text]')) { drafts.set(key(), e.target.value); say(''); canSave(); }
    else if (e.target.matches('[data-cm-edit-text]')) editText = e.target.value;
  }
  const off = onMemos(() => { if (box?.isConnected && !busy) paint(); });
  function detach() { box?.removeEventListener('click', onClick); box?.removeEventListener('input', onInput); box?.removeEventListener('pointerdown', onPress); box = null; target = null; }
  return {
    // 원문을 그릴 때마다 칸을 받는다. 같은 원문이면 쓰던 글은 그대로. target = {type, id, title}.
    attach(nextBox, nextTarget) {
      const same = box === nextBox && target && nextTarget && target.type === nextTarget.type && target.id === nextTarget.id;
      if (!same) { detach(); editing = null; editText = ''; }
      box = nextBox; target = nextTarget ? {...nextTarget} : null;
      if (!box || !target) return;
      const want = takeMemoReveal(target.type, target.id);
      if (want) { reveal = want; waitLeft = 180; }
      if (!same) { box.addEventListener('click', onClick); box.addEventListener('input', onInput); box.addEventListener('pointerdown', onPress); }
      if (!memoState().loaded) void loadMemos();
      paint();
    },
    paint,
    // 모아 보기에서 같은 화면 안 원문을 열 때(이미 붙은 칸): 그 메모로.
    reveal(id) { reveal = id || null; showReveal(); },
    detach,
    hasDraft: () => !!(box && target && String(drafts.get(key()) || '').trim()),
    reset() { detach(); drafts.clear(); editing = null; editText = ''; busy = false; reveal = null; },
    destroy() { this.reset(); off(); },
  };
}

// 모아 보기 줄 하나. titleOf(memo) = 지금 원문 제목(모르면 사본), exists(memo) = 원문 있나(true·false·undefined), hidden(memo) = 잠긴 노트(글·제목 가림).
export function memoRowHtml(m, {titleOf = x => x.target_title || '', exists = () => undefined, hidden = () => false} = {}) {
  const locked = hidden(m), link = memoLink(m, exists);
  // S69-95: 운영자 기능(텔레그램)이 잠겨 가린 줄은 누르면 그 자리 잠금 풀기 창(feature-lock.js data-lock-here — 노트 잠금은 부르는 화면이 묻는다).
  const lockHere = locked && memoFeature(m) ? ` data-lock-here="${esc(memoFeature(m))}"` : '';
  const title = locked ? '잠김' : [...String(titleOf(m) || m.target_title || '제목 없음')].slice(0, 60).join('');
  const text = locked ? '잠김' : `${m.quote ? `<q>${esc([...m.quote].slice(0, 80).join(''))}</q> ` : ''}${esc([...String(m.body || '')].slice(0, 200).join(''))}`;
  const src = `<span class="memo-src" data-memo-src="${esc(m.target_type)}">${esc(memoSource(m))}</span>`;
  const tail = `<span class="row-tail memo-title"><span class="a11y-only">원문: </span>${esc(title)}</span>${link.gone ? `<span class="row-tail memo-gone" data-memo-gone>${esc(GONE_LINE)}</span>` : ''}`;
  const day = `<time class="row-tail" datetime="${esc(m.created_at || '')}">${esc(noteLineDate(m.created_at))}</time>`;
  const inner = `${src}<span class="memo-line-text">${text}</span>${tail}${day}`;
  return link.open
    ? `<div class="memo-line" data-memo-line="${esc(m.id)}"${lockHere}><button type="button" class="ghost memo-line-open" data-memo-open="${esc(m.id)}">${inner}</button></div>`
    : `<div class="memo-line memo-line-off" data-memo-line="${esc(m.id)}"${lockHere}><div class="memo-line-open" aria-disabled="true">${inner}</div></div>`;
}
// 모아 보기 칩(출처 묶음) 줄.
export const memoChipsHtml = (groups, current) => groups.map(g => `<button type="button" class="ds-chip nt-chip" data-memo-group="${esc(g.key)}" aria-pressed="${(current || '') === g.key}">${esc(g.label)}</button>`).join('');

// S69-95 NOTE-메모넓히기: 다시 그려지는 목록 안 원문마다(텔레그램 소식 줄처럼 펼친 것만) 메모 칸을 끼우는 손잡이. 같은 메모 칸 부품(createMemoThread)을
// 원문마다 하나씩 두고, 칸 요소는 다시 그려도 같은 것을 끼운다(쓰던 글·초점 유지). 목록이 그 자리를 더는 그리지 않으면 그 칸을 버린다.
// 자리: memoSlotHtml(type, id) — 부르는 화면이 원문 아래에 그린다. 끼우기: mount(root, key → {type, id, title}|null).
export const memoSlotHtml = (type, id, cls = '') => `<section class="memo-slot${cls ? ` ${esc(cls)}` : ''}" data-memo-slot="${esc(type)}:${esc(id)}" aria-label="메모"></section>`;
export function createMemoSlots({cls = ''} = {}) {
  const slots = new Map(); // 'type:id' → {host, thread}
  return {
    mount(root, targetOf) {
      if (!root) return;
      for (const spot of root.querySelectorAll('[data-memo-slot]')) {
        const key = spot.dataset.memoSlot, t = targetOf(key);
        if (!t) { spot.remove(); continue; }
        let s = slots.get(key);
        if (!s) {
          const host = document.createElement('section');
          host.className = `memo-th${cls ? ` ${cls}` : ''}`; host.dataset.memoHost = key; host.setAttribute('aria-label', '메모');
          s = {host, thread: createMemoThread()}; slots.set(key, s);
        }
        // 칸을 옮기면 브라우저가 초점을 놓는다: 쓰던 칸이면 같은 자리(커서 그대로)로 돌려준다.
        const a = s.host.contains(document.activeElement) ? document.activeElement : null, at = a && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
        spot.replaceWith(s.host);
        s.thread.attach(s.host, t);
        if (a?.isConnected && document.activeElement !== a) { a.focus({preventScroll: true}); if (at) try { a.setSelectionRange(...at); } catch { /* 고를 수 없는 칸 */ } }
      }
      for (const [key, s] of slots) if (!s.host.isConnected) { s.thread.destroy(); slots.delete(key); }
    },
    has: key => slots.has(key),
    reset() { for (const s of slots.values()) s.thread.destroy(); slots.clear(); },
  };
}

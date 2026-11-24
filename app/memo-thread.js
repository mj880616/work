// S69-94 NOTE-메모통일: 원문 기록 아래 메모 칸(노트·읽을 거리 글·저장한 글이 같은 부품 하나) + 모아 보기 줄 그리기.
// 메모 칸(createMemoThread): 이 칸의 유일한 renderer. 머리 '메모 n' · 시간순 줄(글 · 날짜 · [수정] · ✕) · 쓰기 칸 + [메모 남기기].
//  - 자료는 memo-store.js 목록 하나(서버 표 app_memos). 남기기·고치기·지우기 뒤 그 목록이 바뀌면 이 칸과 모아 보기가 함께 다시 그려진다.
//  - 생각·질문·인용 같은 종류는 없다(옛 댓글의 종류 값은 표에 그대로 두고 화면에서 쓰지 않음). 옛 인용 글이 있는 메모는 그 글을 작게 위에 보인다.
//  - [수정]은 그 줄이 쓰기 칸이 되고 [취소][저장]. 지우기는 바로 지우고 알림 '메모를 삭제했어요 · [되돌리기]'(같은 글로 다시 남김).
//  - 쓰다 만 글은 이 화면 메모리에만 둔다(원문마다, 기기 저장 없음). Ctrl+Enter(PC) 저장은 공용 규칙(enter-save.js, 가장 가까운 칸).
//  - 모아 보기에서 이 원문을 열었으면(memo-open.js) 붙을 때 그 메모 줄로 내려가 잠깐 칠한다(reveal).
// 모아 보기 줄(memoRowHtml): 메모 글 + 출처 꼬리표(노트·읽을 거리·저장한 글) + 원문 제목. 원문이 없으면 '원래 기록이 없어요'(링크만 꺼짐).
import {partStyles} from './part-styles.js';
import {MEMO_LIMITS, memoDraft, memosOf, memoSource, memoLink, GONE_LINE} from './memo-model.mjs';
import {memosNow, memoState, loadMemos, onMemos, leaveMemo, editMemo, removeMemo, restoreMemo} from './memo-store.js';
import {takeMemoReveal} from './memo-open.js';
import {noteLineDate} from './note-tree.mjs';
import {notify} from './small-notice.js';
import {waitInlineHtml} from './wait-state.js';

await partStyles('memo-thread');

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
let seq = 0;

// 원문 아래 메모 칸. onChange() = 메모 수가 바뀜(껍데기가 목록 쪽 수만 다시 맞출 때).
export function createMemoThread({onChange = () => {}} = {}) {
  const uid = `memoText${++seq}`;
  let box = null, target = null, busy = false, editing = null, editText = '', reveal = null, flashId = null, flashUntil = 0;
  const drafts = new Map(); // 원문 열쇠 → 쓰던 글(화면 메모리만)
  const key = () => (target ? `${target.type}:${target.id}` : '');
  const say = text => { const p = box?.querySelector('[data-cm-status]'); if (p) { p.textContent = text; p.hidden = !text; } };
  function rowHtml(m, canEdit) {
    if (editing === m.id) {
      return `<li class="memo-th-row memo-th-editing" data-cm-row="${esc(m.id)}" tabindex="-1"><div class="memo-th-text"><label class="a11y-only" for="${uid}e">메모 수정</label><textarea id="${uid}e" data-cm-edit-text rows="2" maxlength="${MEMO_LIMITS.body}">${esc(editText)}</textarea><div class="save-row memo-th-actions" data-enter-save="[data-cm-edit-save]"><button type="button" class="secondary" data-cm-edit-cancel>취소</button><button type="button" class="primary" data-cm-edit-save>저장</button></div></div></li>`;
    }
    const edited = m.updated_at && m.created_at && Date.parse(m.updated_at) - Date.parse(m.created_at) > 1000;
    const flash = m.id === flashId && Date.now() < flashUntil ? ' memo-th-flash' : '';
    return `<li class="memo-th-row${flash}" data-cm-row="${esc(m.id)}" tabindex="-1"><div class="memo-th-text">${m.quote ? `<q class="memo-th-quote">${esc(m.quote)}</q>` : ''}<p>${esc(m.body)}</p></div><time datetime="${esc(m.created_at || '')}">${esc(noteLineDate(m.created_at))}${edited ? ' · 수정됨' : ''}</time>${canEdit ? `<button type="button" class="row-act memo-th-btn" data-cm-edit="${esc(m.id)}" aria-label="메모 수정" title="수정">수정</button>` : ''}<button type="button" class="icon-btn memo-th-btn" data-cm-del="${esc(m.id)}" aria-label="메모 삭제" title="삭제">✕</button></li>`;
  }
  function paint() {
    if (!box || !target) return;
    const st = memoState();
    if (!st.loaded) { box.innerHTML = `<p class="memo-th-head">메모</p>${waitInlineHtml()}`; return; }
    if (!st.ready) { box.innerHTML = `<p class="memo-th-head">메모</p><p class="memo-th-wait" data-cm-wait>${st.missing ? '메모는 준비 중이에요.' : '메모를 읽지 못했어요.'}</p>`; return; }
    const rows = memosOf(memosNow(), target.type, target.id);
    const canWrite = !st.legacy || target.type === 'note', canEdit = !st.legacy;
    const keepFocus = box.contains(document.activeElement) && document.activeElement.matches?.('[data-cm-text]');
    box.innerHTML = `<div class="memo-th-head"><span data-cm-count>메모 ${rows.length}</span></div>${rows.length ? `<ol class="memo-th-list" data-cm-list>${rows.map(m => rowHtml(m, canEdit)).join('')}</ol>` : ''}${canWrite
      ? `<div class="memo-th-write" data-cm-write data-enter-save="[data-cm-save]"><label class="a11y-only" for="${uid}">메모 남기기</label><textarea id="${uid}" data-cm-text rows="2" maxlength="${MEMO_LIMITS.body}" placeholder="메모"></textarea><p class="memo-th-status" data-cm-status role="status" hidden></p><div class="save-row memo-th-actions"><button type="button" class="primary" data-cm-save>메모 남기기</button></div></div>`
      : '<p class="memo-th-wait" data-cm-wait>메모는 준비 중이에요.</p>'}`;
    const ta = box.querySelector('[data-cm-text]');
    if (ta) { ta.value = drafts.get(key()) || ''; if (keepFocus) ta.focus({preventScroll: true}); }
    if (editing) box.querySelector('[data-cm-edit-text]')?.focus({preventScroll: true});
    showReveal();
  }
  // 모아 보기에서 연 메모: 줄이 그려지고 화면에 보이면 그 줄로 내려가 잠깐 칠한다(한 번). 칸을 다시 그려도 칠한 동안은 그대로(flashUntil).
  // 화면이 아직 숨어 있으면(화면 옮기는 중) 다음 그리기까지 기다린다.
  function showReveal() {
    if (!reveal || !box) return;
    const row = box.querySelector(`[data-cm-row="${CSS.escape(reveal)}"]`);
    if (!row) { if (memoState().loaded && !memosNow().some(m => m.id === reveal)) reveal = null; return; }
    if (!row.getClientRects().length) return;
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
      onChange(); paint();
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
  function onInput(e) {
    if (e.target.matches('[data-cm-text]')) { drafts.set(key(), e.target.value); say(''); }
    else if (e.target.matches('[data-cm-edit-text]')) editText = e.target.value;
  }
  const off = onMemos(() => { if (box?.isConnected && !busy) paint(); });
  function detach() { box?.removeEventListener('click', onClick); box?.removeEventListener('input', onInput); box = null; target = null; }
  return {
    // 원문을 그릴 때마다 칸을 받는다. 같은 원문이면 쓰던 글은 그대로. target = {type, id, title}.
    attach(nextBox, nextTarget) {
      const same = box === nextBox && target && nextTarget && target.type === nextTarget.type && target.id === nextTarget.id;
      if (!same) { detach(); editing = null; editText = ''; }
      box = nextBox; target = nextTarget ? {...nextTarget} : null;
      if (!box || !target) return;
      const want = takeMemoReveal(target.type, target.id);
      if (want) reveal = want;
      if (!same) { box.addEventListener('click', onClick); box.addEventListener('input', onInput); }
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
  const title = locked ? '잠김' : [...String(titleOf(m) || m.target_title || '제목 없음')].slice(0, 60).join('');
  const text = locked ? '잠김' : `${m.quote ? `<q>${esc([...m.quote].slice(0, 80).join(''))}</q> ` : ''}${esc([...String(m.body || '')].slice(0, 200).join(''))}`;
  const src = `<span class="memo-src" data-memo-src="${esc(m.target_type)}">${esc(memoSource(m))}</span>`;
  const tail = `<span class="row-tail memo-title"><span class="a11y-only">원문: </span>${esc(title)}</span>${link.gone ? `<span class="row-tail memo-gone" data-memo-gone>${esc(GONE_LINE)}</span>` : ''}`;
  const day = `<time class="row-tail" datetime="${esc(m.created_at || '')}">${esc(noteLineDate(m.created_at))}</time>`;
  const inner = `${src}<span class="memo-line-text">${text}</span>${tail}${day}`;
  return link.open
    ? `<div class="memo-line" data-memo-line="${esc(m.id)}"><button type="button" class="ghost memo-line-open" data-memo-open="${esc(m.id)}">${inner}</button></div>`
    : `<div class="memo-line memo-line-off" data-memo-line="${esc(m.id)}"><div class="memo-line-open" aria-disabled="true">${inner}</div></div>`;
}
// 모아 보기 칩(출처 묶음) 줄.
export const memoChipsHtml = (groups, current) => groups.map(g => `<button type="button" class="ds-chip nt-chip" data-memo-group="${esc(g.key)}" aria-pressed="${(current || '') === g.key}">${esc(g.label)}</button>`).join('');

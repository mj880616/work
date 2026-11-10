// NOTE-읽생기아이디어 ① 노트 읽기 화면의 댓글 칸(이 칸의 유일한 renderer). 자료는 basket-notes.js가 들고 있는 댓글 목록(서버 표 app_note_comments)을 쓴다.
// 줄: 유형 칩(생각·질문·인용) + (인용이면 고른 문장) + 글 + 날짜 + ✕. 제목 줄 '댓글 n' 오른쪽에 종류 [생각|질문](공용 ⑤ .ds-seg, renderFilterChips seg),
// 문장을 골라 인용이 붙으면 [인용] 칸이 더해지고 골라진다(NOTE-댓글종류자리 A안). 쓰기 칸 아래엔 [저장]만(오른쪽 아래, UI-저장자리).
// 인용: 노트 본문에서 문장을 고르면(마우스·손가락) 쓰기 칸 위에 그 문장이 붙고 유형이 '인용'이 된다(읽생기 책갈피 대신). ✕로 뺀다.
// Ctrl+Enter(PC) 저장은 공용 규칙(enter-save.js, 이 쓰기 칸이 가장 가까운 칸). 쓰다 만 글은 이 화면 메모리에만 둔다(기기 저장 없음). 지우기는 바로 지우고 위쪽 '댓글을 지웠어요 · [되돌리기]'(같은 글로 다시 저장).
import { COMMENT_KINDS, COMMENT_LIMITS, kindName, quoteFromSelection, commentDraft, commentsOf } from './note-comments.mjs';
import { addNoteComment, deleteNoteComment } from './note-comments-data.js';
import { noteLineDate } from './note-tree.mjs';
import { notify } from './small-notice.js';
import { renderFilterChips } from './filter-chips.js';

export function createNoteComments({esc, rt = window.KPTURuntime, list, state, scope, onChange = () => {}}) {
  let box = null, note = null, readText = null, busy = false, draft = {noteId: null, kind: 'thought', quote: null, text: ''};
  const say = text => { const p = box?.querySelector('[data-cm-status]'); if (p) { p.textContent = text; p.hidden = !text; } };
  // 종류 칸: 인용은 고른 문장이 붙어 있을 때만 보인다. 다른 칸을 고르면 붙은 문장을 뺀다.
  function paintKind() {
    const host = box?.querySelector('[data-cm-kind]'); if (!host) return;
    const options = COMMENT_KINDS.filter(k => k.key !== 'quote' || draft.quote).map(k => ({value: k.key, label: k.name}));
    renderFilterChips(host, {options, value: draft.kind, label: '댓글 종류', seg: true, onChange: value => {
      draft.kind = value;
      if (value !== 'quote' && draft.quote) { draft.quote = null; paintQuote(); }
    }});
  }
  function rowHtml(c) {
    return `<li class="note-cm-row" data-cm-row="${esc(c.id)}"><span class="note-cm-kind" data-kind="${esc(c.kind)}">${esc(kindName(c.kind))}</span><div class="note-cm-text">${c.quote ? `<q class="note-cm-quote">${esc(c.quote)}</q>` : ''}<p>${esc(c.body)}</p></div><time datetime="${esc(c.created_at || '')}">${esc(noteLineDate(c.created_at))}</time><button type="button" class="note-cm-del" data-cm-del="${esc(c.id)}" aria-label="댓글 삭제" title="삭제">✕</button></li>`;
  }
  function paintQuote() {
    const q = box?.querySelector('[data-cm-quote]'); if (!q) return;
    q.hidden = !draft.quote;
    q.querySelector('[data-cm-quote-text]').textContent = draft.quote || '';
    paintKind();
  }
  function paint() {
    if (!box || !note) return;
    if (draft.noteId !== note.id) draft = {noteId: note.id, kind: 'thought', quote: null, text: ''};
    const s = state();
    if (!s.ready) {
      box.innerHTML = `<p class="note-cm-head">댓글</p><p class="note-cm-wait" data-cm-wait>${s.missing ? '댓글은 준비 중이에요.' : '댓글을 읽지 못했어요.'}</p>`;
      return;
    }
    const rows = commentsOf(list.get(), note.id);
    box.innerHTML = `<div class="note-cm-head"><span data-cm-count>댓글 ${rows.length}</span><span class="note-cm-kinds" data-cm-kind></span></div>${rows.length ? `<ol class="note-cm-list" data-cm-list>${rows.map(rowHtml).join('')}</ol>` : ''}<div class="note-cm-write" data-cm-write data-enter-save="[data-cm-save]"><div class="note-cm-quote-pick" data-cm-quote hidden><q data-cm-quote-text></q><button type="button" class="note-cm-del" data-cm-quote-drop aria-label="인용 빼기" title="인용 빼기">✕</button></div><label class="a11y-only" for="noteCmText">댓글 쓰기</label><textarea id="noteCmText" data-cm-text rows="2" maxlength="${COMMENT_LIMITS.body}" placeholder="댓글 쓰기"></textarea><p class="note-cm-status" data-cm-status role="status" hidden></p><div class="save-row note-cm-actions"><button type="button" class="primary" data-cm-save>저장</button></div></div>`;
    box.querySelector('[data-cm-text]').value = draft.text;
    paintQuote();
  }
  async function save() {
    if (busy || !note) return;
    let body;
    try { body = commentDraft({kind: draft.kind, quote: draft.quote, body: draft.text}); } catch (e) { say(e.message); return; }
    const id = note.id, owner = scope(); busy = true; say('');
    const button = box.querySelector('[data-cm-save]'); if (button) button.disabled = true;
    try {
      const saved = await addNoteComment({note_id: id, ...body}, rt);
      if (owner !== scope()) return;
      list.set(rows => [saved, ...rows]);
      if (note?.id === id) draft = {noteId: id, kind: 'thought', quote: null, text: ''};
      onChange(); paint();
      box?.querySelector('[data-cm-text]')?.focus({preventScroll: true});
    } catch { if (owner === scope()) { say('댓글을 저장하지 못했어요. 다시 눌러 주세요.'); if (button) button.disabled = false; } }
    finally { busy = false; }
  }
  async function remove(id) {
    if (busy) return;
    const c = list.get().find(x => x.id === id); if (!c) return;
    const owner = scope(); busy = true;
    try {
      await deleteNoteComment(id, rt);
      if (owner !== scope()) return;
      list.set(rows => rows.filter(x => x.id !== id)); onChange(); paint();
      notify('댓글을 삭제했어요', {undo: async () => {
        try { const back = await addNoteComment({note_id: c.note_id, kind: c.kind, quote: c.quote, body: c.body}, rt); if (owner !== scope()) return; list.set(rows => [back, ...rows]); onChange(); paint(); }
        catch { notify('댓글을 되돌리지 못했어요.', {error: true}); }
      }});
    } catch { if (owner === scope()) say('댓글을 삭제하지 못했어요. 다시 눌러 주세요.'); }
    finally { busy = false; }
  }
  // 본문에서 고른 문장: 고른 곳이 이 노트 본문 안일 때만 인용으로 붙인다.
  function onSelection() {
    if (!box || !note || !readText?.isConnected || !state().ready) return;
    const sel = document.getSelection(); if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const range = sel.getRangeAt(0); if (!readText.contains(range.commonAncestorContainer)) return;
    const quote = quoteFromSelection(sel.toString()); if (!quote) return;
    draft.quote = quote; draft.kind = 'quote';
    paintQuote();
  }
  document.addEventListener('selectionchange', onSelection);
  function onClick(e) {
    const b = e.target.closest('button'); if (!b || b.disabled || !box?.contains(b)) return;
    e.stopPropagation();
    if (b.hasAttribute('data-cm-save')) void save();
    else if (b.hasAttribute('data-cm-del')) void remove(b.dataset.cmDel);
    else if (b.hasAttribute('data-cm-quote-drop')) { draft.quote = null; if (draft.kind === 'quote') draft.kind = 'thought'; paintQuote(); }
  }
  function onInput(e) {
    if (e.target.matches('[data-cm-text]')) { draft.text = e.target.value; say(''); }
  }
  return {
    // 노트를 열 때마다 새 칸을 받는다. 같은 노트면 쓰다 만 글은 그대로.
    attach(nextBox, nextNote, nextReadText) {
      box?.removeEventListener('click', onClick); box?.removeEventListener('input', onInput); box?.removeEventListener('change', onInput);
      box = nextBox; note = nextNote; readText = nextReadText;
      if (!box) return;
      box.addEventListener('click', onClick); box.addEventListener('input', onInput); box.addEventListener('change', onInput);
      paint();
    },
    paint,
    detach() { box?.removeEventListener('click', onClick); box?.removeEventListener('input', onInput); box?.removeEventListener('change', onInput); box = null; note = null; readText = null; },
    hasDraft: () => !!(box && note && draft.noteId === note.id && draft.text.trim()),
    reset() { this.detach(); draft = {noteId: null, kind: 'thought', quote: null, text: ''}; busy = false; },
  };
}

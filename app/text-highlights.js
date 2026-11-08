import {createNoteDoc} from './basket-data.js';
import {createAnchoredMenu} from './anchored-menu.js';
import {copyText} from './copy-text.js';
import {notify, askText, askConfirm} from './small-notice.js';
import {highlightBody, edgesOf, markRanges, noteOf, copyOf, cleanMemo, draftOf, MEMO_MAX} from './text-highlights-model.mjs';
// S53-5 NEWS-밑줄모으기(시안 docs/design/mockups/news-highlights.html ②·③): 밑줄 저장·읽기·메모·지우기·노트로 + 글 칸 위 노란 밑줄 칠하기.
// - 서버 표 public.app_news_highlights(DB 20261108070000): 자기 작업공간 주인만(RLS), 고치기는 메모만. 기기 저장 없음 — 목록은 이 탭 메모리에만 다시 쓰려고 둔다.
// - 글 칸 주인(now-detail.js·telegram-feed.js)이 자기 칸을 다 그린 뒤 paintMarks(zoneEl, 그 글의 밑줄)을 부른다(칸의 그리기 주인은 그대로 — 글자 마디만 <mark>로 감싼다).
// - 밑줄을 누르면 작은 메뉴(UI-⋯작은메뉴 공용 anchored-menu): 메모 보기 · [메모 고치기] [노트로] [복사] [지우기].
// - [노트로]는 고른 글 + 메모 + 출처(매체·제목·날짜·원래 주소)로 새 노트 하나(app_notes). 글 상세의 [메모] 노트와 섞이지 않게 글 연결 칸은 두지 않는다.
// 바깥 글자는 모두 글자로만 그린다(esc·textContent). 로그에 고른 글·메모를 남기지 않는다.

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const q = v => encodeURIComponent(v);
const rt = () => window.KPTURuntime;
const workspaceOf = () => rt()?.context?.read?.()?.workspace?.id || '';
export const HL_COLS = 'id,source_type,source_id,quote,quote_prefix,quote_suffix,memo,source_title,source_media,source_date,source_url,created_at,updated_at';
const LIMIT = 500;
const failNote = e => (e?.status ? `저장하지 못했어요 · HTTP ${e.status}` : '저장하지 못했어요 · 잠시 뒤 다시');

let rows = null, scope = '', loading = null;
const listeners = new Set();
const emit = () => { for (const fn of listeners) { try { fn(); } catch { /* 그리는 쪽 오류는 다른 칸에 번지지 않게 */ } } };
export const onHighlights = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const scopeNow = () => { const c = rt()?.context?.read?.(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };

// 내 작업공간 밑줄 전부(새 것이 위, 500개까지). force면 다시 읽는다. 못 읽으면 throw(목록 칸이 [다시]).
export function loadHighlights({force = false} = {}) {
  if (scope !== scopeNow()) { rows = null; scope = scopeNow(); loading = null; }
  if (rows && !force) return Promise.resolve(rows);
  if (loading && !force) return loading;
  const w = workspaceOf(), my = scope;
  if (!w) return Promise.resolve([]);
  const p = rt().api(`/rest/v1/app_news_highlights?workspace_id=eq.${q(w)}&select=${HL_COLS}&order=created_at.desc&limit=${LIMIT}`, {singleFlight: false})
    .then(r => { if (my === scope) { rows = Array.isArray(r) ? r : []; emit(); } return rows || []; })
    .finally(() => { if (loading === p) loading = null; });
  loading = p;
  return p;
}
export const highlightsNow = () => rows;
export const sourceHighlights = (type, id) => (rows || []).filter(h => h.source_type === type && h.source_id === id);
export const highlightById = id => (rows || []).find(h => h.id === id) || null;
window.addEventListener('kptu:session-changed', () => { rows = null; scope = ''; loading = null; emit(); });

export async function addHighlight(source, quote, edges, memo = null) {
  const body = highlightBody(workspaceOf(), source, quote, edges, memo);
  if (!body) throw new Error('shape');
  const saved = await rt().api('/rest/v1/app_news_highlights', {method: 'POST', prefer: 'return=representation', body, singleFlight: false});
  const row = Array.isArray(saved) ? saved[0] : saved;
  if (!row?.id) throw new Error('shape');
  rows = [row, ...(rows || []).filter(h => h.id !== row.id)];
  emit();
  return row;
}
export async function setMemo(id, memo) {
  const saved = await rt().api(`/rest/v1/app_news_highlights?id=eq.${q(id)}&workspace_id=eq.${q(workspaceOf())}`, {method: 'PATCH', prefer: 'return=representation', body: {memo: cleanMemo(memo), updated_at: new Date().toISOString()}, singleFlight: false});
  const row = Array.isArray(saved) ? saved[0] : null;
  if (!row?.id) throw Object.assign(new Error('gone'), {code: 'gone'});
  rows = (rows || []).map(h => (h.id === id ? row : h));
  emit();
  return row;
}
export async function removeHighlight(id) {
  await rt().api(`/rest/v1/app_news_highlights?id=eq.${q(id)}&workspace_id=eq.${q(workspaceOf())}`, {method: 'DELETE', singleFlight: false});
  rows = (rows || []).filter(h => h.id !== id);
  emit();
}
// 밑줄 여러 개(또는 저장 전 고른 글 하나)를 노트 하나로.
export async function sendToNote(list) {
  const n = noteOf(list);
  if (!n) return null;
  return createNoteDoc({title: n.title, raw_text: n.raw_text}, rt());
}
export async function noteWithNotice(list) {
  try { await sendToNote(list); notify(list.length > 1 ? `노트로 보냈어요 · 밑줄 ${list.length}개` : '노트로 보냈어요', {record: false}); return true; }
  catch (e) { notify(e?.message && !e?.status ? e.message : '노트로 보내지 못했어요 · 잠시 뒤 다시', {error: true, record: false}); return false; }
}
export async function editMemo(h, anchor) {
  const value = await askText(anchor, {text: h.memo ? '메모 수정' : '메모 달기', value: h.memo || '', placeholder: '생각을 한 줄', max: MEMO_MAX, ok: '저장'});
  if (value === null || (value.trim() || null) === (h.memo || null)) return null;
  try { const row = await setMemo(h.id, value); notify(row.memo ? '메모를 저장했어요' : '메모를 삭제했어요', {record: false}); return row; }
  catch (e) { notify(e?.code === 'gone' ? '이미 삭제한 밑줄이에요' : failNote(e), {error: true, record: false}); if (e?.code === 'gone') void loadHighlights({force: true}).catch(() => {}); return null; }
}
export async function copyHighlight(h) {
  const ok = await copyText(copyOf(h));
  notify(ok ? '복사했어요' : '복사하지 못했어요. 다시 눌러 주세요.', {error: !ok, record: false});
}
// 지우기: 작은 확인 → 지움 + [되돌리기](같은 글·메모·출처로 다시 저장).
export async function deleteHighlight(h, anchor) {
  if (!(await askConfirm(anchor, {text: '이 밑줄을 삭제할까요?', note: h.memo ? '메모도 함께 삭제돼요' : '', ok: '삭제'}))) return false;
  try { await removeHighlight(h.id); }
  catch (e) { notify(failNote(e), {error: true, record: false}); return false; }
  const src = {type: h.source_type, id: h.source_id, title: h.source_title, media: h.source_media, date: h.source_date, url: h.source_url};
  notify('밑줄을 삭제했어요', {label: '밑줄 삭제', undo: async () => { await addHighlight(src, h.quote, {prefix: h.quote_prefix || '', suffix: h.quote_suffix || ''}, h.memo); }});
  return true;
}

// 고른 글 줄(text-select-bar.js)의 [밑줄 저장]: 저장 → 알림 '밑줄 저장함' [메모] [노트로도 보내기] [되돌리기].
export async function saveFromSelection(info) {
  if (!info?.source) { notify('이 글은 밑줄을 저장할 수 없어요', {error: true, record: false}); return null; }
  const full = info.zoneEl?.textContent || '';
  let row;
  try { row = await addHighlight(info.source, info.quote, edgesOf(full, info.start, info.end)); }
  catch (e) { notify(e?.message === 'shape' ? '선택한 글을 저장할 수 없어요' : failNote(e), {error: true, record: false}); return null; }
  notify('밑줄 저장함', {ms: 8000, label: '밑줄 저장', undo: async () => { await removeHighlight(row.id); },
    actions: [
      {label: '메모', run: ({close}) => { close(); const h = highlightById(row.id); if (h) void editMemo(h, null); }},
      {label: '노트로도 보내기', run: ({close}) => { close(); const h = highlightById(row.id); if (h) void noteWithNotice([h]); }},
    ]});
  return row;
}
// 고른 글 줄의 [노트로]: 저장하지 않고 고른 글 + 출처만 노트로.
export const noteFromSelection = info => noteWithNotice([draftOf(info?.source, info?.quote)]);

// ---------- 글 칸 위에 칠하기 ----------
const SKIP = 'button,textarea,input,select,[contenteditable]';
// zoneEl 안 글자에서 밑줄 자리를 찾아 <mark class="hl-mark">로 감싼다. 먼저 있던 표시는 걷는다(칸 글자는 그대로).
export function paintMarks(zoneEl, list) {
  if (!zoneEl) return;
  for (const m of zoneEl.querySelectorAll('mark.hl-mark')) m.replaceWith(...m.childNodes);
  zoneEl.normalize();
  if (!list?.length) return;
  const nodes = [];
  const walker = document.createTreeWalker(zoneEl, NodeFilter.SHOW_TEXT);
  let pos = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push({n, start: pos, end: pos + n.data.length}); pos += n.data.length; }
  const ranges = markRanges(zoneEl.textContent, list);
  const segs = new Map(); // text node → [{s, e, id, first}]
  for (const r of ranges) {
    let first = true;
    for (const t of nodes) {
      const s = Math.max(r.start, t.start), e = Math.min(r.end, t.end);
      if (s >= e || t.n.parentElement?.closest(SKIP)) continue;
      if (!segs.has(t.n)) segs.set(t.n, []);
      segs.get(t.n).push({s: s - t.start, e: e - t.start, id: r.id, first});
      first = false;
    }
  }
  for (const [node, list2] of segs) {
    for (const seg of list2.sort((a, b) => b.s - a.s)) {
      if (seg.e < node.data.length) node.splitText(seg.e);
      const mid = seg.s > 0 ? node.splitText(seg.s) : node;
      const mark = document.createElement('mark');
      mark.className = 'hl-mark';
      mark.dataset.hlId = seg.id;
      if (seg.first) { mark.tabIndex = 0; mark.setAttribute('role', 'button'); mark.setAttribute('aria-label', '밑줄 — 메모 보기'); }
      mid.replaceWith(mark);
      mark.append(mid);
      if (mid === node) break; // 이 마디 앞쪽은 더 없다
    }
  }
}
// 밑줄을 누르면 작은 메뉴. container 하나에 한 번만 붙인다(글 칸을 다시 그려도 그대로).
const markMenu = createAnchoredMenu({id: 'hlMarkMenu', className: 'topline-add-menu os-menu hl-menu', label: '밑줄 메뉴', historyKey: 'kptuHighlightMenu', key: t => t?.dataset?.hlId || '', boxWidth: 240, actDetached: true,
  render: id => {
    const h = highlightById(id);
    if (!h) return '<p class="hl-menu-memo">이미 삭제한 밑줄이에요</p>';
    return `${h.memo ? `<p class="hl-menu-memo"><span class="hl-menu-k">메모</span>${esc(h.memo)}</p>` : ''}<button type="button" class="row-act" data-hl-menu="memo">${h.memo ? '메모 수정' : '메모 달기'}</button><button type="button" class="row-act" data-hl-menu="note">노트로</button><button type="button" class="row-act" data-hl-menu="copy">복사</button><button type="button" class="row-act" data-hl-menu="delete">삭제</button>`;
  },
  onAction: (button, active) => {
    const h = highlightById(active.id);
    if (!h) return;
    const a = button.dataset.hlMenu, at = active.trigger?.isConnected ? active.trigger : null;
    if (a === 'memo') void editMemo(h, at); else if (a === 'note') void noteWithNotice([h]); else if (a === 'copy') void copyHighlight(h); else if (a === 'delete') void deleteHighlight(h, at);
  }});
export const openMarkMenu = (trigger, opts) => markMenu.open(trigger, opts);
export function bindMarks(container) {
  if (!container || container.dataset.hlMarksBound) return;
  container.dataset.hlMarksBound = '1';
  const first = mark => container.querySelector(`mark.hl-mark[data-hl-id="${CSS.escape(mark.dataset.hlId)}"][tabindex]`) || mark;
  container.addEventListener('click', e => {
    const mark = e.target.closest?.('mark.hl-mark');
    if (!mark || !container.contains(mark)) return;
    const sel = window.getSelection?.();
    if (sel && !sel.isCollapsed) return; // 글을 고르는 중이면 메뉴를 열지 않는다
    markMenu.open(first(mark));
  });
  container.addEventListener('keydown', e => {
    const mark = e.target.closest?.('mark.hl-mark');
    if (!mark || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    markMenu.open(first(mark));
  });
}
// [밑줄] 탭에서 글을 열었을 때 그 자리로: 칠한 밑줄로 옮기고 잠깐 강조.
export function revealMark(zoneEl, id) {
  const m = zoneEl?.querySelector(`mark.hl-mark[data-hl-id="${CSS.escape(id)}"]`);
  if (!m) return false;
  m.scrollIntoView({block: 'center', behavior: 'smooth'});
  m.focus?.({preventScroll: true});
  return true;
}

import {createNoteDoc} from './basket-data.js';
import {createAnchoredMenu} from './anchored-menu.js';
import {copyText} from './copy-text.js';
import {articleOf, knownArticleId} from './feed-shared.js';
import {notify, askText, askConfirm} from './small-notice.js';
import {highlightBody, edgesOf, markRanges, noteOf, copyOf, cleanMemo, draftOf, replyNoteOf, MEMO_MAX, MARK_COLORS, MARK_COLOR_NAMES, markColor, isHighlight, isCollected, lastColor, highlightAt} from './text-highlights-model.mjs';
import {partStyles} from './part-styles.js';
import {swatchHtml} from './color-swatch.mjs';
// S67-41: 이 부품의 모양 파일(part-styles.js 표)을 부품이 열리기 전에 붙인다 — 화면 모양 목록에 없어도 꾸밈 없이 그려지지 않게.
await partStyles('text-highlights');
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
// S70-16: 모양·색 칸(mark_kind·mark_color, DB 20261125090000)이 생기기 전에도 읽기가 깨지지 않게 열 이름을 적지 않고 모두 읽는다(그 칸이 없으면 모두 밑줄 줄).
export const HL_COLS = '*';
const LIMIT = 500;
const failNote = e => (e?.status ? `저장하지 못했어요 · HTTP ${e.status}` : '저장하지 못했어요 · 잠시 뒤 다시');

let rows = null, scope = '', loading = null;
const listeners = new Set();
const emit = () => { for (const fn of listeners) { try { fn(); } catch { /* 그리는 쪽 오류는 다른 칸에 번지지 않게 */ } } };
export const onHighlights = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const scopeNow = () => { const c = rt()?.context?.read?.(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };

// NEWS-모두에게열기 ③: 뉴스·사회운동 밑줄의 source_id가 옛 글 id면(옮기기 전에 그은 밑줄) 읽을 때 공용 글 id로 바꿔 이 탭 메모리에만 둔다
// (서버 줄은 그대로 — 고치기는 메모만). 그래서 News 상세·[밑줄] 탭·노트 'News에서'가 모두 같은 공용 id로 밑줄을 찾는다(feed-shared.js 지도).
async function toArticleIds(list) {
  const out = Array.isArray(list) ? list : [];
  for (const type of ['news', 'outside']) {
    const ids = out.filter(h => h?.source_type === type).map(h => h.source_id);
    if (!ids.length) continue;
    let map = null;
    try { map = await articleOf(type, ids); } catch { map = null; }
    if (map) for (const h of out) if (h?.source_type === type && map.has(h.source_id)) h.source_id = map.get(h.source_id);
  }
  return out;
}
const withArticleId = h => (h && (h.source_type === 'news' || h.source_type === 'outside') ? {...h, source_id: knownArticleId(h.source_type, h.source_id)} : h);
// 내 작업공간 밑줄 전부(새 것이 위, 500개까지). force면 다시 읽는다. 못 읽으면 throw(목록 칸이 [다시]).
export function loadHighlights({force = false} = {}) {
  if (scope !== scopeNow()) { rows = null; scope = scopeNow(); loading = null; }
  if (rows && !force) return Promise.resolve(collected());
  if (loading && !force) return loading;
  const w = workspaceOf(), my = scope;
  if (!w) return Promise.resolve([]);
  const p = rt().api(`/rest/v1/app_news_highlights?workspace_id=eq.${q(w)}&select=${HL_COLS}&order=created_at.desc&limit=${LIMIT}`, {singleFlight: false})
    .then(toArticleIds)
    .then(r => { if (my === scope) { rows = r; emit(); } return collected() || []; })
    .finally(() => { if (loading === p) loading = null; });
  loading = p;
  return p;
}
// 모아 보기·밑줄 개수는 형광펜 줄을 빼고 본다(S70-16 — 형광은 글 안에만). 글 칸에 칠할 때는 sourceMarks(형광 포함).
const collected = () => (rows ? rows.filter(isCollected) : rows);
export const highlightsNow = () => collected();
export const sourceHighlights = (type, id) => (rows || []).filter(h => isCollected(h) && h.source_type === type && h.source_id === id);
export const sourceMarks = (type, id) => (rows || []).filter(h => h.source_type === type && h.source_id === id);
export const highlightById = id => (rows || []).find(h => h.id === id) || null;
window.addEventListener('kptu:session-changed', () => { rows = null; scope = ''; loading = null; emit(); });

export async function addHighlight(source, quote, edges, memo = null, mark = null) {
  const body = highlightBody(workspaceOf(), source, quote, edges, memo, mark);
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
  const row = withArticleId(Array.isArray(saved) ? saved[0] : null);
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
      // 노트에서 저장한 밑줄(S62-17)은 이미 노트 안이라 [노트로도 보내기]가 없다.
      ...(row.source_type === 'note' ? [] : [{label: '노트로도 보내기', run: ({close}) => { close(); const h = highlightById(row.id); if (h) void noteWithNotice([h]); }}]),
    ]});
  return row;
}
// 고른 글 줄의 [노트로]: 저장하지 않고 고른 글 + 출처만 노트로.
export const noteFromSelection = info => noteWithNotice([draftOf(info?.source, info?.quote)]);
// S69-86 BRIEF-밑줄노트: 고른 글 줄의 [답글] — 한 줄 입력창에 메모를 쓰면 고른 글 + 메모 + 출처로 새 노트 하나(밑줄은 저장하지 않음, 글은 복사해 넣는다).
export async function replyFromSelection(info) {
  const draft = draftOf(info?.source, info?.quote);
  if (!draft.quote) return null;
  const anchor = info?.anchor?.isConnected && !info.anchor.closest('[hidden]') ? info.anchor : null;
  const memo = await askText(anchor, {text: '메모 남기기', placeholder: '생각을 한 줄', max: MEMO_MAX, ok: '노트에 저장'});
  const n = replyNoteOf(draft, memo);
  if (!n) return null;
  try { const row = await createNoteDoc(n, rt()); notify('메모를 노트에 저장했어요', {record: false}); return row; }
  catch (e) { notify(e?.message && !e?.status ? e.message : '노트에 저장하지 못했어요 · 잠시 뒤 다시', {error: true, record: false}); return null; }
}

// ---------- 형광펜(S70-16) ----------
// 글 안에만 칠하는 표시(같은 표, mark_kind 'highlight'). 내 작업공간 주인만(기존 RLS 그대로). 메모·모아 보기 없음.
// 색 기억 = 가장 최근에 칠하거나 색을 바꾼 형광 줄의 색(서버 줄 — 기기 저장 없음, 다른 기기에서도 같다).
const markFail = e => (e?.status === 400 ? '형광펜을 아직 쓸 수 없어요 · 곧 열려요' : failNote(e));
let usedNow = ''; // 이 탭에서 막 쓴 색(칠한 표시를 다 지워도 이어 쓰게). 서버 줄에서 읽은 색이 기본.
window.addEventListener('kptu:session-changed', () => { usedNow = ''; });
export const markLastColor = () => usedNow || lastColor(rows);
export async function saveMark(info, color) {
  if (!info?.source) { notify('이 글은 형광펜을 칠할 수 없어요', {error: true, record: false}); return null; }
  const full = info.zoneEl?.textContent || '';
  let row;
  try { row = await addHighlight(info.source, info.quote, edgesOf(full, info.start, info.end), null, {kind: 'highlight', color: markColor(color)}); }
  catch (e) { notify(e?.message === 'shape' ? '선택한 글을 칠할 수 없어요' : markFail(e), {error: true, record: false}); return null; }
  usedNow = markColor(row.mark_color);
  notify(`형광펜 · ${MARK_COLOR_NAMES[markColor(row.mark_color)]}`, {ms: 5000, label: '형광펜', undo: async () => { await removeHighlight(row.id); }});
  return row;
}
export async function recolorMark(h, color) {
  const c = markColor(color);
  if (!h?.id || markColor(h.mark_color) === c) return h;
  try {
    const saved = await rt().api(`/rest/v1/app_news_highlights?id=eq.${q(h.id)}&workspace_id=eq.${q(workspaceOf())}`, {method: 'PATCH', prefer: 'return=representation', body: {mark_color: c, updated_at: new Date().toISOString()}, singleFlight: false});
    const row = withArticleId(Array.isArray(saved) ? saved[0] : null);
    if (!row?.id) throw Object.assign(new Error('gone'), {code: 'gone'});
    rows = (rows || []).map(x => (x.id === h.id ? row : x));
    usedNow = c;
    emit();
    return row;
  } catch (e) { notify(e?.code === 'gone' ? '이미 삭제한 형광펜이에요' : markFail(e), {error: true, record: false}); return null; }
}
// 지우기: 확인 없이 지우고 [되돌리기](같은 글·같은 색으로 다시).
export async function eraseMark(h) {
  if (!h?.id) return false;
  try { await removeHighlight(h.id); }
  catch (e) { notify(failNote(e), {error: true, record: false}); return false; }
  const src = {type: h.source_type, id: h.source_id, title: h.source_title, media: h.source_media, date: h.source_date, url: h.source_url};
  notify('형광펜을 삭제했어요', {label: '형광펜 삭제', undo: async () => { await addHighlight(src, h.quote, {prefix: h.quote_prefix || '', suffix: h.quote_suffix || ''}, null, {kind: 'highlight', color: h.mark_color}); }});
  return true;
}
// 고른 자리 [start, end)가 이미 칠한 형광 위인가(글 칸에 칠해 둔 표시로 찾는다).
export function markAt(zoneEl, start, end) {
  if (!zoneEl) return null;
  const ids = new Set([...zoneEl.querySelectorAll('mark.hl-mark[data-hl-kind="highlight"]')].map(m => m.dataset.hlId));
  if (!ids.size) return null;
  const list = (rows || []).filter(h => ids.has(h.id));
  return highlightAt(markRanges(zoneEl.textContent, list), list, start, end);
}
// 고른 글 줄(text-select-bar.js)에 주는 형광펜 묶음. 글 칸 주인은 bindSelectZone(…, {marks: markActions})로 켠다.
export const markActions = Object.freeze({save: saveMark, recolor: recolorMark, erase: eraseMark, lastColor: markLastColor, find: markAt});

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
      const row = highlightById(seg.id), pen = isHighlight(row);
      mark.className = pen ? `hl-mark hl-pen hl-c-${markColor(row.mark_color)}` : 'hl-mark';
      mark.dataset.hlId = seg.id;
      if (pen) mark.dataset.hlKind = 'highlight';
      if (seg.first) { mark.tabIndex = 0; mark.setAttribute('role', 'button'); mark.setAttribute('aria-label', pen ? `형광펜 ${MARK_COLOR_NAMES[markColor(row.mark_color)]} — 색 바꾸기·삭제` : '밑줄 — 메모 보기'); }
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
    if (isHighlight(h)) {
      const now = markColor(h.mark_color);
      return `<div class="hl-menu-dots ui-swatches" role="group" aria-label="형광펜 색">${MARK_COLORS.map(c => swatchHtml({color: `var(--kptu-hl-mark-${c})`, label: MARK_COLOR_NAMES[c], on: c === now, attrs: {'data-hl-menu': 'color', 'data-hl-color': c}})).join('')}</div><button type="button" class="row-act" data-hl-menu="copy">복사</button><button type="button" class="row-act" data-hl-menu="erase">삭제</button>`;
    }
    return `${h.memo ? `<p class="hl-menu-memo"><span class="hl-menu-k">메모</span>${esc(h.memo)}</p>` : ''}<button type="button" class="row-act" data-hl-menu="memo">${h.memo ? '메모 수정' : '메모 달기'}</button>${menuSource ? '<button type="button" class="row-act" data-hl-menu="source">원문에서 보기</button>' : ''}${h.source_type === 'note' ? '' : '<button type="button" class="row-act" data-hl-menu="note">노트로</button>'}<button type="button" class="row-act" data-hl-menu="copy">복사</button><button type="button" class="row-act" data-hl-menu="delete">삭제</button>`;
  },
  onAction: (button, active) => {
    const h = highlightById(active.id);
    if (!h) return;
    const a = button.dataset.hlMenu, at = active.trigger?.isConnected ? active.trigger : null;
    if (a === 'color') { void recolorMark(h, button.dataset.hlColor); return; }
    if (a === 'erase') { void eraseMark(h); return; }
    if (a === 'source') menuSource?.(h); else if (a === 'memo') void editMemo(h, at); else if (a === 'note') void noteWithNotice([h]); else if (a === 'copy') void copyHighlight(h); else if (a === 'delete') void deleteHighlight(h, at);
  }});
// onSource(h): 밑줄 목록이 글 상세 밖(노트 'News에서 › 밑줄')에 있을 때만 [원문에서 보기]를 더한다(그 글 그 자리로). 글 칸 안 밑줄 메뉴는 없음.
let menuSource = null;
export const openMarkMenu = (trigger, {onSource = null, ...opts} = {}) => { menuSource = typeof onSource === 'function' ? onSource : null; return markMenu.open(trigger, opts); };
export function bindMarks(container) {
  if (!container || container.dataset.hlMarksBound) return;
  container.dataset.hlMarksBound = '1';
  const first = mark => container.querySelector(`mark.hl-mark[data-hl-id="${CSS.escape(mark.dataset.hlId)}"][tabindex]`) || mark;
  container.addEventListener('click', e => {
    const mark = e.target.closest?.('mark.hl-mark');
    if (!mark || !container.contains(mark)) return;
    const sel = window.getSelection?.();
    if (sel && !sel.isCollapsed) return; // 글을 고르는 중이면 메뉴를 열지 않는다
    menuSource = null;
    markMenu.open(first(mark));
  });
  container.addEventListener('keydown', e => {
    const mark = e.target.closest?.('mark.hl-mark');
    if (!mark || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    menuSource = null;
    markMenu.open(first(mark));
  });
}
// [밑줄] 탭에서 글을 열었을 때 그 자리로: 칠한 밑줄로 옮기고 잠깐 강조.
export function revealMark(zoneEl, id) {
  const m = zoneEl?.querySelector(`mark.hl-mark[data-hl-id="${CSS.escape(id)}"]`);
  if (!m) return false;
  m.scrollIntoView({block: 'center', behavior: 'smooth'});
  m.focus?.({preventScroll: true});
  // 잠깐 밝히기: 다른 화면에서 연 기록과 같은 공용 표시(base-ui.css [data-journal-flash], record-flash.js). 끝나면 노란 밑줄 그대로.
  m.removeAttribute('data-journal-flash'); void m.offsetWidth; m.setAttribute('data-journal-flash', '');
  m.addEventListener('animationend', () => m.removeAttribute('data-journal-flash'), {once: true});
  return true;
}

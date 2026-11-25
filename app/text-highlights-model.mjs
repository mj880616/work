// S53-5 NEWS-밑줄모으기(시안 docs/design/mockups/news-highlights.html #2090): 원문에서 고른 글(밑줄)의 순수 계산. DOM·네트워크 없음.
// 저장 표는 public.app_news_highlights(DB 20261108070000 — 자기 작업공간 주인만, 고치기는 메모만). 화면 쪽은 text-highlights.js·text-select-bar.js·now-highlights.js.
// 글자 제한은 DB 검사와 같다: 고른 글 1~4000자, 앞뒤 글 각 60자, 메모 1~2000자, 제목 500자·매체 200자(제어 문자 없음), 주소 http(s) 2000자.

export const QUOTE_MAX = 4000, EDGE = 60, MEMO_MAX = 2000;
// note: 노트 본문에서 고른 밑줄(S62-17 NOTE-노트에서도밑줄, DB 20261115194000 — source_id = app_notes.id, 노트 원문은 서버 app_notes 그대로).
// reading: 읽을 거리 원문 사본에서 고른 밑줄(S68-09 READ-읽을거리함, DB 20261122100000 — source_id = app_reading_items.id).
// brief: 브리핑 룸 자료 보기에서 고른 밑줄(S69-86 BRIEF-밑줄노트, DB 20261125010000 — source_id = app_documents.id, 출처 사본은 자료 이름·브리핑 날짜).
export const HL_TYPES = Object.freeze(['news', 'outside', 'telegram', 'note', 'reading', 'brief']);
// S70-16 UI-고른글메뉴·형광펜(시안 docs/design/mockups/highlight-underline-options.html): 같은 표의 한 줄에 모양(mark_kind)과 색(mark_color) 칸
// (DB 20261125090000). mark_kind 비움 = 지금까지의 '밑줄 저장'(모아 보기에 나옴), 'highlight' = 형광펜(글 안에만 칠하고 모아 보기에는 안 나옴).
// 색은 톤다운 다섯 가지(DB 검사와 같음), 비면 노랑. 표시 하나 = 원본 종류 + 원본 id + 위치(고른 글·앞뒤 글) + 모양 + 색.
export const MARK_COLORS = Object.freeze(['yellow', 'green', 'blue', 'pink', 'orange']);
export const MARK_COLOR_NAMES = Object.freeze({yellow: '노랑', green: '초록', blue: '파랑', pink: '분홍', orange: '주황'});
export const DEFAULT_COLOR = 'yellow';
export const markColor = v => (MARK_COLORS.includes(v) ? v : DEFAULT_COLOR);
export const isHighlight = h => h?.mark_kind === 'highlight';
// 모아 보기(노트 [밑줄]·저장한 글 [밑줄]·밑줄 개수)에 나오는 줄 = 형광펜이 아닌 줄.
export const isCollected = h => !!h && !isHighlight(h);
// 마지막에 쓴 형광 색: 내 형광 줄 중 가장 최근에 칠하거나 색을 바꾼 줄의 색(서버 줄에서 읽으므로 다른 기기에서도 같다). 없으면 노랑.
export function lastColor(list) {
  let best = null, at = -Infinity;
  for (const h of Array.isArray(list) ? list : []) {
    if (!isHighlight(h)) continue;
    const t = Math.max(Date.parse(h.updated_at || '') || -Infinity, Date.parse(h.created_at || '') || -Infinity);
    if (t > at) { at = t; best = h; }
  }
  return best ? markColor(best.mark_color) : DEFAULT_COLOR;
}
// 고른 자리 [start, end)와 겹치는 형광 표시(칠한 자리 목록 ranges = markRanges 답, rows = 그 글의 줄들). 첫 번째만.
export function highlightAt(ranges, rows, start, end) {
  const byId = new Map((Array.isArray(rows) ? rows : []).map(h => [h.id, h]));
  for (const r of Array.isArray(ranges) ? ranges : []) {
    const h = byId.get(r.id);
    if (isHighlight(h) && start < r.end && r.start < end) return h;
  }
  return null;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const oneLine = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const httpUrl = v => (typeof v === 'string' && /^https?:\/\/\S+$/.test(v.trim()) && v.trim().length <= 2000 ? v.trim() : '');
const iso = v => { const t = typeof v === 'string' || v instanceof Date ? Date.parse(v) : NaN; return Number.isFinite(t) ? new Date(t).toISOString() : null; };

// 고른 글: 앞뒤 빈칸만 걷는다(문단 줄바꿈은 그대로). 4000자를 넘으면 ''(저장하지 않음 — 화면이 '너무 길어요'를 알린다).
export function cleanQuote(text) {
  const t = String(text ?? '').replace(/\r\n?/g, '\n').replace(/[ \t\f\v ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return t && t.length <= QUOTE_MAX ? t : '';
}
export const tooLong = text => String(text ?? '').trim().length > QUOTE_MAX;
export function cleanMemo(text) {
  const t = String(text ?? '').trim();
  return t ? t.slice(0, MEMO_MAX) : null;
}
// 앞뒤 글(다시 열 때 같은 자리를 찾는 실마리). full = 글 칸 전체 글자, start/end = 고른 자리.
export function edgesOf(full, start, end) {
  const s = String(full ?? '');
  return {prefix: s.slice(Math.max(0, start - EDGE), Math.max(0, start)), suffix: s.slice(Math.max(0, end), Math.max(0, end) + EDGE)};
}
// 출처: {type, id, title, media, date, url}. 모양이 틀리면 null(저장하지 않음).
export function cleanSource(src) {
  if (!src || !HL_TYPES.includes(src.type) || !UUID.test(String(src.id || ''))) return null;
  return {type: src.type, id: String(src.id), title: oneLine(src.title, 500) || null, media: oneLine(src.media, 200) || null, date: iso(src.date), url: httpUrl(src.url) || null};
}
// 서버에 넣을 한 줄(authenticated가 넣을 수 있는 열만). 모양이 틀리면 null.
// mark: {kind: 'highlight', color} 이면 형광 줄(메모 없음). 비우면 지금까지의 밑줄 줄 — 새 칸을 보내지 않는다(DB 적용 전에도 밑줄 저장은 그대로 된다).
export function highlightBody(workspaceId, src, quote, {prefix = '', suffix = ''} = {}, memo = null, mark = null) {
  const s = cleanSource(src), q = cleanQuote(quote);
  if (!s || !q || typeof workspaceId !== 'string' || !workspaceId) return null; // 작업공간 열쇠는 서버(외래 키·RLS)가 확인
  const body = {workspace_id: workspaceId, source_type: s.type, source_id: s.id, quote: q, quote_prefix: String(prefix).slice(-EDGE), quote_suffix: String(suffix).slice(0, EDGE),
    memo: cleanMemo(memo), source_title: s.title, source_media: s.media, source_date: s.date, source_url: s.url};
  if (mark?.kind === 'highlight') Object.assign(body, {memo: null, mark_kind: 'highlight', mark_color: markColor(mark.color)});
  return body;
}
// 출처 꼬리표(노트 › 밑줄 목록 줄 앞): 노트 · 텔레그램 · News(뉴스 기사·사회운동 글).
export const sourceTag = h => (h?.source_type === 'note' ? '노트' : h?.source_type === 'telegram' ? '텔레그램' : h?.source_type === 'reading' ? '저장한 글' : h?.source_type === 'brief' ? '브리핑' : '읽을 거리');
// 노트 밑줄의 원문 글이 바뀌어 고른 글이 노트에 없는가(노트 › 밑줄 줄의 '원문이 바뀌었어요' 작은 표시). text = 노트 글자(raw_text),
// 노트가 없으면(null) 바뀐 것으로 본다. 빈칸·줄바꿈과 마크다운 기호(* _ # > ` ~ | [ ] ( ) \ -)는 빼고 비교한다(읽기 화면은 기호 없이 그려지므로).
const loose = v => String(v ?? '').replace(/[\s*_#>`~|[\]()\\-]+/g, '');
export function quoteGone(text, quote) {
  if (typeof text !== 'string') return true;
  const q = loose(quote);
  return !q || !loose(text).includes(q);
}
// 다시 열었을 때 자리 찾기: 빈칸·줄바꿈을 빼고 비교한다(고른 글은 문단 줄바꿈이 들어 있고, 칸 글자는 문단 사이 빈칸이 없다).
// 고른 글이 나오는 곳 중 앞뒤 글이 가장 많이 맞는 곳. 원문이 바뀌어 없으면 null(밑줄 글은 [밑줄] 탭에 그대로 남는다). 답의 start/end는 원래 글자 자리.
const strip = v => String(v ?? '').replace(/\s+/g, '');
export function locate(full, h) {
  const s = String(full ?? ''), q = strip(h?.quote);
  if (!q) return null;
  const pos = [];
  let flat = '';
  for (let i = 0; i < s.length; i++) if (!/\s/.test(s[i])) { flat += s[i]; pos.push(i); }
  const pre = strip(h.quote_prefix), suf = strip(h.quote_suffix);
  const score = i => {
    let a = 0, b = 0;
    while (a < pre.length && flat[i - 1 - a] === pre[pre.length - 1 - a]) a++;
    while (b < suf.length && flat[i + q.length + b] === suf[b]) b++;
    return a + b;
  };
  let best = null, at = flat.indexOf(q);
  while (at >= 0) {
    const sc = score(at);
    if (!best || sc > best.sc) best = {at, sc};
    at = flat.indexOf(q, at + 1);
  }
  return best ? {start: pos[best.at], end: pos[best.at + q.length - 1] + 1} : null;
}
// 겹치는 밑줄은 먼저 찾은 것만 칠한다(새 것이 위 — 목록 차례 그대로). 답: [{start, end, id}] 앞에서 뒤 차례.
export function markRanges(full, list) {
  const out = [];
  for (const h of Array.isArray(list) ? list : []) {
    const r = locate(full, h);
    if (r && !out.some(o => r.start < o.end && o.start < r.end)) out.push({...r, id: h.id});
  }
  return out.sort((a, b) => a.start - b.start);
}

const dayOf = v => { const t = Date.parse(v || ''); if (!Number.isFinite(t)) return ''; const d = new Date(t + 9 * 3600e3); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; };
export const shortDay = v => { const d = dayOf(v); return d ? `${d.slice(5, 7)}/${d.slice(8)}` : ''; };
// 출처 한 줄: 매체 · 날짜 · 제목.
export function sourceLine(h) {
  return [h?.source_media, dayOf(h?.source_date), h?.source_title].map(v => (typeof v === 'string' ? v.trim() : '')).filter(Boolean).join(' · ');
}
// [노트로]: 고른 글(밑줄 여러 개면 차례로) + 메모 + 출처(매체·제목·날짜·원래 주소). 노트 제목은 첫 출처 제목(없으면 '밑줄').
export function noteOf(list) {
  const rows = (Array.isArray(list) ? list : []).filter(h => h && typeof h.quote === 'string' && h.quote.trim());
  if (!rows.length) return null;
  const parts = rows.map(h => [h.quote.trim().split('\n').map(l => `> ${l}`).join('\n'), h.memo ? `메모: ${String(h.memo).trim()}` : '',
    ['출처: ' + (sourceLine(h) || '—'), h.source_url ? h.source_url : ''].filter(Boolean).join('\n')].filter(Boolean).join('\n\n'));
  const first = rows[0].source_title && String(rows[0].source_title).trim();
  const title = (rows.length > 1 ? `밑줄 ${rows.length}개 · ` : '밑줄 · ') + (first || '모음');
  return {title: title.slice(0, 80), raw_text: parts.join('\n\n---\n\n')};
}
// [답글](S69-86): 고른 글 + 내 메모 + 출처를 노트 한 장으로(밑줄은 저장하지 않음). 메모가 없으면 null. 노트 제목은 '답글 · 출처 제목'.
export function replyNoteOf(draft, memo) {
  const m = cleanMemo(memo), q = typeof draft?.quote === 'string' ? draft.quote.trim() : '';
  if (!m || !q) return null;
  const n = noteOf([{...draft, memo: m}]);
  const first = draft.source_title && String(draft.source_title).trim();
  return {title: `메모 · ${first || '선택한 글'}`.slice(0, 80), raw_text: n.raw_text};
}
// [복사]·[공유]: 고른 글 + 출처 한 줄 + 주소.
export function copyOf(h) {
  return [String(h?.quote ?? '').trim(), sourceLine(h), h?.source_url || ''].filter(Boolean).join('\n\n');
}
// 찾기 칸: 밑줄 글·메모·제목·매체 글자(띄어쓰기·대소문자 무시).
const squash = v => String(v ?? '').replace(/\s+/g, '').toLowerCase();
export function hlHit(h, query) {
  const n = squash(query);
  return !n || [h?.quote, h?.memo, h?.source_title, h?.source_media].some(v => squash(v).includes(n));
}
// 고른 칸 출처 → 밑줄 한 줄 모양(저장 전 [노트로]·[복사]에 쓴다).
export function draftOf(src, quote) {
  const s = cleanSource(src) || {};
  return {quote: cleanQuote(quote), memo: null, source_title: s.title || null, source_media: s.media || null, source_date: s.date || null, source_url: s.url || null};
}

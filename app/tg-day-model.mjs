// TG-방날짜묶기 4단계 (docs/design/tg-room-day-group.md): 텔레그램 소식 화면의 "날짜 아래 방 한 줄" 목록과 방 상세의 순수 규칙.
// DOM·네트워크 없음. 글은 모두 바깥(Drive, 서버 AI)에서 온 것이라 화면이 글자로만 넣는다. 방 이름·아이디·소식 내용은 시험에 가짜 값만 쓴다.
import {addDays} from './feed-model.mjs';

// 한 번에 읽는 날 수와 목록이 거슬러 올라가는 한계(옛 소식 목록과 같은 120일). 읽기 함수는 한 번에 93일까지, 줄 수 한도를 넘지 않게 7일씩 나눠 부른다.
export const LIST_WINDOW = 14;
export const LIST_MAX_DAYS = 120;
export const CALL_CHUNK = 7;
// 요약 상자는 4줄까지 보이고 나머지는 접는다. 요약이 없는 날(결정 4)은 소식 제목을 4개까지 모아 보여 준다.
export const SUMMARY_SHOWN = 4;
export const TITLES_SHOWN = 4;
export const LINE_TITLES = 2;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const clean = v => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const text = v => (typeof v === 'string' ? clean(v) : '');

// 방·날 한 줄의 열쇠. 방 번호는 DB 검사(^[A-Za-z0-9_.:-]{1,100}$)로 '|'를 갖지 못한다.
export const rdKey = (room, day) => `${room}|${day}`;
export function splitRdKey(key) {
  const s = String(key ?? ''), i = s.lastIndexOf('|');
  return i > 0 && DAY.test(s.slice(i + 1)) ? {room:s.slice(0, i), day:s.slice(i + 1)} : null;
}

// app_feed_room_day_lines 한 줄 → 화면 줄. 모양이 틀리면 null(버린다).
export function lineOf(r) {
  if (!r || typeof r.room_key !== 'string' || !r.room_key || !DAY.test(String(r.day ?? ''))) return null;
  const n = v => Math.max(0, Number(v) || 0);
  return {
    room_key:r.room_key, room_label:text(r.room_label) || r.room_key, day:r.day, last_at:typeof r.last_at === 'string' ? r.last_at : '',
    item_count:n(r.item_count), raw_count:n(r.raw_count), headline:text(r.headline), part_count:n(r.part_count),
    chat_kind:['user', 'group', 'channel'].includes(r.chat_kind) ? r.chat_kind : null, chat_username:typeof r.chat_username === 'string' ? r.chat_username : null,
    folder_id:typeof r.folder_id === 'string' ? r.folder_id : null, archived_at:r.archived_at || null, day_hidden_at:r.day_hidden_at || null,
  };
}

// 날짜 내림차순, 같은 날은 늦게 온 방 먼저.
export const sortLines = lines => [...(lines || [])].sort((a, b) => b.day.localeCompare(a.day) || String(b.last_at).localeCompare(String(a.last_at)) || a.room_key.localeCompare(b.room_key));

// 평소 목록에 나오는 줄: 보관한 방(archived_at)과 지운 날(day_hidden_at)은 뺀다. folder: 그 폴더의 방만(칸 줄의 폴더 칩, 빈 글이면 전체).
export function liveLines(lines, {folder = ''} = {}) {
  return (lines || []).filter(l => !l.archived_at && !l.day_hidden_at && (!folder || l.folder_id === folder));
}
// [{day, rows}] 날짜별 묶음(보이는 순서). 라벨은 화면이 dayLabel로 만든다.
export function groupLines(lines) {
  const out = [];
  for (const l of sortLines(lines)) {
    const last = out.at(-1);
    if (last && last.day === l.day) last.rows.push(l); else out.push({day:l.day, rows:[l]});
  }
  return out;
}
// 그 방의 앞뒤 날(지운 날은 건너뜀). prev = 더 오래된, next = 더 새로운. 없으면 ''.
export function neighborDays(lines, room, day) {
  const days = [...new Set((lines || []).filter(l => l.room_key === room && !l.day_hidden_at).map(l => l.day))].sort();
  return {prev:[...days].reverse().find(d => d < day) || '', next:days.find(d => d > day) || ''};
}
// 목록의 한 줄 글이 비는 줄(요약이 없는 날)이 있는 날 모음 → 소식 제목을 따로 읽어 채운다.
export const daysNeedingTitles = lines => [...new Set((lines || []).filter(l => !l.headline && !l.day_hidden_at).map(l => l.day))].sort().reverse();
// 제목 모음: 방·날별 소식 제목 (읽은 순서 = 시각 오름차순).
export function titleIndex(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const t = clean(r?.title) || clean(r?.summary);
    if (!r?.room_key || !DAY.test(String(r?.day ?? '')) || !t) continue;
    const key = rdKey(r.room_key, r.day), list = map.get(key) || [];
    if (!list.includes(t)) list.push(t);
    map.set(key, list);
  }
  return map;
}
// 목록 줄의 "그날 내용 한 줄": AI가 쓴 한 줄이 있으면 그것, 없으면 소식 제목 두 개를 이어 붙인다.
export const lineText = (line, titles) => line.headline || (titles?.get(rdKey(line.room_key, line.day)) || []).slice(0, LINE_TITLES).join(' · ');

// app_feed_room_days.parts → 묶음마다 {first_at, headline, lines, open_ref}를 시각 순으로 이어 붙인다(설계 3.2절).
// headline = 가장 이른 글 있는 묶음의 것, open_ref = 가장 이른 묶음 중 있는 것.
export function mergeParts(parts) {
  const list = (Array.isArray(parts) ? parts : []).filter(p => p && typeof p === 'object' && !Array.isArray(p)).map(p => ({
    first_at:typeof p.first_at === 'string' ? p.first_at : '', headline:text(p.headline),
    lines:(Array.isArray(p.lines) ? p.lines : []).map(text).filter(Boolean), open_ref:typeof p.open_ref === 'string' ? p.open_ref : '',
  })).filter(p => p.lines.length || p.headline).sort((a, b) => a.first_at.localeCompare(b.first_at));
  return {headline:list.find(p => p.headline)?.headline || '', lines:list.flatMap(p => p.lines), openRef:list.find(p => p.open_ref)?.open_ref || ''};
}
// 방 상세의 요약 상자 재료. kind: 'ai'(AI가 쓴 요약) | 'titles'(요약이 없는 날: 소식 제목 모음, 결정 4) | 'none'.
// partsKnown=false(요약 표를 읽지 못함)면 제목 모음이어도 "AI 요약 이전 날" 표시를 하지 않는다(old=false).
export function daySummary(parts, items, {partsKnown = true, edit = null} = {}) {
  const m = mergeParts(parts);
  // 고친 줄이 있으면 AI 줄 대신 그것을 보여 준다(AI 줄은 서버에 그대로 있다). edited=true면 화면이 '고침'을 붙인다.
  if (edit?.lines?.length) return {kind:'ai', old:false, edited:true, lines:edit.lines, shown:edit.lines.slice(0, SUMMARY_SHOWN), rest:edit.lines.slice(SUMMARY_SHOWN), openRef:m.openRef};
  if (m.lines.length) return {kind:'ai', old:false, edited:false, lines:m.lines, shown:m.lines.slice(0, SUMMARY_SHOWN), rest:m.lines.slice(SUMMARY_SHOWN), openRef:m.openRef};
  const titles = [];
  for (const r of items || []) { const t = clean(r?.title) || clean(r?.summary); if (t && !titles.includes(t)) titles.push(t); }
  if (!titles.length) return {kind:'none', old:false, lines:[], shown:[], rest:[], openRef:m.openRef};
  return {kind:'titles', old:partsKnown, lines:titles.slice(0, TITLES_SHOWN), shown:titles.slice(0, TITLES_SHOWN), rest:[], openRef:m.openRef};
}

// ---------- [텔레그램에서 열기] (설계 6.3절). 링크는 화면에서 만든다. 통과하지 못하면 방 이름 복사로 물러난다.
export const USERNAME = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
const ROOM_NUMBER = /^-?\d{1,20}$/;
export const COPY_NOTE = '방 이름을 복사했어요. 텔레그램 첫 화면에서 검색 칸에 붙여 넣으세요.';
export const OPEN_APP_URL = 'tg://';
// {kind:'link', url, how:'name'|'number'} 또는 {kind:'copy', url:OPEN_APP_URL}. 순서: 방 주소(@아이디) → 번호 링크 → 앱 첫 화면 + 방 이름 복사.
export function openTarget({room_key, chat_username, open_ref} = {}) {
  const name = String(chat_username ?? '').replace(/^@/, '');
  if (USERNAME.test(name)) return {kind:'link', url:`https://t.me/${name}`, how:'name'};
  const key = String(room_key ?? '');
  if (!ROOM_NUMBER.test(key)) return {kind:'copy', url:OPEN_APP_URL};
  const super_ = /^-100(\d{1,15})$/.exec(key);
  if (super_) {
    const ref = String(open_ref ?? '');
    return /^\d{1,12}$/.test(ref) ? {kind:'link', url:`https://t.me/c/${super_[1]}/${ref}`, how:'number'} : {kind:'link', url:`tg://openmessage?chat_id=${super_[1]}`, how:'number'};
  }
  if (key.startsWith('-')) return {kind:'link', url:`tg://openmessage?chat_id=${key.slice(1)}`, how:'number'};
  return {kind:'link', url:`tg://openmessage?user_id=${key}`, how:'number'};
}

// 읽기 범위: 오늘 기준 첫 창(14일)과, 더 읽을 때의 이전 창. 한계(120일)에 닿으면 end=true.
export function firstWindow(today) { return {from:addDays(today, -(LIST_WINDOW - 1)), to:today}; }
export function olderWindow(from, today) {
  const floor = addDays(today, -(LIST_MAX_DAYS - 1)), to = addDays(from, -1);
  if (to < floor) return null;
  const start = addDays(from, -LIST_WINDOW);
  return {from:start < floor ? floor : start, to};
}
export const reachedEnd = (from, today) => from <= addDays(today, -(LIST_MAX_DAYS - 1));
// 한 창을 CALL_CHUNK일씩 나눈다(한 번 부를 때 돌려받는 줄 수가 서버 한도를 넘지 않게).
export function chunksOf(from, to) {
  const out = [];
  for (let a = from; a <= to;) { const b = addDays(a, CALL_CHUNK - 1); out.push([a, b > to ? to : b]); a = addDays(a, CALL_CHUNK); }
  return out;
}

// ---------- 폴더·보관 (4-나). 폴더는 방 단위이고 방 하나는 폴더 하나다. 보관은 방 전체다(수집·요약은 계속).
export const FOLDER_NAME_MAX = 20;
export const FOLDER_ERROR_TEXT = Object.freeze({
  EMPTY:'폴더 이름을 적어 주세요.', LONG:`폴더 이름은 ${FOLDER_NAME_MAX}자까지예요.`, TAKEN:'이미 있는 폴더 이름이에요.', LIMIT:'폴더는 30개까지 만들 수 있어요.',
  GONE:'이 폴더가 그사이 사라졌어요. 목록을 다시 불러왔어요.', REFUSED:'저장하지 못했어요. 아무것도 바뀌지 않았어요.', UNAVAILABLE:'폴더 기능이 아직 준비되지 않았어요. 아무것도 바뀌지 않았어요.',
  UNKNOWN:'저장했는지 확인하지 못했어요. 목록을 다시 불러왔어요.',
});
// 폴더 이름 다듬기: 줄바꿈·탭은 띄어쓰기로, 앞뒤 공백 제거. {ok, name} 또는 {ok:false, error: EMPTY | LONG}.
export function cleanFolderName(value) {
  const name = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) return {ok:false, error:'EMPTY'};
  return [...name].length > FOLDER_NAME_MAX ? {ok:false, error:'LONG'} : {ok:true, name};
}
// 보관함: 보관한 방마다 {room_key, room_label, folder_id, last(그 방의 가장 최근 줄 또는 null)}. 방 표(rooms: Map)가 기준이고 줄은 최근 날·한 줄을 채운다.
export function archivedRooms(rooms, lines) {
  const out = [];
  for (const [key, r] of rooms || []) {
    if (!r?.archived_at) continue;
    const last = sortLines((lines || []).filter(l => l.room_key === key && !l.day_hidden_at))[0] || null;
    out.push({room_key:key, room_label:r.room_label || last?.room_label || key, folder_id:r.folder_id || null, last});
  }
  return out.sort((a, b) => (b.last?.day || '').localeCompare(a.last?.day || '') || a.room_label.localeCompare(b.room_label));
}
// 방 표의 상태를 줄에 입힌다(줄이 가진 값보다 방 표가 기준).
export const withRoomState = (lines, rooms) => (lines || []).map(l => { const r = rooms?.get(l.room_key); return r ? {...l, folder_id:r.folder_id || null, archived_at:r.archived_at || null} : l; });

// ---------- 밀기 (폰, 터치만). 가로로 충분히 밀었을 때만 반응한다. 오른쪽으로 밀면 왼쪽에 두 버튼(폴더로·보관, 64px씩 128px),
// 왼쪽으로 밀면 오른쪽에 한 버튼(삭제 64px). 화면 가장자리 24px 안에서 시작한 밀기는 무시한다(뒤로가기 제스처와 겹침 방지).
export const SWIPE_BTN = 64;
export const SWIPE_START = 12;
export const SWIPE_EDGE = 24;
// 'wait'(아직 모름) | 'scroll'(세로, 밀기 아님) | 'swipe'(가로가 세로의 1.5배를 넘고 12px 이상)
export function swipeIntent(dx, dy) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (Math.max(ax, ay) < SWIPE_START) return 'wait';
  return ax >= SWIPE_START && ax > ay * 1.5 ? 'swipe' : 'scroll';
}
export const swipeEdge = (x, width) => !(x >= SWIPE_EDGE && x <= width - SWIPE_EDGE);
// allow: 각 쪽 버튼 수 {start, end}(0 = 그쪽 버튼 없음).
export const swipeWidths = allow => ({start:(Number(allow?.start) || 0) * SWIPE_BTN, end:(Number(allow?.end) || 0) * SWIPE_BTN});
export function swipeOffset(dx, open = 0, allow = {start:2, end:1}) {
  const w = swipeWidths(allow), x = (Number(open) || 0) + (Number(dx) || 0);
  return Math.max(-w.end, Math.min(w.start, x)) + 0;
}
// 손을 뗀 자리 → 'start' | 'end' | ''(닫힘): 열 폭의 절반 이상 밀렸으면 열린 채로 둔다.
export function swipeSettle(offset, allow = {start:2, end:1}) {
  const w = swipeWidths(allow);
  return w.start && offset >= w.start / 2 ? 'start' : w.end && offset <= -w.end / 2 ? 'end' : '';
}
export const swipeOpenOffset = (side, allow = {start:2, end:1}) => { const w = swipeWidths(allow); return side === 'start' ? w.start : side === 'end' ? -w.end : 0; };
// 보는 자리마다 밀었을 때의 버튼. live: 폴더로·보관(오른쪽 밀기) / 삭제(왼쪽 밀기), archive: 꺼내기(오른쪽 밀기).
export const SWIPE_ACTIONS = Object.freeze({
  live:{start:['folder', 'archive'], end:['trash']},
  archive:{start:['unarchive'], end:[]},
});
export const ACTION_LABEL = Object.freeze({folder:'폴더로', archive:'보관', trash:'삭제', unarchive:'꺼내기'});
export const allowOf = mode => { const a = SWIPE_ACTIONS[mode] || {start:[], end:[]}; return {start:a.start.length, end:a.end.length}; };

// ---------- TG-요약고치기 (docs/design/tg-summary-edit.md): 명진이 손으로 고친 요약은 AI 값과 따로 서버에 있다(app_feed_summary_edits).
// 화면은 AI 값 위에 고친 값을 입혀 보여 줄 뿐이고 AI 값은 지우지 않는다. [AI 원래 요약으로]는 고친 값을 비워 AI 값이 다시 보이게 한다.
export const SUMEDIT = Object.freeze({SUMMARY_MAX:400, HEADLINE_MAX:60, LINES_MAX:12, LINE_MAX:150});
export const SUMEDIT_TEXT = Object.freeze({
  done:'요약을 고쳤어요.', reset:'AI가 쓴 요약으로 되돌렸어요.', noop:'바뀐 곳이 없어요.',
  EMPTY:'요약을 적어 주세요.', LONG_SUMMARY:`요약은 ${SUMEDIT.SUMMARY_MAX}자까지예요.`, LONG_HEADLINE:`한 줄은 ${SUMEDIT.HEADLINE_MAX}자까지예요.`,
  MANY:`요약은 ${SUMEDIT.LINES_MAX}줄까지예요.`, LONG_LINE:`한 줄은 ${SUMEDIT.LINE_MAX}자까지예요.`,
  GONE:'이 요약이 그사이 사라졌어요. 목록을 다시 불러왔어요.', REFUSED:'저장하지 못했어요. 아무것도 바뀌지 않았어요.', UNAVAILABLE:'요약 고치기가 아직 준비되지 않았어요. 아무것도 바뀌지 않았어요.',
  UNKNOWN:'저장했는지 확인하지 못했어요. 목록을 다시 불러왔어요.',
});
export const itemTarget = id => `item:${id}`;
export const dayTarget = (room, day) => `day:${room}|${day}`;
const oneLine = v => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
// 서버가 돌려준 고친 값 한 벌 → 화면이 쓰는 꼴({summary?, headline?, lines?}). 모양이 틀린 칸은 버린다. headline은 빈 글도 "고쳐서 비운 것"이라 남긴다.
export function cleanEditVals(v) {
  const out = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  if (typeof v.summary === 'string' && oneLine(v.summary)) out.summary = oneLine(v.summary);
  if (typeof v.headline === 'string') out.headline = oneLine(v.headline);
  if (Array.isArray(v.lines)) { const lines = v.lines.map(x => (typeof x === 'string' ? oneLine(x) : '')).filter(Boolean); if (lines.length) out.lines = lines; }
  return out;
}
// 읽기 함수가 돌려준 줄 [{target, vals}] → Map(target → 고친 값). 값이 하나도 없는 줄은 뺀다.
export function editMap(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const t = typeof r?.target === 'string' ? r.target : '', vals = cleanEditVals(r?.vals);
    if (/^(item:[0-9a-f-]{36}|day:[A-Za-z0-9_.:-]{1,100}\|\d{4}-\d{2}-\d{2})$/.test(t) && Object.keys(vals).length) map.set(t, vals);
  }
  return map;
}
// 소식 한 줄의 요약: 고친 값이 있으면 그것, 없으면 AI가 쓴 summary.
export const itemSummary = (r, edits) => edits?.get?.(itemTarget(r?.id))?.summary ?? r?.summary ?? '';
export const isItemEdited = (r, edits) => edits?.get?.(itemTarget(r?.id))?.summary !== undefined;
// 목록 줄: 고친 한 줄(headline)이 있으면 그것을 입힌다(빈 글로 고친 것도 그대로: 소식 제목 모음으로 물러난다).
export function applyLineEdit(line, edits) {
  const e = edits?.get?.(dayTarget(line?.room_key, line?.day));
  return e && e.headline !== undefined ? {...line, headline:e.headline} : line;
}
export const dayEdit = (edits, room, day) => edits?.get?.(dayTarget(room, day)) || null;

// 소식 한 줄 입력 → {ok, value} | {ok:false, error}. 줄바꿈은 띄어쓰기로.
export function cleanSummaryInput(value) {
  const v = oneLine(value);
  if (!v) return {ok:false, error:'EMPTY'};
  return [...v].length > SUMEDIT.SUMMARY_MAX ? {ok:false, error:'LONG_SUMMARY'} : {ok:true, value:v};
}
// 그날 요약 입력: headline(목록에 보이는 한 줄) + 줄 모음(글 상자의 한 줄 = 요약 한 줄). → {ok, headline, lines} | {ok:false, error}
export function cleanDayInput({headline = '', text = ''} = {}) {
  const h = oneLine(headline);
  if ([...h].length > SUMEDIT.HEADLINE_MAX) return {ok:false, error:'LONG_HEADLINE'};
  const lines = String(text ?? '').split(/\r?\n/).map(oneLine).filter(Boolean);
  if (!lines.length) return {ok:false, error:'EMPTY'};
  if (lines.length > SUMEDIT.LINES_MAX) return {ok:false, error:'MANY'};
  if (lines.some(l => [...l].length > SUMEDIT.LINE_MAX)) return {ok:false, error:'LONG_LINE'};
  return {ok:true, headline:h, lines};
}
// 지금 보이는 값({headline, lines})과 입력을 견줘 바뀐 칸만 담은 patch를 만든다. 바뀐 곳이 없으면 {}.
export function dayPatch(current, input) {
  const patch = {};
  if (input.headline !== oneLine(current?.headline)) patch.headline = input.headline;
  const cur = (current?.lines || []).map(oneLine).filter(Boolean);
  if (cur.length !== input.lines.length || cur.some((l, i) => l !== input.lines[i])) patch.lines = input.lines;
  return patch;
}
// 서버가 거절한 이유 코드 → 화면 글.
export const sumEditErrorText = code => SUMEDIT_TEXT[code] || SUMEDIT_TEXT.REFUSED;
// 요약 상자 줄 모음의 글 상자용 글(한 줄 = 요약 한 줄).
export const linesToText = lines => (lines || []).join('\n');

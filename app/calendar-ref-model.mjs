// 원장 재료 C-4 (docs/design/ledger-sources.md 5절): 개인 공유 캘린더 '참고 일정' 순수 규칙.
// 화면·네트워크 없음. 어느 일정을 볼지(색·내가 만든 일정) → 업무/개인/애매 판단(규칙만, AI 없음) → 참고 일정 표 한 줄 모양 →
// 표에 이미 있는 줄과 맞춰 넣기·고치기·지우기 계획까지가 이 파일이다. 표에 쓰는 일은 calendar-ref-data.js가 한다.
// 공개 저장소: 캘린더·일정 ID 원문은 표에 두지 않고 지문(eventKey)만 둔다. 제목과 시각 말고는 저장하지 않는다.
import {seoulDateKey, seoulClock} from './meeting-time.js';
import {orgKeys, orgKey, orgAllNames} from './org-name-match.mjs';

export const TITLE_MAX = 80;       // 표 CHECK와 같다(1~80자, 제어문자 없음)
export const SYNC_EVENT_CAP = 250; // 한 번에 다루는 일정 수(Edge가 캘린더 하나에 250개까지 준다)
export const COLORS_MAX = 5;       // 프로필 칸 CHECK와 같다(색 번호 0~5개)
export const CALENDAR_ID_MAX = 200;

// 업무 낱말(제목에 하나라도 있으면 업무). 목록은 코드 상수다(설계 5.2).
export const WORK_WORDS = Object.freeze(['교섭', '회의', '간담회', '집회', '결의대회', '기자회견', '국회', '조정', '면담', '토론회', '총회', '대의원대회', '농성', '선전전', '쟁대위', '노사협의']);
// 개인 낱말(업무 규칙에 안 걸린 제목에 하나라도 있으면 개인). 개인은 저장하지 않는다.
export const PERSONAL_WORDS = Object.freeze(['병원', '치과', '생일', '가족', '여행', '학원', '장보기', '휴가', '연차', '반차', '제사', '기일']);
const NO_TITLE = '(제목 없음)';

const compact = text => String(text ?? '').normalize('NFC').replace(/[\s·‧․.,()[\]{}<>「」『』'"“”‘’\-–_/]/g, '').toLowerCase();

// ---- 프로필 고르기 값 (app_profiles.ledger_calendar) ----
// 읽은 값 → 화면용 {calendar, colors, mine}. 모양이 틀린 칸은 버린다.
export function parseChoice(raw) {
  const out = {calendar: '', colors: [], mine: false};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  if (typeof raw.calendar === 'string' && raw.calendar.length >= 1 && raw.calendar.length <= CALENDAR_ID_MAX && !/[\u0000-\u001f\u007f]/.test(raw.calendar)) out.calendar = raw.calendar;
  if (Array.isArray(raw.colors)) out.colors = [...new Set(raw.colors.filter(c => typeof c === 'string' && /^[0-9]{1,2}$/.test(c)))].slice(0, COLORS_MAX);
  if (raw.mine === true) out.mine = true;
  return out;
}
// 화면 값 → 저장할 값. 캘린더가 없으면 빈 객체(고르기 비움).
export function serializeChoice(choice) {
  const c = parseChoice(choice);
  if (!c.calendar) return {};
  return {calendar: c.calendar, colors: c.colors, mine: c.mine};
}
// 색 번호 켜고 끄기. 다섯 개를 넘기면 거절(null).
export function toggleColor(colors, id) {
  const list = Array.isArray(colors) ? colors : [];
  if (list.includes(id)) return list.filter(c => c !== id);
  return list.length >= COLORS_MAX ? null : [...list, id];
}

// ---- 일정 고르기 ----
// 고른 캘린더의 일정 중 ① 색이 고른 색이거나 ② 내가 만든 일정(mine, 고른 경우만). 취소된 일정은 뺀다.
export function isSelected(event, choice) {
  if (!event || !choice?.calendar || event.calendarId !== choice.calendar || event.status === 'cancelled') return false;
  if (!event.id || !event.start) return false;
  if (event.colorId != null && choice.colors.includes(String(event.colorId))) return true;
  return !!choice.mine && event.mine === true;
}

// ---- 제목·날짜·키 ----
export function cleanTitle(value) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return [...text].slice(0, TITLE_MAX).join('').trim();
}
export const eventDay = event => event.allDay ? String(event.start).slice(0, 10) : seoulDateKey(event.start);
export function eventStartAt(event) {
  if (event.allDay) return null;
  const t = Date.parse(event.start);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
// <캘린더 ID>:<일정 ID>의 SHA-256 앞 32자. 원문은 저장하지 않는다.
export async function eventKey(calendarId, eventId, subtle = globalThis.crypto?.subtle) {
  if (!subtle) throw new Error('이 브라우저에서는 일정 지문을 만들 수 없어요.');
  const bytes = new TextEncoder().encode(`${calendarId}:${eventId}`);
  const hash = new Uint8Array(await subtle.digest('SHA-256', bytes));
  return [...hash].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// ---- 업무 여부 판단 (설계 5.2: 규칙으로만, 위에서부터) ----
// orgs = [{id, name, aliases}], projectNames = [이름]. 돌려주는 값: {verdict:'work'|'unsure'|'personal', organizationId|null}
function titleOrgs(titleKey, orgs) {
  const hits = [];
  for (const org of orgs || []) {
    if (!org?.id) continue;
    const found = orgAllNames(org).some(name => orgKeys(name).some(k => [...k].length >= 3 && titleKey.includes(k)));
    if (found) hits.push(org.id);
  }
  return hits;
}
export function judgeEvent(event, {orgs = [], projectNames = []} = {}) {
  const title = cleanTitle(event.title);
  const knownOrg = new Set((orgs || []).map(o => o?.id).filter(Boolean));
  // 일정에 이미 걸린 담당조직(같은 작업공간 조직만). 둘 이상이면 어느 하나로 이을 수 없어 잇지 않는다.
  const linked = [...new Set((Array.isArray(event.organizationIds) ? event.organizationIds : []).map(String).filter(id => knownOrg.has(id)))];
  if (linked.length) return {verdict: 'work', organizationId: linked.length === 1 ? linked[0] : null};
  const key = orgKey(title);
  const matched = titleOrgs(key, orgs);
  if (matched.length === 1) return {verdict: 'work', organizationId: matched[0]};
  if ((projectNames || []).some(name => { const k = compact(name); return [...k].length >= 3 && compact(title).includes(k); })) return {verdict: 'work', organizationId: null};
  if (WORK_WORDS.some(word => title.includes(word))) return {verdict: 'work', organizationId: null};
  if (!title || title === NO_TITLE || [...title].length <= 2 || PERSONAL_WORDS.some(word => title.includes(word))) return {verdict: 'personal', organizationId: null};
  return {verdict: 'unsure', organizationId: null};
}

// 고른 일정 하나 → 표에 넣을 줄. 개인이면 row는 null(저장하지 않음).
export async function buildPick(event, choice, context) {
  const {verdict, organizationId} = judgeEvent(event, context);
  const day = eventDay(event);
  const key = await eventKey(event.calendarId, event.id);
  if (verdict === 'personal') return {key, day, verdict, row: null};
  return {key, day, verdict, row: {
    event_key: key, day, start_at: eventStartAt(event), all_day: !!event.allDay, title: cleanTitle(event.title),
    judged: verdict, included: verdict === 'work', decided_by: 'rule', organization_id: organizationId,
  }};
}

// ---- 표와 맞추기 (설계 3.2·5.2·5.5) ----
const FIELDS = ['title', 'day', 'start_at', 'all_day', 'judged', 'organization_id'];
const sameInstant = (a, b) => (a == null && b == null) || (a != null && b != null && Date.parse(a) === Date.parse(b));
const same = (a, b, field) => field === 'start_at' ? sameInstant(a, b) : (a ?? null) === (b ?? null);
const differs = (row, desired) => FIELDS.filter(f => !same(row[f], desired[f], f));
// existing: 표에서 읽은 줄들 [{id, event_key, day, ..., decided_by}], picks: buildPick 결과들(고른 일정 전부),
// range: {first, end}(읽은 날짜 범위, end 제외), prune: 지워도 되는 읽기였는가.
// 돌려주는 값: {insert:[row], update:[{id, patch}], remove:[id], counts:{work, unsure, personal, personalByDay}}
export function planSync({existing = [], picks = [], range, prune = true}) {
  const byKey = new Map(existing.map(row => [row.event_key, row]));
  const insert = [], update = [], remove = new Set(), seen = new Set();
  const counts = {work: 0, unsure: 0, personal: 0, personalByDay: {}};
  for (const pick of picks) {
    if (seen.has(pick.key)) continue;
    seen.add(pick.key);
    const row = byKey.get(pick.key);
    if (pick.verdict === 'personal') {
      // 명진이 직접 체크한 줄은 규칙이 개인으로 봐도 남긴다. 규칙이 만든 줄은 지운다.
      if (row && row.decided_by !== 'user') remove.add(row.id);
      if (!row) { counts.personal++; counts.personalByDay[pick.day] = (counts.personalByDay[pick.day] || 0) + 1; }
      continue;
    }
    counts[pick.verdict]++;
    if (!row) { insert.push(pick.row); continue; }
    const patch = {};
    for (const f of differs(row, pick.row)) patch[f] = pick.row[f];
    // 규칙이 정한 줄만 체크도 규칙을 따른다. 명진이 바꾼 체크(decided_by=user)는 덮지 않는다.
    if (row.decided_by !== 'user' && row.included !== pick.row.included) patch.included = pick.row.included;
    if (Object.keys(patch).length) update.push({id: row.id, patch});
  }
  if (prune && range) {
    for (const row of existing) {
      if (seen.has(row.event_key)) continue;
      if (row.day >= range.first && row.day < range.end) remove.add(row.id);
    }
  }
  return {insert, update, remove: [...remove], counts};
}

// ---- 화면 글 ----
export const refTime = row => row.all_day || !row.start_at ? '' : seoulClock(row.start_at);
export const refLine = row => `${refTime(row) ? refTime(row) + ' ' : ''}${row.title}`;
const byTime = (a, b) => (a.all_day === b.all_day ? String(a.start_at || '').localeCompare(String(b.start_at || '')) || a.title.localeCompare(b.title, 'ko') : a.all_day ? -1 : 1);
export const refsOnDay = (rows, day) => (rows || []).filter(row => row.day === day).sort(byTime);
// 아직 정하지 않은 애매한 줄(규칙이 꺼 둔 채로 있는 것).
export const needsCheck = row => row.judged === 'unsure' && row.decided_by !== 'user';
// 하루 카드 접힌 한 줄: '개인 공유 캘린더 2 · 확인 1'
export function daySummary(rows) {
  const check = rows.filter(needsCheck).length;
  return `개인 공유 캘린더 ${rows.length}${check ? ` · 확인 ${check}` : ''}`;
}
// 체크된 줄만 주간 정리·복사의 재료다.
export const includedRows = rows => (rows || []).filter(row => row.included);
// 주간 정리 모델 한 칸의 재료: 화면용 전체(all)와 복사용(items = 체크된 것만, {day, text}).
export function weeklyPart(rows, days) {
  const list = (rows || []).filter(row => days.includes(row.day)).sort((a, b) => a.day.localeCompare(b.day) || byTime(a, b));
  return {
    all: list.map(row => ({id: row.id, day: row.day, text: refLine(row), included: !!row.included, unsure: row.judged === 'unsure'})),
    items: includedRows(list).map(row => ({day: row.day, text: refLine(row)})),
  };
}
// 동기화 결과를 한 줄로(설정 화면): '참고 3개 · 확인 1 · 개인 2개 뺌'
export function syncSummary(result) {
  const parts = [`참고 ${result.work + result.unsure}개`];
  if (result.unsure) parts.push(`확인 ${result.unsure}`);
  if (result.personal) parts.push(`개인 ${result.personal}개 뺌`);
  return parts.join(' · ');
}

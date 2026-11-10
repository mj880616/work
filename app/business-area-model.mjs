// MTG-프로젝트합치기 2단계(docs/design/project-into-report.md): 사업 보고의 사업영역 꼬리표·다음 할 일 — 화면이 쓰는 순수 함수 한 곳.
// 꼬리표 = app_meetings.business_area_id(보고 하나에 하나, 명진 결정 ①). 사업영역 = 지금 프로젝트 표(app_spaces) 트리 그대로.
// 옛 보고(꼬리표 빈 것)는 첫 연결 프로젝트(project_id)를 화면에서만 꼬리표처럼 보여 준다(결정 ②, 저장하지 않음).
// 주간보고 ② 사업 요약 표의 재료는 '직접 단 꼬리표'만 쓴다 — 옛 주의 보고서가 달라지지 않게(설계 4절 2단계).

export const NEXT_PLAN_MAX = 1000; // DB 검사 app_meetings_next_plan_check 와 같은 한도

// MTG-한줄업데이트(요청 10/29 08:59): 칸 'oneline' 사업 보고 = 사업영역 한 줄 업데이트. 표의 '진행' 칸에 명진이 쓴 문장 그대로(AI 요약으로 바꾸지 않음),
// 같은 칸에 다른 줄(보고 줄·AI 한 줄)이 있으면 한 줄 업데이트가 먼저(first). 세부 내용(회의·활동 결과) 목록에는 넣지 않는다.
const ONELINE = 'oneline';
export const isOneline = meeting => meeting?.activity_kind === ONELINE;
export const onelineLine = meeting => String(meeting?.title || meeting?.series_name || '').trim();

// 직접 단 꼬리표(없으면 '').
export const areaIdOf = meeting => String(meeting?.business_area_id || '');
// MTG-사업영역없음(요청 10/30 07:51): 사용자가 [없음]을 직접 고른 보고 = 칸 business_area_none(20261030090000)이 true이고 꼬리표가 빈 것.
// 꼬리표가 있으면 꼬리표가 이긴다. 칸이 없는 서버의 줄(키 없음)에서는 [없음]을 보이지 않는다(hasAreaNone).
export const AREA_NONE = '__area_none__';
export const hasAreaNone = meeting => !!meeting && typeof meeting === 'object' && Object.hasOwn(meeting, 'business_area_none');
export const isAreaNone = meeting => !areaIdOf(meeting) && meeting?.business_area_none === true;
// 고른 값(사업영역 id | AREA_NONE | '') → 저장 몸통. withNone=false(칸 없는 서버)면 business_area_none을 보내지 않는다.
export function areaBody(value, withNone = true) {
  const v = String(value || ''), none = v === AREA_NONE;
  return {business_area_id:none || !v ? null : v, ...(withNone ? {business_area_none:none} : {})};
}
// 화면에 보이는 꼬리표: 직접 단 것, 없으면 첫 연결 프로젝트. legacy=true 면 화면에서만 빌려 보인 것. none=true 면 [없음]을 고른 보고(빌려 보이지 않음).
export function shownArea(meeting) {
  const own = areaIdOf(meeting);
  if (own) return {id:own, legacy:false};
  if (isAreaNone(meeting)) return {id:'', legacy:false, none:true};
  const old = String(meeting?.project_id || '');
  return old ? {id:old, legacy:true} : {id:'', legacy:false};
}

// 다음 할 일 글 → 줄 목록(빈 줄 빼고, 줄 앞 '-'·'·'·'•' 빼고).
export const nextPlanLines = text => String(text ?? '').split('\n').map(line => line.replace(/^\s*[-·•*]\s*/, '').trim()).filter(Boolean);
// 저장할 값: 앞뒤 공백을 걷고 비면 null. 한도를 넘으면 null 대신 오류를 낸다(화면이 알림).
export function nextPlanValue(text) {
  const value = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (value.length > NEXT_PLAN_MAX) throw Object.assign(new Error(`다음 할 일은 ${NEXT_PLAN_MAX}자까지 쓸 수 있어요.`), {code:'too_long'});
  return value || null;
}

// 트리([{project, depth}], project-catalog tree 순서) 안 경로: ['사업영역', '세부 과제', '사안'].
export function areaTrail(tree, id) {
  if (!id || !Array.isArray(tree)) return [];
  const trail = [];
  for (const {project, depth} of tree) {
    trail.length = Math.min(trail.length, depth);
    trail[depth] = String(project?.name || '').trim() || '이름 없는 사업영역';
    if (String(project?.id) === String(id)) return trail.slice(0, depth + 1);
  }
  return [];
}
export const areaLabel = (tree, id) => areaTrail(tree, id).join(' › ');

// 서울 기준 날짜 'YYYY-MM-DD' (meeting-time 없이 쓰는 작은 판).
const seoulKey = iso => { const t = Date.parse(iso); if (!Number.isFinite(t)) return ''; return new Date(t + 9 * 3600e3).toISOString().slice(0, 10); };
export const inPeriod = (meeting, from, to) => { const day = seoulKey(meeting?.meeting_at); return !!day && day >= from && day <= to; };
// 그 날이 든 주의 월요일·일요일(서울 달력 날짜 문자열 기준).
export function weekOf(day) {
  const d = new Date(`${day}T00:00:00Z`), back = (d.getUTCDay() + 6) % 7;
  const mon = new Date(d.getTime() - back * 864e5), sun = new Date(mon.getTime() + 6 * 864e5);
  return {from:mon.toISOString().slice(0, 10), to:sun.toISOString().slice(0, 10)};
}
export const shiftDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
// BIZ-주차고르기(11/09, A안 = 국제 표준 주차 ISO 8601): 주는 위 weekOf(월~일) 그대로, 번호만 붙인다.
// 1주차 = 그 해 첫 목요일이 든 주(= 1월 4일이 든 주). 어느 주의 해·번호는 그 주 목요일의 해·순번(2025.12.29~2026.1.4 = 2026년 1주차). 해마다 52주 또는 53주.
export const isoWeekStart = (year, week) => shiftDays(weekOf(`${year}-01-04`).from, (week - 1) * 7);
export function isoWeekOf(day) {
  const from = weekOf(day).from, year = Number(shiftDays(from, 3).slice(0, 4));
  return {year, week: Math.round((Date.parse(`${from}T00:00:00Z`) - Date.parse(`${isoWeekStart(year, 1)}T00:00:00Z`)) / (7 * 864e5)) + 1, from};
}
export const isoWeeksIn = year => isoWeekOf(`${year}-12-28`).week;
const twoDay = day => `${day.slice(5, 7)}.${day.slice(8, 10)}`;
// 고르기 줄 이름 'n주차 (MM.DD~MM.DD)'.
export const isoWeekLabel = (year, week) => { const from = isoWeekStart(year, week); return `${week}주차 (${twoDay(from)}~${twoDay(shiftDays(from, 6))})`; };

// [사업요약표 미리보기]의 표 재료. placeRecords(journal-weekly.js, 주간보고 ②와 같은 줄 세우기)가 받는 기록 모양으로 바꾼다.
// lineOf(meeting) = 보고 한 줄(주간보고 meetingLine). requests 자리에 '다음 할 일' 줄을 실어 표의 '이후 계획' 칸이 읽는다.
export function previewRecords(meetings, {from, to, lineOf = m => String(m?.series_name || m?.title || '')}) {
  const list = (meetings || []).filter(m => inPeriod(m, from, to));
  const tagged = [], untagged = [];
  for (const m of list) if (areaIdOf(m)) tagged.push(m); else if (!isAreaNone(m)) untagged.push(m);
  const records = tagged.map(m => ({id:areaIdOf(m), name:'', day:seoulKey(m.meeting_at), at:m.meeting_at, text:isOneline(m) ? onelineLine(m) : lineOf(m), requests:nextPlanLines(m.next_plan), meeting:String(m.id), ...(isOneline(m) ? {oneline:true, first:true} : {})}));
  return {records, untagged, all:list.filter(m => !isOneline(m)).sort((a, b) => Date.parse(a.meeting_at) - Date.parse(b.meeting_at))};
}

// 주간보고 ② 한 줄 글: "보고 한 줄 → 이후: 다음 할 일 / 다음 할 일"(진행 상황 및 이후 계획 한 칸에 들어가는 글).
export const weeklyReportText = (line, meeting) => { const plan = nextPlanLines(meeting?.next_plan); return plan.length ? `${line} → 이후: ${plan.join(' / ')}` : line; };
// 주간보고 ② 재료: 그 날의 꼬리표 단 사업 보고 → projectRecordsOn 과 같은 모양 [{id, name, at, text, requests}].
// 한 줄 업데이트는 문장 그대로(칸 글자·시각 없이) + 다음 할 일, 같은 칸 맨 앞(first).
export const weeklyAreaRecords = (meetings, day, lineOf) => (meetings || []).filter(m => areaIdOf(m) && seoulKey(m.meeting_at) === day)
  .map(m => isOneline(m)
    ? {id:areaIdOf(m), name:'', at:m.meeting_at, text:weeklyReportText(onelineLine(m), m), requests:[], oneline:true, first:true}
    : {id:areaIdOf(m), name:'', at:m.meeting_at, text:weeklyReportText(lineOf(m), m), requests:[]});

// WEEKLY-요약표수기(S49-39): 사업요약표 미리보기 표는 보고가 없는 사업영역·세부 과제 줄도 보여 직접 쓸 수 있게 한다.
// placed = placeRecords 의 areas([{id, name, rows:[{task, items,…}]}]), tree = 사업 목록 트리([{project, depth}]).
// 트리 차례대로 모든 사업영역(1단)과 그 세부 과제(2단) 줄을 둔다(보고 있는 줄은 그대로 유지). 세부 과제가 하나도 없는 사업영역은 세부 과제 없는 줄 하나.
// 트리에 없는 사업영역(placed 에만 있는 것)은 뒤에 그대로. 트리를 못 읽었으면(null) placed 그대로.
export function fullTable(placed, tree) {
  if (!Array.isArray(tree)) return placed || [];
  const byId = new Map((placed || []).map(a => [String(a.id), a])), used = new Set(), out = [], order = new Map();
  let area = null, rank = 0;
  const nameOf = project => String(project?.name || '').trim() || '이름 없는 사업영역';
  for (const {project, depth} of tree) {
    if (depth === 0) {
      const got = byId.get(String(project.id)); used.add(String(project.id));
      area = {...(got || {}), id:project.id, name:nameOf(project), rows:got ? got.rows.map(r => ({...r})) : []};
      out.push(area); order.set(area, new Map()); rank = 0;
    } else if (area && depth === 1) {
      order.get(area).set(String(project.id), ++rank);
      if (!area.rows.some(r => String(r.task?.id ?? '') === String(project.id))) area.rows.push({task:{id:project.id, name:nameOf(project)}, items:[], folded:[], dropped:[]});
    }
  }
  for (const a of out) {
    const rankOf = r => (r.task ? order.get(a).get(String(r.task.id)) ?? 1e6 : 0);
    a.rows.sort((x, y) => rankOf(x) - rankOf(y));
    if (!a.rows.length) a.rows.push({task:null, items:[], folded:[], dropped:[]});
  }
  return [...out, ...(placed || []).filter(a => !used.has(String(a.id)))];
}

// 사업 보고 화면 사업영역 칩: 트리 줄([{project, depth}]) → Map(id → 1단 사업영역 id).
export function areaRoots(tree) {
  const roots = new Map(), trail = [];
  for (const {project, depth} of tree || []) { trail.length = Math.min(trail.length, depth); trail[depth] = String(project?.id); roots.set(String(project?.id), trail[0] ?? String(project?.id)); }
  return roots;
}
// 고르기 목록: [전체] + 보고가 있는 1단 사업영역(트리 순서) + [사업영역 없음 n]([없음]을 고른 보고 한 묶음). 보고는 화면 꼬리표(shownArea) 기준.
// S52-22 TEAM-맨위한줄: 사업영역을 아직 안 단 보고는 고르기 목록에 없고, 목록 위 '사업영역 안 단 보고 n건 · 달기' 줄(untaggedInWeek)이 맡는다.
export function areaChipOptions(meetings, tree) {
  const roots = areaRoots(tree), count = new Map(); let chosenNone = 0;
  for (const m of meetings || []) { const shown = shownArea(m), id = shown.id; if (!id) { if (shown.none) chosenNone++; continue; } const root = roots.get(id); if (root) count.set(root, (count.get(root) || 0) + 1); }
  const areas = (tree || []).filter(x => x.depth === 0 && count.has(String(x.project.id))).map(x => ({value:String(x.project.id), label:String(x.project.name || '이름 없는 사업영역')}));
  return [{value:'all', label:'전체'}, ...areas, ...(chosenNone ? [{value:AREA_NONE, label:`사업영역 없음 ${chosenNone}`}] : [])];
}
export function matchesAreaChip(meeting, chip, roots) {
  if (!chip || chip === 'all') return true;
  const shown = shownArea(meeting), id = shown.id;
  if (chip === AREA_NONE) return !!shown.none;
  return !!id && roots.get(id) === chip;
}

// MTG-프로젝트합치기 3단계(요청 10/28 19:07 ③): 사업 보고 목록은 주 단위(‹ › 로 주 넘기기). 서울 월~일.
// BIZ-주간표이번주(11/09): 보이는 주는 늘 이번 주(오늘이 든 월~일)부터 — 이번 주 보고가 0건이어도 이번 주(옛 '가장 최근 보고가 있는 주로' 규칙은 없앰).
// ‹ ›로 고른 주(picked)는 고를 때의 이번 주(pickedIn)가 지나기 전까지만 쓴다. 새 주가 되면(월요일) 다시 이번 주.
export const reportDay = meeting => seoulKey(meeting?.meeting_at);
export function shownReportWeek(picked, pickedIn, today) {
  const now = weekOf(today).from;
  return picked && pickedIn === now ? picked : now;
}
// from(월요일) 주에 든 보고 + 일시가 없는 보고(어느 주에도 들지 않아 빠지지 않게 모든 주 맨 아래에 함께 보인다). from이 비면(전체) 그대로.
export const inReportWeek = (list, from) => !from ? (list || []) : (list || []).filter(m => !reportDay(m) || inPeriod(m, from, shiftDays(from, 6)));
// 일시가 없는 보고 수(주 줄의 '일시 없음 n').
export const undatedCount = list => (list || []).filter(m => !reportDay(m)).length;
const shortDay = day => `${Number(day.slice(5, 7))}.${Number(day.slice(8, 10))}`;
export const reportWeekLabel = from => `${shortDay(from)}(월)~${shortDay(shiftDays(from, 6))}(일)`;

// MTG-프로젝트합치기 ③(10/29 시안 승인): 사업 보고 목록의 '사업영역 안 단 보고 n건 [달기]' 줄 재료.
// 보고 있는 주(from = 월요일 'YYYY-MM-DD') 안의 일시가 있는 보고 중 사업영역(business_area_id)을 직접 달지 않은 것. 한 줄 업데이트는 늘 사업영역이 있어 뺀다.
// [없음]을 직접 고른 보고(isAreaNone)도 정리된 것이라 뺀다(MTG-사업영역없음).
// 칸이 없는 옛 서버의 줄(business_area_id 키가 없음)은 세지 않는다(그때는 줄 자체가 없다). 날짜 오래된 것부터.
// BIZ-사업영역기억(11/10): 같은 회의명에서 이미 정한 값(사업영역·[없음])이 붙을 보고(rememberedArea)도 묻지 않는다 — 처음 보는 이름만 남는다.
export const untaggedInWeek = (meetings, from) => {
  if (!from) return [];
  const memory = areaMemory(meetings);
  return (meetings || [])
    .filter(m => m && Object.hasOwn(m, 'business_area_id') && !areaIdOf(m) && !isAreaNone(m) && !isOneline(m) && reportDay(m) && inPeriod(m, from, shiftDays(from, 6)) && !rememberedArea(m, memory))
    .sort((a, b) => (Date.parse(a.meeting_at) || 0) - (Date.parse(b.meeting_at) || 0));
};

// BIZ-사업영역기억(요청함 11/10 11:20 → 11:22 'ㅇ'): 같은 회의명은 한 번 정하면 다시 묻지 않는다.
// - 회의명 열쇠 = 띄어쓰기 빼고 소문자(app/team.js meetingNameKey, journal-meeting-kinds.js meetingKindKey와 같은 규칙).
// - 기억 = 그 이름 보고 중 사업영역 또는 [없음]을 가장 나중에 고른(저장한, updated_at) 보고의 값. 따로 저장 칸·설정 화면·기기 저장 없음 —
//   이미 서버에 있는 지난 보고 값을 읽어 쓴다. 바꾸려면 그 회의 아무 보고에서 사업영역을 바꾸면 다음부터 그 값.
// - 붙는 보고 = 같은 이름, 칸이 있는 서버 줄, 아직 사업영역도 [없음]도 없고 한 줄 업데이트가 아닌 것 중 '새 보고'
//   (회의 일시가 기억한 보고와 같거나 뒤, 또는 기억한 값을 고른 뒤에 만든 보고). 그보다 옛 보고는 손대지 않는다(옛 기록 일괄 변경 없음).
//   [없음]은 [없음] 칸이 있는 서버 줄(hasAreaNone)에만 붙인다.
export const areaNameKey = meeting => String(meeting?.series_name || meeting?.title || '').replace(/\s+/g, '').toLowerCase();
const timeOf = v => Date.parse(v || '') || 0;
const choseAt = m => timeOf(m?.updated_at) || timeOf(m?.created_at) || timeOf(m?.meeting_at);
export function areaMemory(meetings) {
  const memory = new Map();
  for (const m of meetings || []) {
    if (!m || isOneline(m) || !Object.hasOwn(m, 'business_area_id')) continue;
    const value = areaIdOf(m) || (isAreaNone(m) ? AREA_NONE : '');
    const key = areaNameKey(m);
    if (!value || !key) continue;
    const at = choseAt(m), had = memory.get(key);
    if (!had || at > had.at) memory.set(key, {value, at, meetingAt:timeOf(m.meeting_at), id:String(m.id ?? '')});
  }
  return memory;
}
// 이 보고에 붙일 기억한 값(사업영역 id | AREA_NONE), 없으면 ''.
export function rememberedArea(meeting, memory) {
  const m = meeting;
  if (!m || isOneline(m) || !Object.hasOwn(m, 'business_area_id') || areaIdOf(m) || isAreaNone(m)) return '';
  const had = memory?.get?.(areaNameKey(m));
  if (!had || had.id === String(m.id ?? '')) return '';
  if (had.value === AREA_NONE && !hasAreaNone(m)) return '';
  const fresh = timeOf(m.meeting_at) >= had.meetingAt || timeOf(m.created_at) >= had.at;
  return fresh ? had.value : '';
}
// 기억한 값을 붙여 저장할 보고 목록 [{meeting, value}].
export const rememberedAreaRows = meetings => {
  const memory = areaMemory(meetings);
  return (meetings || []).map(meeting => ({meeting, value:rememberedArea(meeting, memory)})).filter(x => x.value);
};
// [달기] 창에서 미리 골라 둘 사업영역: 옛 보고는 첫 연결 사업영역(화면에서 빌려 보이던 것, 'link'), 없으면 AI 추천 첫째('ai'), 없으면 고르기('').
export function presetArea(meeting, aiId = '', known = () => true) {
  const old = String(meeting?.project_id || '');
  if (old && known(old)) return {id:old, from:'link'};
  const ai = String(aiId || '');
  if (ai && known(ai)) return {id:ai, from:'ai'};
  return {id:'', from:''};
}

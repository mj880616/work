// MTG-프로젝트합치기 2단계(docs/design/project-into-report.md): 사업 보고의 사업영역 꼬리표·다음 할 일 — 화면이 쓰는 순수 함수 한 곳.
// 꼬리표 = app_meetings.business_area_id(보고 하나에 하나, 명진 결정 ①). 사업영역 = 지금 프로젝트 표(app_spaces) 트리 그대로.
// 옛 보고(꼬리표 빈 것)는 첫 연결 프로젝트(project_id)를 화면에서만 꼬리표처럼 보여 준다(결정 ②, 저장하지 않음).
// 주간보고 ② 사업 요약 표의 재료는 '직접 단 꼬리표'만 쓴다 — 옛 주의 보고서가 달라지지 않게(설계 4절 2단계).

export const NEXT_PLAN_MAX = 1000; // DB 검사 app_meetings_next_plan_check 와 같은 한도

// 직접 단 꼬리표(없으면 '').
export const areaIdOf = meeting => String(meeting?.business_area_id || '');
// 화면에 보이는 꼬리표: 직접 단 것, 없으면 첫 연결 프로젝트. legacy=true 면 화면에서만 빌려 보인 것.
export function shownArea(meeting) {
  const own = areaIdOf(meeting);
  if (own) return {id:own, legacy:false};
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

// [사업요약표 미리보기]의 표 재료. placeRecords(journal-weekly.js, 주간보고 ②와 같은 줄 세우기)가 받는 기록 모양으로 바꾼다.
// lineOf(meeting) = 보고 한 줄(주간보고 meetingLine). requests 자리에 '다음 할 일' 줄을 실어 표의 '이후 계획' 칸이 읽는다.
export function previewRecords(meetings, {from, to, lineOf = m => String(m?.series_name || m?.title || '')}) {
  const list = (meetings || []).filter(m => inPeriod(m, from, to));
  const tagged = [], untagged = [];
  for (const m of list) (areaIdOf(m) ? tagged : untagged).push(m);
  const records = tagged.map(m => ({id:areaIdOf(m), name:'', day:seoulKey(m.meeting_at), at:m.meeting_at, text:lineOf(m), requests:nextPlanLines(m.next_plan), meeting:String(m.id)}));
  return {records, untagged, all:list.slice().sort((a, b) => Date.parse(a.meeting_at) - Date.parse(b.meeting_at))};
}

// 주간보고 ② 한 줄 글: "보고 한 줄 → 이후: 다음 할 일 / 다음 할 일"(진행 상황 및 이후 계획 한 칸에 들어가는 글).
export const weeklyReportText = (line, meeting) => { const plan = nextPlanLines(meeting?.next_plan); return plan.length ? `${line} → 이후: ${plan.join(' / ')}` : line; };
// 주간보고 ② 재료: 그 날의 꼬리표 단 사업 보고 → projectRecordsOn 과 같은 모양 [{id, name, at, text, requests}].
export const weeklyAreaRecords = (meetings, day, lineOf) => (meetings || []).filter(m => areaIdOf(m) && seoulKey(m.meeting_at) === day)
  .map(m => ({id:areaIdOf(m), name:'', at:m.meeting_at, text:weeklyReportText(lineOf(m), m), requests:[]}));

// MTG-프로젝트합치기 사업영역 AI(설계 12·13절): 그 주 임시저장의 사업영역 한 줄(summaries = {id: {text, edited}})이 있으면
// 그 사업영역(꼬리표)의 보고 줄들 대신 한 줄 하나로 — '진행' = 한 줄, '이후 계획' = 그 보고들의 다음 할 일(겹치지 않게).
// 한 줄이 없는 사업영역은 지금처럼 보고마다 한 줄. records 는 weeklyAreaRecords 를 날마다 모은 것({...r, day}), meetings 는 같은 재료.
export function summarizeAreaRecords(records, meetings, summaries) {
  const lines = summaries && typeof summaries === 'object' ? summaries : {};
  if (!Object.keys(lines).length) return records;
  const out = [], done = new Set();
  for (const r of records) {
    const line = lines[String(r.id).toLowerCase()];
    if (!line?.text) { out.push(r); continue; }
    if (done.has(r.id)) continue;
    done.add(r.id);
    const days = new Set(records.filter(x => x.id === r.id).map(x => x.day));
    const plans = [...new Set((meetings || []).filter(m => areaIdOf(m) === r.id && days.has(seoulKey(m.meeting_at))).flatMap(m => nextPlanLines(m.next_plan)))];
    out.push({...r, text:plans.length ? `${line.text} → 이후: ${plans.join(' / ')}` : line.text, requests:[], summarized:true});
  }
  return out;
}

// 사업 보고 화면 사업영역 칩: 트리 줄([{project, depth}]) → Map(id → 1단 사업영역 id).
export function areaRoots(tree) {
  const roots = new Map(), trail = [];
  for (const {project, depth} of tree || []) { trail.length = Math.min(trail.length, depth); trail[depth] = String(project?.id); roots.set(String(project?.id), trail[0] ?? String(project?.id)); }
  return roots;
}
export const NO_AREA = '__none__';
// 칩 목록: [전체] + 보고가 있는 1단 사업영역(트리 순서) + [꼬리표 없음 n]. 보고는 화면 꼬리표(shownArea) 기준.
export function areaChipOptions(meetings, tree) {
  const roots = areaRoots(tree), count = new Map(); let none = 0;
  for (const m of meetings || []) { const id = shownArea(m).id; if (!id) { none++; continue; } const root = roots.get(id); if (root) count.set(root, (count.get(root) || 0) + 1); }
  const areas = (tree || []).filter(x => x.depth === 0 && count.has(String(x.project.id))).map(x => ({value:String(x.project.id), label:String(x.project.name || '이름 없는 사업영역')}));
  return [{value:'all', label:'전체'}, ...areas, ...(none ? [{value:NO_AREA, label:`꼬리표 없음 ${none}`}] : [])];
}
export function matchesAreaChip(meeting, chip, roots) {
  if (!chip || chip === 'all') return true;
  const id = shownArea(meeting).id;
  return chip === NO_AREA ? !id : !!id && roots.get(id) === chip;
}

// MTG-프로젝트합치기 3단계(요청 10/28 19:07 ③): 사업 보고 목록은 주 단위(‹ › 로 주 넘기기). 서울 월~일.
// 처음 보이는 주: 이번 주에 보고가 있으면 이번 주, 없으면 오늘까지 중 가장 최근 보고의 주, 그것도 없으면 가장 최근 보고의 주, 보고가 없으면 이번 주.
export const reportDay = meeting => seoulKey(meeting?.meeting_at);
export function defaultReportWeek(meetings, today) {
  const days = (meetings || []).map(reportDay).filter(Boolean).sort();
  const now = weekOf(today);
  if (days.some(d => d >= now.from && d <= now.to)) return now.from;
  const past = days.filter(d => d <= today);
  const pick = past.at(-1) || days.at(-1);
  return pick ? weekOf(pick).from : now.from;
}
// from(월요일) 주에 든 보고만. from이 비면(전체) 그대로.
export const inReportWeek = (list, from) => !from ? (list || []) : (list || []).filter(m => inPeriod(m, from, shiftDays(from, 6)));
const shortDay = day => `${Number(day.slice(5, 7))}.${Number(day.slice(8, 10))}`;
export const reportWeekLabel = from => `${shortDay(from)}(월)~${shortDay(shiftDays(from, 6))}(일)`;

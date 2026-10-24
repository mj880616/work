// ORG-쟁의단계: 쟁의 단계 판정의 유일한 정의(DOM·네트워크 없음). docs/design/org-dispute-stage.md.
// 담당조직 화면(목록 꼬리표·상세 줄)·쟁의 단계 관리·주간보고 투쟁 사업장 표가 모두 이 모듈 하나로 판정한다.
// 판정은 단계 이름이 아니라 단계 표시(투쟁 중으로 봄·끝남·기본 단계)로 한다. 이름은 명진이 바꿀 수 있는 글자일 뿐이다.
export const STAGE_NAME_LIMIT = 20;

// 기본 단계 11개(명진 결정 2026-10-24 07:35). 기본 단계 줄을 가장 먼저 넣는다(지우기 함수가 기본 단계를 찾기 때문).
// 투쟁 중으로 봄: 쟁의발생 결의 ~ 임단협 찬반투표(7개). 끝남: 협약체결·종료. 교섭 시작 전·교섭 중은 표에 안 나옴.
export const DEFAULT_STAGES = Object.freeze([
  {name: '교섭 시작 전', is_struggle: false, is_ending: false, is_default: true},
  {name: '교섭 중', is_struggle: false, is_ending: false, is_default: false},
  {name: '쟁의발생 결의', is_struggle: true, is_ending: false, is_default: false},
  {name: '조정 신청', is_struggle: true, is_ending: false, is_default: false},
  {name: '조정 종료', is_struggle: true, is_ending: false, is_default: false},
  {name: '파업 찬반투표', is_struggle: true, is_ending: false, is_default: false},
  {name: '쟁의중', is_struggle: true, is_ending: false, is_default: false},
  {name: '잠정합의', is_struggle: true, is_ending: false, is_default: false},
  {name: '임단협 찬반투표', is_struggle: true, is_ending: false, is_default: false},
  {name: '협약체결', is_struggle: false, is_ending: true, is_default: false},
  {name: '종료', is_struggle: false, is_ending: true, is_default: false},
].map(row => Object.freeze(row)));

// 처음 열 때 채울 줄(기본 단계가 맨 앞). 순서 값은 1부터.
export const seedRows = workspaceId => DEFAULT_STAGES.map((row, index) => ({workspace_id: workspaceId, ...row, sort_order: index + 1}));

const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) && !Number.isNaN(Date.parse(value + 'T00:00:00Z'));
export const isIsoDate = isDate;

export const sortStages = stages => [...(stages ?? [])].sort((a, b) =>
  (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || String(a.id).localeCompare(String(b.id)));
export const defaultStage = stages => (stages ?? []).find(s => s.is_default) ?? null;

// 단계 이름 검사: 비어 있음·20자 초과·같은 이름(exceptId 제외). 문제 없으면 ''.
export function stageNameProblem(name, stages, exceptId = null) {
  const text = String(name ?? '').trim();
  if (!text) return '단계 이름을 적어 주세요.';
  if ([...text].length > STAGE_NAME_LIMIT) return `단계 이름은 ${STAGE_NAME_LIMIT}자까지예요.`;
  if ((stages ?? []).some(s => s.id !== exceptId && String(s.name).trim() === text)) return '같은 이름의 단계가 이미 있어요.';
  return '';
}

// 이력 줄 정렬 기준: 단계 날짜 → 입력 시각 → id (DB 함수·좁히기 정책과 같은 순서, 가장 나중이 현재).
const newer = (a, b) => String(b.stage_date).localeCompare(String(a.stage_date)) || String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')) || String(b.id ?? '').localeCompare(String(a.id ?? ''));
export const sortHistory = rows => [...(rows ?? [])].sort(newer);
export const latestRow = rows => (rows?.length ? sortHistory(rows)[0] : null);

// 한 조직의 현재 단계. histories: 조직 id → 이력 줄들. 반환 {row, stage, name, date, kind}
// kind: 'struggle'(투쟁 중으로 봄) | 'ended'(끝남) | 'quiet'(그 밖: 교섭 시작 전·교섭 중·이력만 남은 지워진 단계).
// 이력이 없으면 기본 단계(교섭 시작 전)로 읽는다. 단계가 지워져 id가 빈 줄은 투쟁 중도 끝남도 아니다.
// until(선택, 'YYYY-MM-DD'): 그 날까지의 이력만 본다(지난 주 보고 때 그 주 끝 단계).
export function stageOfOrg(orgId, histories, stages, {until = ''} = {}) {
  const all = histories instanceof Map ? histories.get(orgId) : histories?.[orgId];
  const rows = until ? (all ?? []).filter(r => String(r.stage_date) <= until) : all;
  const row = latestRow(rows);
  const byId = new Map((stages ?? []).map(s => [s.id, s]));
  if (!row) {
    const base = defaultStage(stages);
    return {row: null, stage: base, name: base?.name ?? '', date: '', kind: 'quiet'};
  }
  const stage = row.stage_id ? byId.get(row.stage_id) ?? null : null;
  const kind = !stage ? 'quiet' : stage.is_struggle ? 'struggle' : stage.is_ending ? 'ended' : 'quiet';
  return {row, stage, name: stage?.name ?? row.stage_name, date: row.stage_date, kind};
}

// 'YYYY-MM-DD' → 'M.D'
export function monthDay(date) {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(date ?? ''));
  return m ? `${Number(m[1])}.${Number(m[2])}` : '';
}
// 단계(날짜) 모양: 쟁의발생 결의(10.20)
export const stageLabel = cur => cur?.name ? (cur.date ? `${cur.name}(${monthDay(cur.date)})` : cur.name) : '';

const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
// 그 날이 든 주(월~일). 한국 날짜 문자열 기준.
export function weekOf(date) {
  const day = new Date(Date.parse(date + 'T00:00:00Z')).getUTCDay();
  const monday = addDays(date, -((day + 6) % 7));
  return {start: monday, end: addDays(monday, 6)};
}
export const inWeek = (date, week) => isDate(date) && !!week && date >= week.start && date <= week.end;

// 현재 단계가 지금 표에 나가야 하는지. week = {start,end}: 보고 주간.
//   투쟁 중 → 'struggle'(매주), 끝남 + 단계 날짜가 그 주 안 → 'ended'(그 주 한 번), 그 밖 → ''.
export function reportKind(cur, week) {
  if (cur?.kind === 'struggle') return 'struggle';
  if (cur?.kind === 'ended' && inWeek(cur.date, week)) return 'ended';
  return '';
}

// 목록 꼬리표: 투쟁 중 + 이번 주 끝남만. 평시 조직은 null.
export function listTag(cur, today) {
  const kind = reportKind(cur, weekOf(today));
  return kind ? {kind, text: cur.name} : null;
}

// 관리 화면 순서 바꾸기: ids(보이는 순서)에서 id를 index 자리로 옮긴 새 순서 값 [{id, sort_order}] 중 바뀐 것만.
export function reorderChanges(stages, id, toIndex) {
  const list = sortStages(stages);
  const from = list.findIndex(s => s.id === id);
  if (from < 0) return [];
  const [moved] = list.splice(from, 1);
  list.splice(Math.max(0, Math.min(list.length, toIndex)), 0, moved);
  return list.map((s, i) => ({id: s.id, sort_order: i + 1})).filter(change => change.sort_order !== stages.find(s => s.id === change.id)?.sort_order);
}

// 이력 목록(접힘 안): 최근 것부터 {date:'10.20', name}
export const historyLines = (rows, limit = 20) => sortHistory(rows).slice(0, limit).map(r => ({id: r.id, date: monthDay(r.stage_date), name: r.stage_name}));

// 지우기 알림 글: ○○지부 외 N곳이 이 단계예요
export function orgsAtStageText(names) {
  const list = (names ?? []).filter(Boolean);
  if (!list.length) return '';
  return list.length === 1 ? `${list[0]} 1곳이 이 단계예요.` : `${list[0]} 외 ${list.length - 1}곳이 이 단계예요.`;
}

// ───── 주간보고 투쟁 사업장 표 (ORG-쟁의단계 ②) ─────
// 보고 주간(week = {start,end})에 표에 나갈 조직: 투쟁 중은 매주, 끝남은 끝난 주 한 번. 보고 주간 끝날까지의 이력으로 판정한다.
// orgs: 내 담당 조직 [{id,name,aliases}]. 반환 [{org, kind:'struggle'|'ended', line:'- 쟁의발생 결의(10.20)', name}] (orgs 순서)
export function sitePlan(orgs, histories, stages, week) {
  const out = [];
  for (const org of orgs ?? []) {
    const cur = stageOfOrg(org.id, histories, stages, {until: week.end});
    const kind = reportKind(cur, week);
    if (kind) out.push({org, kind, line: `- ${stageLabel(cur)}`, name: cur.name});
  }
  return out;
}
// 앱이 이전에 채운 단계 줄('- 조정 신청(10.10)')인지: 이번 줄로 바꿀 때 겹쳐 남기지 않는다.
export function isStageLine(text, stages) {
  const m = /^\s*-\s*(.+?)\((\d{1,2}\.\d{1,2})\)\s*$/.exec(String(text ?? ''));
  return !!m && (stages ?? []).some(s => String(s.name).trim() === m[1].trim());
}

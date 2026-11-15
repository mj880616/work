// WEEKLY-내양식자유변형 ②(요청함 11/15 21:38–21:57, 명진 확정; 시안 docs/design/mockups/weekly-own-form.html #2664):
// '내 양식' 모양 하나 — 항목(절) 순서·이름·단계, 표 머리 칸, 칸마다 채울 기록. 서버 표 app_weekly_forms.form 에 그대로 저장한다
// (20261116003000_weekly_own_forms). DB는 큰 틀(판 1·항목 40개·30000바이트)만 막고, 세부 모양은 여기서 맞춘다(모르는 값은 버림).
// 기록 내용(주간 보고 본문 글)은 넣지 않는다 — 양식 글자(항목 이름·표 머리 칸 이름)만.
// 화면·서버 없는 순수 함수(node 시험이 부른다).

export const FORM_VERSION = 1;
export const MAX_SECTIONS = 40;
export const MAX_COLUMNS = 12;
export const TITLE_MAX = 60;
export const COLUMN_MAX = 30;
export const NAME_MAX = 80;
export const FORM_MAX_BYTES = 30000; // 서버 CHECK와 같은 상한

// 칸마다 채울 기록(시안 ② 고르기 목록, 요청 원문 순서). 값은 저장용 열쇠, 글은 화면 글.
export const FILLS = Object.freeze(['biz', 'org', 'schedule', 'todo', 'meeting', 'last_week', 'blank']);
export const FILL_LABEL = Object.freeze({biz: '사업 보고', org: '조직 보고', schedule: '일정', todo: '할 일', meeting: '회의', last_week: '지난주 글 그대로', blank: '빈칸'});

const oneLine = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();

// 항목 이름으로 처음 고를 기록을 규칙으로 맞춘다(AI 없음 — 사람이 ③ 화면에서 확인·고침). 맞는 말이 없으면 빈칸.
const GUESS = [
  ['schedule', /일정|계획표|스케줄/],
  ['meeting', /회의|간담회|협의회/],
  ['todo', /할\s*일|과제|요청|건의/],
  ['org', /조직|지회|지부|분회|산하|동향|현황/],
  ['biz', /사업|활동|추진|실적|업무/],
];
export function guessFill(title, columns = []) {
  const text = `${title ?? ''} ${(columns ?? []).join(' ')}`;
  for (const [fill, re] of GUESS) if (re.test(text)) return fill;
  return 'blank';
}

// 항목 하나 맞추기. 이름이 비면 버림(null).
export function cleanSection(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const title = oneLine(raw.title, TITLE_MAX);
  if (!title) return null;
  const columns = (Array.isArray(raw.columns) ? raw.columns : []).map(c => oneLine(c, COLUMN_MAX)).filter(Boolean).slice(0, MAX_COLUMNS);
  const id = /^[a-z0-9_-]{1,20}$/i.test(String(raw.id ?? '')) ? String(raw.id) : `s${index + 1}`;
  const level = raw.level === 2 ? 2 : 1;
  const fill = FILLS.includes(raw.fill) ? raw.fill : 'blank';
  const out = {id, title, level, columns, fill};
  if (raw.ai === true) out.ai = true;
  return out;
}

// 양식 통째 맞추기: {v:1, sections:[…]}. id가 겹치면 뒤의 것에 새 id.
export function cleanForm(raw) {
  const list = Array.isArray(raw?.sections) ? raw.sections : [];
  const seen = new Set(), sections = [];
  for (const [i, s] of list.entries()) {
    const one = cleanSection(s, i);
    if (!one) continue;
    let id = one.id, n = sections.length + 1;
    while (seen.has(id)) id = `s${n++}`;
    seen.add(id); one.id = id;
    sections.push(one);
    if (sections.length >= MAX_SECTIONS) break;
  }
  return {v: FORM_VERSION, sections};
}

export const formBytes = form => new TextEncoder().encode(JSON.stringify(form)).length;
export const formName = (name, fallback = '내 주간 보고 양식') => oneLine(String(name ?? '').replace(/\.(hwpx?|HWPX?)$/, ''), NAME_MAX) || fallback;

// 읽은 결과 한 줄(화면 글): "항목 4개와 표 2개를 읽었어요."
export function readSummary(form) {
  const n = form?.sections?.length ?? 0, t = (form?.sections ?? []).filter(s => s.columns.length).length;
  if (!n) return '';
  return t ? `항목 ${n}개와 표 ${t}개를 읽었어요.` : `항목 ${n}개를 읽었어요.`;
}

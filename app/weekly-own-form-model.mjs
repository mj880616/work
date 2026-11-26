// WEEKLY-내양식자유변형 ②(요청함 11/15 21:38–21:57, 사용자 확정; 시안 docs/design/mockups/weekly-own-form.html #2664):
// '내 양식' 모양 하나 — 항목(절) 순서·이름·단계, 표 머리 칸, 칸마다 채울 기록. 서버 표 app_weekly_forms.form 에 그대로 저장한다
// (20261116003000_weekly_own_forms). DB는 큰 틀(판 1·항목 40개·30000바이트)만 막고, 세부 모양은 여기서 맞춘다(모르는 값은 버림).
// 기록 내용(주간 보고 본문 글)은 넣지 않는다 — 양식 글자(항목 이름·표 머리 칸 이름)만.
// 화면·서버 없는 순수 함수(node 시험이 부른다).

import {word} from './brand/brand.mjs';
export const FORM_VERSION = 1;
export const MAX_SECTIONS = 40;
export const MAX_COLUMNS = 12;
export const TITLE_MAX = 60;
export const COLUMN_MAX = 30;
export const NAME_MAX = 80;
export const FORM_MAX_BYTES = 30000; // 서버 CHECK와 같은 상한

// 칸마다 채울 기록(시안 ② 고르기 목록, 요청 원문 순서). 값은 저장용 열쇠, 글은 화면 글.
export const FILLS = Object.freeze(['biz', 'org', 'schedule', 'todo', 'meeting', 'last_week', 'blank']);
export const FILL_LABEL = Object.freeze({biz: word('사업 보고'), org: word('조직 보고'), schedule: '일정', todo: '할 일', meeting: '회의', last_week: '지난주 글 그대로', blank: '빈칸'});

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
  // ⑤-1: 한글 파일 엔진 자리(weekly-hwpx/form-profile.mjs ROLES — 요청 표·요약 표처럼 채우는 방법). 글자가 아니라 열쇠라 모양만 본다.
  if (typeof raw.role === 'string' && /^[A-Za-z]{1,20}$/.test(raw.role)) out.role = raw.role;
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

// ---- ③ 양식 확인·짝짓기 화면의 고치기(새 양식을 돌려줌, 원래 것은 그대로) ----
const at = (form, id) => form.sections.findIndex(s => s.id === id);
const withSections = (form, sections) => cleanForm({sections});
const nextId = form => { let n = form.sections.length + 1; const ids = new Set(form.sections.map(s => s.id)); while (ids.has(`s${n}`)) n++; return `s${n}`; };
// from 자리의 항목을 to 자리로(끌어 옮기기·위로·아래로).
export function moveSection(form, id, to) {
  const from = at(form, id);
  if (from < 0) return form;
  const list = [...form.sections], [one] = list.splice(from, 1);
  list.splice(Math.max(0, Math.min(list.length, to)), 0, one);
  return withSections(form, list);
}
export const renameSection = (form, id, title) => (oneLine(title, TITLE_MAX) ? withSections(form, form.sections.map(s => (s.id === id ? {...s, title, ai: false} : s))) : form);
export const removeSection = (form, id) => withSections(form, form.sections.filter(s => s.id !== id));
export const setFill = (form, id, fill) => (FILLS.includes(fill) ? withSections(form, form.sections.map(s => (s.id === id ? {...s, fill, ai: false} : s))) : form);
export function addSection(form, title = '새 항목') {
  if (form.sections.length >= MAX_SECTIONS) return form;
  return withSections(form, [...form.sections, {id: nextId(form), title, level: 1, columns: [], fill: 'blank'}]);
}
export function addColumn(form, id, name) {
  return withSections(form, form.sections.map(s => {
    if (s.id !== id || s.columns.length >= MAX_COLUMNS) return s;
    return {...s, columns: [...s.columns, oneLine(name, COLUMN_MAX) || `칸 ${s.columns.length + 1}`]};
  }));
}
// 칸 이름 바꾸기. 빈 이름이면 그 칸 빼기.
export const renameColumn = (form, id, index, name) => withSections(form, form.sections.map(s => {
  if (s.id !== id || index < 0 || index >= s.columns.length) return s;
  const text = oneLine(name, COLUMN_MAX), columns = [...s.columns];
  if (text) columns[index] = text; else columns.splice(index, 1);
  return {...s, columns};
}));
export const removeColumn = (form, id, index) => renameColumn(form, id, index, '');
export const sameForm = (a, b) => JSON.stringify(cleanForm(a)) === JSON.stringify(cleanForm(b));

// ---- WEEKLY-처음시작고르기(시안 docs/design/mockups/weekly-start-choice.html ★A안, 사용자 11/17 "ㅇ"): 처음 여는 사람의 번호 4개 ----
// 바탕(자료실 확정본)도 '내 양식'도 없는 사람의 첫 화면. 번호를 누르면 바로 저장하지 않고 [양식 수정] 화면(weekly-own-form-edit.js)을 그 모양으로 연다.
// 채울 기록은 지금 초안 엔진(weekly-own-draft-model.mjs)이 실제로 채우는 것만: 표 칸은 columnKinds 규칙(사업명·조직 → 이름, 날짜 → 날짜, 진행·상황 → 내용,
// 계획 → 빈칸)으로 맞춰진다. 미리보기 글은 모두 지어낸 예시(특정 노조·팀·사람 흔적 없음). filled: 그 주 기록에서 자동으로 채워지는 칸(노란 칸).
// preview: [{title, lines:[{text, filled}]} | {columns, rows:[[{text, filled}]]}] — 글이 비면 '(직접)'.
const pv = text => ({text, filled: true}), pvOwn = Object.freeze({text: '', filled: false});
export const START_CHOICES = Object.freeze([
  {key: 'simple', no: 1, name: '간단형', desc: '지난주 한 일 · 이번 주 할 일',
    form: {v: FORM_VERSION, sections: [
      {id: 's1', title: '지난주 한 일', level: 1, columns: [], fill: 'biz'},
      {id: 's2', title: '이번 주 할 일', level: 1, columns: [], fill: 'blank'},
      {id: 's3', title: '주요 일정', level: 1, columns: [], fill: 'schedule'},
    ]},
    preview: [{title: '1. 지난주 한 일', lines: [pv('- 11/10 새내기 교육 자료 정리'), pv('- 11/12 지역 순회 간담회')]}, {title: '2. 이번 주 할 일', lines: [pvOwn]}, {title: '3. 주요 일정', lines: [pv('- 11/18 운영위원회')]}]},
  {key: 'biz', no: 2, name: '사업별 표', desc: '사업마다 진행 · 계획 칸',
    form: {v: FORM_VERSION, sections: [{id: 's1', title: '사업별 진행', level: 1, columns: ['사업명', '진행', '계획'], fill: 'biz'}]},
    preview: [{columns: ['사업명', '진행', '계획'], rows: [[pv('교육'), pv('1차 교육 마침'), pvOwn], [pv('소식지'), pv('이번 호 초안'), pvOwn]]}]},
  {key: 'org', no: 3, name: word('조직별'), desc: word('맡은 조직마다 상황 한 줄'),
    form: {v: FORM_VERSION, sections: [{id: 's1', title: word('조직별 상황'), level: 1, columns: [word('조직'), '날짜', '상황'], fill: 'org'}]},
    preview: [{columns: [word('조직'), '날짜', '상황'], rows: [[pv(word('가 지회')), pv('11/11'), pv('새 대표 뽑음')], [pv('나 분회'), pv('11/13'), pv('모임 장소 바뀜')]]}]},
  {key: 'own', no: 4, name: '직접 만들기', desc: '빈 양식에서 칸 이름을 내가 정함',
    form: {v: FORM_VERSION, sections: []},
    preview: [{title: '', lines: [{text: '항목 없음', filled: false}, {text: '+ 항목 추가', filled: false}]}]},
]);
export const START_DEFAULT = 'simple';
// 번호 열쇠 → {form, name}. 직접 만들기는 빈 양식 + 기본 이름(지금까지의 [빈 양식에서 만들기]와 같음).
export function startForm(key) {
  const one = START_CHOICES.find(c => c.key === key) ?? START_CHOICES[0];
  return {form: cleanForm(one.form), name: one.key === 'own' ? formName('') : formName(one.name)};
}
// WEEKLY-처음시작여러개(사용자 11/17 16:04 "복수선택 가능해야할 듯"): 1~3은 여러 개, 4 직접 만들기(빈 양식)는 혼자만.
const START_OWN = 'own';
// 고른 열쇠 목록 맞추기: 없는 열쇠·중복 빼고 번호 순서(1→2→3). 4가 다른 것과 섞여 있으면 4를 뺀다(빈 양식은 더할 것이 없음).
export function startPicks(keys) {
  const want = new Set((Array.isArray(keys) ? keys : [keys]).map(String));
  const list = START_CHOICES.filter(c => want.has(c.key)).map(c => c.key);
  return list.length > 1 ? list.filter(k => k !== START_OWN) : list;
}
// 체크 하나 켜기·끄기 → 새 목록. 4를 켜면 1~3이 풀리고, 1~3 중 하나를 켜면 4가 풀린다. 0개도 될 수 있다(그때는 시작 불가).
export function togglePick(picks, key, on) {
  if (!START_CHOICES.some(c => c.key === key)) return startPicks(picks);
  const now = startPicks(picks).filter(k => k !== key);
  if (!on) return now;
  return key === START_OWN ? [START_OWN] : startPicks([...now.filter(k => k !== START_OWN), key]);
}
// 고른 번호들 → {form, name}. 항목을 번호 순서대로 이어 붙이고, 같은 이름 항목은 처음 것 하나만 둔다(id는 cleanForm이 겹치지 않게 맞춤).
// 하나만 골랐으면 startForm과 같다. 0개(또는 없는 열쇠뿐)면 기본 번호.
export function startFormMany(keys) {
  const picks = startPicks(keys);
  if (picks.length <= 1) return startForm(picks[0] ?? START_DEFAULT);
  const names = picks.map(k => START_CHOICES.find(c => c.key === k).name);
  return {form: joinForms(picks.map(k => startForm(k).form)), name: formName(names.join(' · '))};
}
// 양식 여러 개 → 항목을 차례대로 이어 붙인 양식 하나. 같은 이름(앞뒤 빈칸 무시) 항목은 처음 것만, id는 s1부터 다시.
export function joinForms(forms) {
  const seen = new Set(), sections = [];
  for (const form of forms) {
    for (const s of cleanForm(form).sections) {
      const title = s.title.trim();
      if (seen.has(title)) continue;
      seen.add(title); sections.push({...s, id: `s${sections.length + 1}`});
    }
  }
  return cleanForm({sections});
}

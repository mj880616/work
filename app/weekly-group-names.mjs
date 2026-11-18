// WEEKLY-내양식자유변형 ⑤-3d: 주간보고 학습 묶음 이름(칸별 '그대로 쓴 비율'·환류 정리 재료·안 내는 제안 이름)을 '내 양식' 제목에서 만든다.
// 코드에 박힌 양식 제목은 없다. 코드가 아는 것은 칸 열쇠(cell — 'summary:…'·'requests:ask' 같은 저장 열쇠)와 양식 자리(role) 이름뿐이고,
// 글자는 '내 양식'(app_weekly_forms.form 의 항목 제목, 엔진 profile.titles 와 같은 role → 제목)에서 온다.
// 양식이 없거나 그 자리 제목이 비면 번호 없는 일반적인 말(GENERIC)을 쓴다.
// 이 파일은 서버 사본 supabase/functions/_shared/weekly-group-names.mjs 와 바이트까지 같다(tests/weekly-group-names.test.mjs 가 지킴).
// 화면·서버 없는 순수 함수(node 시험이 부른다).

// 묶음 열쇠 — 보고서 칸 순서(1→5, 참고). 'notes'(참고)는 화면 묶음(양식 항목 아님)이라 양식 제목을 쓰지 않는다.
export const GROUP_KEYS = Object.freeze(['requests', 'summary', 'details', 'sites', 'orgs', 'calendar', 'notes']);
// 양식 제목이 없을 때의 일반적인 말(특정 양식 번호·이름 없음).
export const GENERIC = Object.freeze({requests:'요청', summary:'요약', details:'세부 내용', sites:'사업장 현황', orgs:'조직 현황', calendar:'주요 일정', notes:'참고',
  ask:'요청 표', hq:'요청 일정', discuss:'논의 요청'});
// 칸이 아닌 학습 묶음(규칙 후보·개선 제안·기타) — 양식과 상관없는 말.
export const EXTRA_GROUPS = Object.freeze({rule:'새 규칙 후보', suggest:'개선 제안', other:'기타'});
// '내 양식' 자리 이름(app/weekly-hwpx/form-profile.mjs ROLES 가운데 묶음 이름에 쓰는 것).
export const NAME_ROLES = Object.freeze(['requests', 'requestTable', 'schedule', 'discuss', 'work', 'summaryTable', 'details', 'struggle', 'siteTable', 'orgs', 'calendar']);
const TITLE_MAX = 60; // weekly-own-form-model.mjs TITLE_MAX 와 같은 값

const line = s => String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX).trim();
// '3. 투쟁 사업' → '3.' / '2) 투쟁 사업장 현황' → '2)'. 번호가 없으면 ''.
const headNumber = s => /^\s*(\(?\d+[.)])/.exec(line(s))?.[1] ?? '';
// 번호를 뗀 글: '2) 투쟁 사업장 현황' → '투쟁 사업장 현황'.
const headBare = s => line(s).replace(/^\s*\(?\d+[.)]\s*/, '');
const join = (...parts) => parts.map(line).filter(Boolean).join(' ');

// 칸 열쇠 → 묶음 열쇠(GROUP_KEYS) 또는 EXTRA_GROUPS 열쇠.
export function groupKeyOf(cell) {
  const c = String(cell ?? '');
  if (c.startsWith('summary:')) return 'summary';
  if (c === 'details') return 'details';
  if (c.startsWith('orgs:') || c.startsWith('orgref:')) return 'orgs';
  if (c.startsWith('sites:')) return 'sites';
  if (c.startsWith('requests:')) return 'requests';
  if (c === 'calendar') return 'calendar';
  if (c === 'notes' || c.startsWith('notes:')) return 'notes';
  if (c === '규칙 후보') return 'rule';
  if (c === '개선 제안') return 'suggest';
  return 'other';
}

// '내 양식'(app_weekly_forms.form = {sections:[{role, title}…]}) → role → 제목(한 줄, 60자). 자리마다 처음 것. 하나도 없으면 null.
export function titlesOfForm(form) {
  const out = {};
  for (const s of Array.isArray(form?.sections) ? form.sections : []) {
    const role = typeof s?.role === 'string' ? s.role : '';
    if (!NAME_ROLES.includes(role) || out[role]) continue;
    const title = line(s?.title);
    if (title) out[role] = title;
  }
  return Object.keys(out).length ? out : null;
}

// role → 제목(엔진 profile.titles 또는 titlesOfForm) → 묶음 이름. 제목이 없는 자리는 일반적인 말.
//  - 큰 항목(requests·orgs·calendar)은 그 제목 그대로, 작은 항목 묶음(summary·details·sites)은 '큰 항목 번호 + 번호 뗀 작은 항목 제목'.
//  - ask·hq·discuss·detailsAt: 안 내는 제안 이름의 '어느 칸'('큰 항목 번호 + 작은 항목 제목').
export function groupNames(titles) {
  const t = titles && typeof titles === 'object' ? titles : {};
  const has = role => !!line(t[role]);
  const big = role => headNumber(t[role]);
  const under = (parent, role, key) => (has(role) ? join(big(parent), headBare(t[role])) : GENERIC[key]);
  const at = (parent, role, key) => (has(role) ? join(big(parent), t[role]) : GENERIC[key]);
  return Object.freeze({
    requests: has('requests') ? line(t.requests) : GENERIC.requests,
    summary: under('work', 'summaryTable', 'summary'),
    details: under('work', 'details', 'details'),
    sites: under('struggle', 'siteTable', 'sites'),
    orgs: has('orgs') ? line(t.orgs) : GENERIC.orgs,
    calendar: has('calendar') ? line(t.calendar) : GENERIC.calendar,
    notes: GENERIC.notes,
    ask: at('requests', 'requestTable', 'ask'),
    hq: at('requests', 'schedule', 'hq'),
    discuss: at('requests', 'discuss', 'discuss'),
    detailsAt: at('work', 'details', 'details'),
    ...EXTRA_GROUPS,
  });
}

// 칸 열쇠 → 묶음 이름. names = groupNames(…) (없으면 일반적인 말).
export const groupNameOf = (cell, names = groupNames(null)) => names[groupKeyOf(cell)] ?? EXTRA_GROUPS.other;

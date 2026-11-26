// WEEKLY-내양식자유변형 ⑤-1(요청함 11/15 21:56 ⑤ "사용자 양식을 같은 '내 양식'으로 옮기고 코드에 박힌 규칙 걷어내기"):
// 한글 파일 엔진(template.mjs·report.mjs)이 쓰는 양식 글자(항목 제목·표 머리 칸 이름·회의 결과 상자 칸 이름)를
// '내 양식'(app_weekly_forms.form, weekly-own-form-model.mjs) 데이터 하나에서 읽는다.
//  - 엔진이 아는 것은 항목의 '자리'(role — 요청 표·요약 표처럼 채우는 방법)뿐이다. 자리 이름은 코드, 제목·칸 이름 글자는 양식 데이터.
//  - profileOf(form): 자리가 모두 붙은 '내 양식' → 엔진 profile {titles, heads, boxLabels, formLabels}. 자리가 모자라면 null.
//  - ⑤-3(사용자 결정 11/17 '나'): 코드에 박혀 있던 양식(옛 기본값)은 지웠다. 쓸 '내 양식'이 없으면 바탕 파일에서 읽는다
//    (hwpx-form-read.mjs readBaseForm — 자리는 이 파일의 ROLES 차례·표 칸 수로만 붙이고 글자는 파일에 적힌 그대로).
// 화면·서버 없는 순수 함수(node 시험이 부른다). 보고 본문 글은 다루지 않는다.
// 이 파일은 supabase/functions/_shared/weekly-form-profile.mjs 와 바이트까지 같은 사본이다(weekly-lines.mjs 와 같은 방식). 한쪽만 고치지 않는다
//   (tests/security/ledger-weekly.test.mjs 가 지킨다). Edge ai-assist 원장 자동 기록(WEEKLY-개인본대조 W-3)이 '내 양식' → 줄 나누기 profile 을 같은 규칙으로 만든다.

// 엔진 자리(채우는 방법). 순서 = 엔진이 한글 파일에 쓰는 차례.
export const ROLES = Object.freeze(['requests', 'requestTable', 'schedule', 'discuss', 'work', 'summaryTable', 'details',
  'struggle', 'rallyTable', 'siteTable', 'orgs', 'orgTable', 'orgNotes', 'calendar']);
// 표가 있는 자리 → 엔진 견본 열쇠·칸 수(엔진이 칸 순서로 읽고 쓰므로 칸 수는 고정).
export const TABLE_ROLES = Object.freeze({requestTable: ['requestTable', 3], summaryTable: ['summaryTable', 4], rallyTable: ['rallyTable', 3],
  siteTable: ['siteTable', 2], orgTable: ['orgTable', 2], calendar: ['scheduleTable', 3]});
// 큰 항목(1단계) 자리. 나머지는 2단계.
export const BIG_ROLES = Object.freeze(['requests', 'work', 'struggle', 'orgs', 'calendar']);
// 자리 → '채울 기록'(③ 화면 고르기 목록과 같은 열쇠 — weekly-own-form-model.mjs FILLS).
export const ROLE_FILL = Object.freeze({requests: 'blank', requestTable: 'schedule', schedule: 'schedule', discuss: 'todo', work: 'blank', summaryTable: 'biz',
  details: 'meeting', struggle: 'blank', rallyTable: 'org', siteTable: 'org', orgs: 'blank', orgTable: 'org', orgNotes: 'blank', calendar: 'schedule'});

const text = s => String(s ?? '').trim();

// 큰 항목 자리 → 그 아래 작은 항목 자리(ROLES 차례에서 다음 큰 항목 전까지). 바탕 파일에서 양식을 읽을 때 자리를 붙이는 틀.
export const ROLE_GROUPS = Object.freeze(ROLES.reduce((out, role) => {
  if (BIG_ROLES.includes(role)) out.push(Object.freeze({role, children: []}));
  else out[out.length - 1].children.push(role);
  return out;
}, []).map(g => Object.freeze({role: g.role, children: Object.freeze(g.children)})));

// '내 양식' → 엔진 profile. 자리가 겹치거나 모자라거나, 표 자리의 칸 수가 엔진과 다르면 null(엔진이 그 양식으로는 못 만듦).
// allowNoBoxes: 회의 결과 상자 칸 이름이 하나도 없어도 받는다(상자가 없는 주의 바탕 파일에서 읽어 그 자리에서만 쓸 때 — 저장하지 않음).
export function profileOf(form, {allowNoBoxes = false} = {}) {
  const byRole = new Map();
  for (const s of form?.sections ?? []) {
    if (!ROLES.includes(s?.role)) continue;
    if (byRole.has(s.role)) return null;
    byRole.set(s.role, s);
  }
  if (byRole.size !== ROLES.length) return null;
  const titles = {}, heads = {};
  for (const role of ROLES) {
    const s = byRole.get(role), title = text(s.title);
    if (!title) return null;
    titles[role] = title;
    const table = TABLE_ROLES[role];
    if (!table) continue;
    const columns = (s.columns ?? []).map(text);
    if (columns.length !== table[1] || columns.some(c => !c)) return null;
    heads[table[0]] = Object.freeze(columns);
  }
  const boxLabels = (byRole.get('details').columns ?? []).map(text).filter(Boolean);
  if (!boxLabels.length && !allowNoBoxes) return null;
  return Object.freeze({titles: Object.freeze(titles), heads: Object.freeze(heads), boxLabels: Object.freeze(boxLabels),
    formLabels: Object.freeze([...new Set(Object.values(heads).flat())])});
}

// 엔진 함수가 profile 을 꼭 받는다(⑤-3a — 기본값 없음). 빠지면 몰래 다른 양식으로 돌지 않고 멈춘다.
export function needProfile(profile) {
  if (!profile?.titles || !profile?.heads || !Array.isArray(profile?.boxLabels) || !Array.isArray(profile?.formLabels)) throw new Error('엔진 양식(profile)이 없음');
  return profile;
}

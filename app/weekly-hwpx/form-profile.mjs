// WEEKLY-내양식자유변형 ⑤-1(요청함 11/15 21:56 ⑤ "명진 양식을 같은 '내 양식'으로 옮기고 코드에 박힌 규칙 걷어내기"):
// 한글 파일 엔진(template.mjs·report.mjs)이 쓰는 양식 글자(항목 제목·표 머리 칸 이름·회의 결과 상자 칸 이름)를
// '내 양식'(app_weekly_forms.form, weekly-own-form-model.mjs) 데이터 하나에서 읽는다.
//  - 엔진이 아는 것은 항목의 '자리'(role — 요청 표·요약 표처럼 채우는 방법)뿐이다. 자리 이름은 코드, 제목·칸 이름 글자는 양식 데이터.
//  - profileOf(form): 자리가 모두 붙은 '내 양식' → 엔진 profile {titles, heads, boxLabels, formLabels}. 자리가 모자라면 null.
//  - 옮기기(⑤-2): 바탕(확정본)으로 주간 보고를 만드는 작업공간은 LEGACY_FORM 을 자기 '내 양식'으로 한 번 저장한다. 엔진이 지금 쓰는 제목·칸 이름이
//    확정본 파일 글과 다를 수 있어서(S46-27로 바뀐 요청 절 제목 등) 파일을 다시 읽지 않고 지금 엔진 글자를 그대로 옮긴다 — 결과물이 똑같다.
//    그 뒤 제목·칸 이름은 ③ 양식 확인 화면에서 자유롭게 고친다(자리는 그대로 따라감).
// 화면·서버 없는 순수 함수(node 시험이 부른다). 보고 본문 글은 다루지 않는다.
//
// 옮기는 동안(⑤-1 → ⑤-2): '내 양식'에 자리가 아직 없는 작업공간(지금 바탕 있는 사람 전부)은 LEGACY_FORM(지금까지 코드에 박혀 있던
// 양식 글자를 같은 '내 양식' 모양으로 옮겨 적은 것)으로 돈다. ⑤-2에서 저장된 '내 양식'을 엔진에 넘기고, 전환 확인 뒤 ⑤-3에서
// LEGACY_FORM 과 기본값을 지운다(PR 본문 '운영 전환 순서').

// 엔진 자리(채우는 방법). 순서 = 엔진이 한글 파일에 쓰는 차례.
export const ROLES = Object.freeze(['requests', 'requestTable', 'schedule', 'discuss', 'work', 'summaryTable', 'details',
  'struggle', 'rallyTable', 'siteTable', 'orgs', 'orgTable', 'orgNotes', 'calendar']);
// 표가 있는 자리 → 엔진 견본 열쇠·칸 수(엔진이 칸 순서로 읽고 쓰므로 칸 수는 고정).
export const TABLE_ROLES = Object.freeze({requestTable: ['requestTable', 3], summaryTable: ['summaryTable', 4], rallyTable: ['rallyTable', 3],
  siteTable: ['siteTable', 2], orgTable: ['orgTable', 2], calendar: ['scheduleTable', 3]});
// 큰 항목(1단계) 자리. 나머지는 2단계.
export const BIG_ROLES = Object.freeze(['requests', 'work', 'struggle', 'orgs', 'calendar']);
// 자리 → '채울 기록'(③ 화면 고르기 목록과 같은 열쇠 — weekly-own-form-model.mjs FILLS).
const ROLE_FILL = Object.freeze({requests: 'blank', requestTable: 'schedule', schedule: 'schedule', discuss: 'todo', work: 'blank', summaryTable: 'biz',
  details: 'meeting', struggle: 'blank', rallyTable: 'org', siteTable: 'org', orgs: 'blank', orgTable: 'org', orgNotes: 'blank', calendar: 'schedule'});

// ⑤-3에서 지운다. 지금까지 template.mjs·report.mjs 에 박혀 있던 양식 글자를 '내 양식' 모양 그대로 옮겨 적은 것(글자 하나 바꾸지 않음).
// details 의 칸 = 회의 결과 상자 왼쪽 칸 이름(같은 문서 안에서 세 가지 묶음이 섞여 쓰임).
export const LEGACY_FORM = Object.freeze({v: 1, sections: [
  {id: 'requests', role: 'requests', level: 1, title: '1. 요청사항', columns: []},
  {id: 'requestTable', role: 'requestTable', level: 2, title: '1) 임원 배정 요청', columns: ['일', '시간/내용/장소', '참석 요청']},
  {id: 'schedule', role: 'schedule', level: 2, title: '2) 주요 일정', columns: []},
  {id: 'discuss', role: 'discuss', level: 2, title: '3) 상집 논의 요청', columns: []},
  {id: 'work', role: 'work', level: 1, title: '2. 기본․영역․의제 사업', columns: []},
  {id: 'summaryTable', role: 'summaryTable', level: 2, title: '1) 요약', columns: ['사업영역', '세부 과제', '진행 상황 및 이후 계획', '담당 팀원']},
  {id: 'details', role: 'details', level: 2, title: '2) 세부 내용', columns: ['제목', '회의제목', '일시/장소', '참석자', '회의 내용', '내용', '차기일정', '보고', '논의결과', '*차기회의']},
  {id: 'struggle', role: 'struggle', level: 1, title: '3. 투쟁 사업', columns: []},
  {id: 'rallyTable', role: 'rallyTable', level: 2, title: '1) 집회·농성 등', columns: ['일시/장소', '집회/행사명', '참석현황']},
  {id: 'siteTable', role: 'siteTable', level: 2, title: '2) 투쟁 사업장 현황', columns: ['조직명', '현황']},
  {id: 'orgs', role: 'orgs', level: 1, title: '4. 산하조직 현황', columns: []},
  {id: 'orgTable', role: 'orgTable', level: 2, title: '1) 요약', columns: ['사업장', '조직현황']},
  {id: 'orgNotes', role: 'orgNotes', level: 2, title: '2) 참고자료', columns: []},
  {id: 'calendar', role: 'calendar', level: 1, title: '5. 주요 일정', columns: ['일', '시간/내용/장소', '참석자']},
].map(s => Object.freeze({...s, fill: ROLE_FILL[s.role], columns: Object.freeze(s.columns)}))});

const text = s => String(s ?? '').trim();

// '내 양식' → 엔진 profile. 자리가 겹치거나 모자라거나, 표 자리의 칸 수가 엔진과 다르면 null(엔진이 그 양식으로는 못 만듦).
export function profileOf(form) {
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
  if (!boxLabels.length) return null;
  return Object.freeze({titles: Object.freeze(titles), heads: Object.freeze(heads), boxLabels: Object.freeze(boxLabels),
    formLabels: Object.freeze([...new Set(Object.values(heads).flat())])});
}

// ⑤-3에서 지운다(옮기는 동안 자리 없는 작업공간의 기본값).
export const LEGACY_PROFILE = profileOf(LEGACY_FORM);

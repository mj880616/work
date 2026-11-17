// WEEKLY-내양식자유변형 ⑤-3b: [주간 정리]·한글 파일 상자의 절 제목을 엔진과 같은 '내 양식' profile 제목에서 만든다.
// 코드에 박힌 절 제목은 없다 — 글자는 profile.titles(form-profile.mjs profileOf, '내 양식' 또는 바탕 파일에서 읽은 글 그대로).
//  - screenTitles(profile) → 화면 제목 묶음. profile 이 없으면 null(부르는 쪽은 제목을 비우고 양식이 읽히면 다시 그린다).
//  - 화면이 덧붙이는 설명('— 회의·활동 결과')·화면 묶음('3. 투쟁 사업장 현황' = 큰 항목 번호 + 작은 항목 글)은 profile 글로 조립한다.
// 화면·서버 없는 순수 함수(node 시험이 부른다).

const text = s => String(s ?? '').trim();
// '3. 투쟁 사업' → '3.' / '2) 투쟁 사업장 현황' → '2)'. 번호가 없으면 ''.
export const headNumber = s => /^\s*(\(?\d+[.)])/.exec(text(s))?.[1] ?? '';
// 번호를 뗀 글: '2) 투쟁 사업장 현황' → '투쟁 사업장 현황'.
export const headBare = s => text(s).replace(/^\s*\(?\d+[.)]\s*/, '');
const join = (...parts) => parts.map(text).filter(Boolean).join(' ');

export function screenTitles(profile) {
  const t = profile?.titles;
  if (!t) return null;
  const big = role => headNumber(t[role]);
  return Object.freeze({
    requests: t.requests,            // 1. 요청사항
    ask: t.requestTable,             // 1) 임원 배정 요청
    hq: t.schedule,                  // 2) 주요 일정
    discuss: t.discuss,              // 3) 상집 논의 요청
    work: t.work,                    // 2. 기본·영역·의제 사업
    summary: t.summaryTable,         // 1) 요약
    details: join(t.details, '— 회의·활동 결과'), // 2) 세부 내용 — 회의·활동 결과
    sites: join(big('struggle'), headBare(t.siteTable)), // 3. 투쟁 사업장 현황
    orgs: t.orgs,                    // 4. 산하 조직 현황
    orgSummary: t.orgTable,          // 1) 요약
    calendar: t.calendar,            // 5. 주요 일정
    // 상태 줄·알림의 '어느 칸' 글: 큰 항목 번호 + 작은 항목 제목('1. 2) 주요 일정').
    atHq: join(big('requests'), t.schedule),
    atDiscuss: join(big('requests'), t.discuss),
    atDetails: join(big('work'), t.details),
    atSites: join(big('struggle'), t.siteTable),
  });
}

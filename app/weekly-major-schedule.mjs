// WEEKLY-주요일정기준(요청함 11/01 01:11·01:15, 11/02 14:49 명진 고침: 회의는 넣지 않음): 주간보고 '1. 요청사항 › 2) 주요 일정'에 넣을 일정의 기준과
// 주간보고 전체에서 기본으로 빼는 내부 정례 회의 — 이 파일 한 곳에만 둔다(화면 제안·복사 글·회의·활동 결과 거르기가 모두 이것을 부른다).
// 나중에 명진이 기준을 다듬을 때는 아래 두 목록(MAJOR_RULES·INTERNAL_MEETINGS)과 기준 문장(MAJOR_SCHEDULE_RULE)만 고친다.
// AI에게 고르게 할 때도 같은 문장(MAJOR_SCHEDULE_RULE)을 쓴다. 화면 모듈을 부르지 않는다(node 시험이 직접 읽음). 브라우저 저장소 없음.

// 기준 문장(일상어). 화면에는 안내문으로 보이지 않는다(명진 '안내문 넣지 않음') — AI 지시문·설계 문서에서 쓴다.
export const MAJOR_SCHEDULE_RULE = '주요 일정 = 다른 사업장에 알려 연대를 조직해야 하는 투쟁 일정: 파업 투쟁·파업 집회, 집중·릴레이 선전전, '
  + '조합원을 조직하는 규모의 총력 투쟁 결의대회·조합원 총회 투쟁, 공동 집회·공동 투쟁, 궤도 주최 기자회견·국회 토론회. '
  + '회의는 넣지 않는다(일상적으로 논의·의사결정하는 회의는 대표자회의든 내부 정례 회의든 모두 빼기). 사업장 단순 방문도 넣지 않는다.';

// 넣는 것: 이름에 이 말이 들어간 일정(띄어쓰기는 무시). 위에서부터 하나라도 맞으면 넣는다.
export const MAJOR_RULES = Object.freeze([
  {key:'press', label:'기자회견', words:['기자회견']},
  {key:'forum', label:'국회 토론회', words:['토론회']},
  {key:'joint', label:'공동 집회·투쟁', words:['공동집회', '공동투쟁', '공동행동', '공동결의']},
  {key:'strike', label:'파업 집회', words:['파업']},
  {key:'rally', label:'총력 투쟁 결의대회', words:['결의대회', '총력투쟁', '총회투쟁']},
  {key:'campaign', label:'집중·릴레이 선전전', words:['선전전']},
]);

// 주간보고에 기본으로 올리지 않는 내부 정례 회의(01:15 "노조 상집, 궤도 집행국 회의, 노조 중집, 본부 집행위 등은 주간보고 안함").
// 이름(시리즈 이름, 없으면 제목)에 이 말이 들어가면 회의·활동 결과·2) 주요 일정 제안·복사 글에서 빠진다. 서버의 '빼는 회의 종류' 목록과 함께 쓴다.
export const INTERNAL_MEETINGS = Object.freeze(['상집', '중집', '집행위', '집행국', '상무집행', '중앙집행']);
// 넣지 않는 것: 회의(11/02 명진 "여기에는 회의는 안 넣어") — 이름에 '회의'가 들어가면 다른 말이 맞아도 넣지 않는다. 사업장 단순 방문도 넣지 않는다.
const MEETING = ['회의', '대의원대회', '대표자대회'];
const VISIT = ['방문', '면담', '간담회'];

const squash = s => String(s ?? '').replace(/\s+/g, '').toLowerCase();
const has = (text, words) => words.some(w => text.includes(squash(w)));

// 내부 정례 회의인가(이름 기준).
export const isInternalMeeting = name => { const t = squash(name); return !!t && has(t, INTERNAL_MEETINGS); };

// 2) 주요 일정 기준에 맞는가. 맞으면 맞은 규칙 {key, label}, 아니면 null. 내부 정례 회의·단순 방문은 늘 null.
export function majorRule(title) {
  const t = squash(title);
  if (!t || has(t, INTERNAL_MEETINGS) || has(t, MEETING)) return null;
  const rule = MAJOR_RULES.find(r => has(t, r.words)) ?? null;
  if (!rule) return null;
  // '방문' 같은 말만 있고 행사 말이 따로 없으면(예: '파업 사업장 방문') 넣지 않는다.
  if (has(t, VISIT) && rule.key === 'strike' && !has(t, ['집회', '결의대회'])) return null;
  return {key:rule.key, label:rule.label};
}

// S67-57(내 프로필·가입·설정의 노조 흔적 빼기): 내 프로필·묶음·주간 캘린더 칸이 함께 쓰는 이름 글자의 한 곳.
// 칸 이름은 단어표 자리(word('노조','group')·word('주간 보고','weekly'))로만 부른다 — 이름 바꾸기 칸은 없다(DB 변경 없음).
// 노동조합+ 얼굴·노동조합+ 낱말 바탕인 사람(S67-62 nojo_words)은 지금 글자 그대로, WORK ON 기본은 '소속명'·'주간 정리'.
import {word} from './brand/brand.mjs';

/** 소속 칸 이름(묶음 종류 '노조' 자리 하나). WORK ON 기본 '소속'. */
export const UNION_WORD = word('노조', 'group');
/** 기본 정보·묶음 만들기의 소속 이름 칸(app_profiles.union_name). WORK ON 기본 '소속명'. */
export const UNION_LABEL = `${UNION_WORD}명`;
/** 주간 칸 이름. WORK ON 기본 '주간 정리', 사용자 '주간 보고'. */
export const WEEKLY_WORD = word('주간 보고', 'weekly');
/** 내 프로필 › 주간 캘린더 칸 제목. */
export const REPORT_CALENDAR_TITLE = `${WEEKLY_WORD} 일정 캘린더`;

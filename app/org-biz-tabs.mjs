// NAV-조직사업합침(2026-11-28 사용자 결정 10:22~10:55): [조직·사업] 메뉴 하나 안의 큰 탭 목록. 뜻은 이 파일 한 곳이다.
// DOM·네트워크·기기 저장소 없음(단위 시험 대상). 그리는 곳은 org-biz-tabs.js 하나(조직 관리·사업 관리·주간 보고 칸 맨 위 탭 줄).
//
// - 큰 탭 셋: [조직 관리](라우터 team) [사업 관리](meetings) [주간 보고](weekly — 업무일지 칸의 주간 쪽, app-router.js PANEL_OF).
//   탭 안 화면 내용은 그대로이고 들어가는 길만 하나로 모았다.
// - 메뉴로 들어가면 늘 맨 앞 [조직 관리](menu-model.mjs 'team' 항목의 view). 마지막에 본 탭은 기억하지 않는다(기기 저장 금지).
// - 보일 탭은 visibleTabs() 하나가 정한다. feature가 있는 탭은 서버 허용 표(app_operator_features → app_my_features 답)에 그 키가
//   있을 때만 목록에 남는다(화면 숨김이 아니라 목록에서 빼기 — 데이터는 서버가 막는다). 지금은 세 탭 모두 feature가 없어 모두에게 보인다.
//   주간 보고를 운영자 전용으로 바꾸는 다음 작업(WEEKLY-운영자전용)은 그 탭에 feature 키를 적고 서버 쪽 막기를 더하면 된다.
// - 이름: '조직 관리'·'사업 관리'·'주간 보고'는 모든 사람의 기본 이름이다(WORK ON+ 기본 단어 '거래처'·'활동' 계열을 이 메뉴에는 쓰지 않음).
//   글자는 word(글자, 'tab') 자리를 거쳐, 내가 고친 이름(custom-words-model.mjs의 menu_org·menu_biz 칸)이 있으면 그 이름이다.

export const TABS = Object.freeze([
  Object.freeze({id: 'team', view: 'team', text: '조직 관리'}),
  Object.freeze({id: 'meetings', view: 'meetings', text: '사업 관리'}),
  Object.freeze({id: 'weekly', view: 'weekly', text: '주간 보고'})
]);
/** 이 탭들이 맡는 라우터 화면 이름(별칭 포함 — 사업영역 관리 projects는 사업 관리 안의 창). */
export const TAB_VIEWS = Object.freeze(['team', 'meetings', 'projects', 'weekly']);
const VIEW_TAB = Object.freeze({team: 'team', meetings: 'meetings', projects: 'meetings', reports: 'meetings', weekly: 'weekly'});

/** 화면 이름 → 그 화면이 속한 큰 탭 id(없으면 null). */
export const tabOfView = view => VIEW_TAB[view] || null;

/** 보일 탭 목록. features: 서버 기능 목록(null = 아직 모름 → 빼지 않음, 운영자 화면이 답을 기다리는 동안 탭이 빠졌다 생기지 않게). */
export function visibleTabs(features = null) {
  if (!Array.isArray(features)) return [...TABS];
  const have = new Set(features);
  return TABS.filter(tab => !tab.feature || have.has(tab.feature));
}

/** 좌우 밀기: 지금 탭에서 dir(+1 = 다음, -1 = 앞) 쪽 탭의 화면 이름. 끝이면 null(넘어가 돌지 않는다). */
export function stepTab(view, dir, features = null) {
  const list = visibleTabs(features), at = list.findIndex(tab => tab.id === tabOfView(view));
  if (at < 0 || (dir !== 1 && dir !== -1)) return null;
  return list[at + dir]?.view || null;
}

// 좌우 밀기 판정(읽을 거리 보기 탭 넘김과 같은 기준): 가로 60px 이상이고 세로의 2배 이상. 화면 왼쪽 끝 24px 안에서 시작하면
// 폰 뒤로가기 밀기(edge-back-swipe.js EDGE_START)와 겹치므로 넘기지 않는다.
export const SWIPE_MIN = 60;
export const EDGE_SKIP = 24;
/** 손가락 한 번 → -1(앞 탭) | 1(다음 탭) | 0(넘기지 않음). 왼쪽으로 밀면 다음 탭. */
export function swipeStep({x0, y0, x1, y1}) {
  const dx = Number(x1) - Number(x0), dy = Number(y1) - Number(y0);
  if (![dx, dy, Number(x0)].every(Number.isFinite) || Number(x0) <= EDGE_SKIP) return 0;
  if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * 2) return 0;
  return dx < 0 ? 1 : -1;
}

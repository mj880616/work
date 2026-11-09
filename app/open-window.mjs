// '떠 있는 창이 열려 있나' 판단 하나(★LIB-바깥파일놓기안됨, 요청함 11/09 18:08).
// PC·펼친 폴드에서 칸에 붙인 창(사업 보고 결과·사업영역·담당조직·할 일: class modal이지만 role=region, data-*-docked)은
// 화면의 한 칸이지 위에 뜬 창이 아니다. 다른 화면으로 옮겨도 hidden 없이 그 화면 안에 남으므로 '.modal:not(.hidden)'만 보면
// 늘 '창이 열려 있음'으로 잡혀 자료실 바깥 파일 놓기가 꺼졌다(사업 보고를 본 뒤 자료실 🚫). 그래서 붙인 칸은 빼고 본다.
// 붙이는 쪽(meeting-round-detail.js mrdPaintDocked, workplace-detail.js, project-system-v3.js, google-tasks.js placeEditor)은
// 모두 붙일 때 role=region, 뗄 때 role=dialog로 바꾼다 — 이 파일은 그 표시를 읽기만 한다.
export const isDockedPane = el => el?.getAttribute?.('role') === 'region';

/** 지금 떠 있는 창(.modal, 숨김 아님, 칸에 붙인 것 아님). except: 빼고 볼 창 선택자 목록(예: 자기 창). */
export function floatingWindows(doc = globalThis.document, {except = []} = {}) {
  return [...(doc?.querySelectorAll?.('.modal:not(.hidden)') || [])]
    .filter(m => !isDockedPane(m) && !except.some(sel => m.matches(sel)));
}

export const floatingWindowOpen = (doc = globalThis.document, opts) => floatingWindows(doc, opts).length > 0;

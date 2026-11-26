// S67-75 UI-걸러보기칩하나(2026-11-21 사용자 18:33 A안): 폰 사업 관리 윗줄의 고르기 상자 네 개(종류·사업영역·기간·보기)를 칩 하나로 묶을 때
// 그 칩의 글자. 기본값에서 바꾼 상자(is-on 표시 = 화면이 '고른 상태'로 그리는 것, 보기는 목록이 아닌 것)의 고른 글자만 ' · '로 잇고,
// 아무것도 안 골랐으면 '전체'. 상자 값의 주인은 그대로 team.js이고, 이 규칙은 그 상자들을 읽기만 한다.
export const FILTER_CHIP_ALL = '전체';

// parts: [{label, on, shown}] — 화면 순서(종류 · 사업영역 · 기간 · 보기).
export function filterChipText(parts) {
  const picked = (parts || []).filter(p => p && p.shown !== false && p.on && String(p.label || '').trim()).map(p => String(p.label).trim());
  return picked.length ? picked.join(' · ') : FILTER_CHIP_ALL;
}

// 고른 줄 글자(<select>의 고른 option 글자). 숨은 첫 줄(기간 '주 단위'·'정한 기간')도 고른 줄이면 그 글자.
export function selectedLabel(select) {
  const o = select?.options?.[select.selectedIndex];
  return String(o?.label || o?.textContent || '').trim();
}

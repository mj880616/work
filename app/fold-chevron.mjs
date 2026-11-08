// UI-접기꺾쇠(S51-33, 요청함 11/06 23:28 "더보기 화살표 버튼이 이상"): 접기·펼치기 표시는 사이트 공용 꺾쇠 하나.
// 닫힘 ⌄ / 펼침 ⌃(같은 선 그림을 180도 돌림), 회색, 글자와 같은 높이. 모양은 ui-standard.css "UI-접기꺾쇠" 한 곳이 그린다.
// - [aria-expanded="true"] 버튼 바로 안이나 열린 <details>의 <summary> 안에 두면 저절로 펼침 모양이 된다(open은 그 밖의 곳에서만 필요).
// - 세모(▴▾▸) 글자는 접기 표시로 쓰지 않는다. 고르기 창을 여는 버튼 뒤 ▾(UI-펼침표시)와 폴더 나무(FOLDER-세모0)는 다른 규칙이다.
// - 읽어 주는 이름은 버튼의 aria-expanded가 말하므로 그림은 aria-hidden.
export const chevHtml = (open = false, className = '') => `<i class="kptu-chev${open ? ' is-open' : ''}${className ? ` ${className}` : ''}" aria-hidden="true"></i>`;
// '더보기 ›': 더 보여 주는 글자 버튼(UI-버튼6가지 ③ 글자 버튼). 세모 없이 › 하나.
export const MORE_LABEL = '펼치기 ›';
export const moreLabel = (count = '') => `펼치기${count === '' || count === null || count === undefined ? '' : ` ${count}`} ›`;

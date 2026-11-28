// UI-설정줄(S71-36 PROFILE-설정화면, 사용자 11/26 시안 확정 "ㅇㅋ" — 안드로이드 설정 화면처럼 '한 줄 메뉴 → 들어가면 상세'):
// 설정 화면의 줄 하나를 그리는 공용 부품. 내 프로필의 모든 화면이 이것 하나로 줄을 그리고, 앞으로 다른 설정 화면도 이것을 쓴다.
// 모양은 app/ui-standard.css 'UI-설정줄' 한 곳(.sl-*)이 정한다. 화면 CSS는 자리만 정한다.
// 줄 = 이름(+ 아래 회색 설명 한 줄) + 오른쪽 작은 회색 요약 + 끝 하나(› · 스위치 · ↗ · 작은 동작). 위험 줄(계정 삭제·모든 연결 끊기)은 빨간 글자.
// 이 파일은 글자만 만든다(화면·서버 호출 없음) — node --test로 확인한다(tests/settings-list.test.mjs).

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
// data-* 이름 → 속성 글자. 값이 true면 이름만, false·null·undefined면 뺀다.
export function attrsHtml(attrs = {}) {
  return Object.entries(attrs).filter(([, v]) => v !== false && v != null)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`)).join('');
}
// attrs.class는 부품 클래스 뒤에 붙인다(속성이 둘이 되지 않게).
const split = (attrs = {}) => { const {class: extra, ...rest} = attrs || {}; return [extra ? ' ' + esc(extra) : '', rest]; };
const textPart = ({label, desc, descAttrs}) => {
  const [extra, rest] = split(descAttrs);
  return `<span class="sl-text"><span class="sl-label">${esc(label)}</span>${desc ? `<span class="sl-desc${extra}"${attrsHtml(rest)}>${esc(desc)}</span>` : ''}</span>`;
};
const sumPart = (sum, sumAttrs) => {
  if (!sum && !sumAttrs) return '';
  const [extra, rest] = split(sumAttrs);
  return `<span class="sl-sum${extra}"${attrsHtml(rest)}>${esc(sum || '')}</span>`;
};
const open = (tag, base, attrs, danger) => { const [extra, rest] = split(attrs); return `<${tag} class="${base}${danger ? ' sl-danger' : ''}${extra}"${attrsHtml(rest)}`; };

/** 들어가는 줄(›). 누르면 그 화면으로. */
export function navRow({label, desc, sum, sumAttrs, attrs, danger, disabled}) {
  return `${open('button type="button"', 'row-act sl-row sl-nav', attrs, danger)}${disabled ? ' disabled' : ''}>${textPart({label, desc})}${sumPart(sum, sumAttrs)}<span class="sl-end sl-chev" aria-hidden="true">›</span></button>`;
}

/** 스위치 줄. 줄 전체(label)를 눌러도 켜고 끈다. input은 role=switch 체크칸 하나. */
export function switchRow({label, desc, descAttrs, sum, checked, disabled, attrs, rowAttrs, ariaLabel, danger}) {
  return `${open('label', 'sl-row sl-switch-row', rowAttrs, danger)}>${textPart({label, desc, descAttrs})}${sumPart(sum)}<input type="checkbox" role="switch" class="sl-switch"${attrsHtml(attrs)}${checked ? ' checked' : ''}${disabled ? ' disabled' : ''} aria-label="${esc(ariaLabel || label)}"></label>`;
}

/** 누르면 바로 무엇을 하는 줄(지금 백업·시험 알림 보내기·계정 삭제). 끝 표시는 없다. */
export function actionRow({label, desc, descAttrs, sum, attrs, danger, disabled, busy}) {
  return `${open('button type="button"', 'row-act sl-row sl-action', attrs, danger)}${disabled ? ' disabled' : ''}${busy ? ' aria-busy="true"' : ''}>${textPart({label, desc, descAttrs})}${sumPart(sum)}</button>`;
}

/** 밖으로 여는 줄(드라이브 폴더 열기 ↗). 주소는 화면이 미리 확인한 https 주소만 넘긴다. */
export function linkRow({label, desc, sum, href, attrs, ariaLabel}) {
  return `${open('a', 'sl-row sl-link', attrs)} href="${esc(href)}" target="_blank" rel="noopener noreferrer"${ariaLabel ? ` aria-label="${esc(ariaLabel)}"` : ''}>${textPart({label, desc})}${sumPart(sum)}<span class="sl-end sl-out" aria-hidden="true">↗</span></a>`;
}

/** 보이기만 하는 줄(값 한 줄). 오른쪽 끝에 작은 동작(공용 글자 버튼 html)을 하나 둘 수 있다. */
export function infoRow({label, desc, descAttrs, sum, sumAttrs, end = '', attrs, danger}) {
  return `${open('div', 'sl-row sl-info', attrs, danger)}>${textPart({label, desc, descAttrs})}${sumPart(sum, sumAttrs)}${end}</div>`;
}

/** 접었다 펴는 줄(등록된 폰 N대 ›·조용한 시간 ›). 키보드로 여닫는 <details>. 펴면 안쪽 줄들이 그 아래에.
 *  UI-반복단추줄이기(사용자 결정 2026-11-28 14:03 "'없음'이 한 번 더"): 펼칠 것이 없으면(body가 빈 글자) 접는 줄이 아니라
 *  보이기만 하는 줄 하나(이름 + 오른쪽 요약, 예 '없음')로 그린다 — 펼쳐도 빈 칸·'없음'이 한 번 더 나오지 않게. 부르는 쪽은 비었을 때 body를 비워 준다. */
export function foldRow({label, desc, sum, sumAttrs, body, attrs, open}) {
  if (!body) return infoRow({label, desc, sum, sumAttrs, attrs});
  return `<details class="sl-fold"${attrsHtml(attrs)}${open ? ' open' : ''}><summary class="sl-row sl-nav">${textPart({label, desc})}${sumPart(sum, sumAttrs)}<span class="sl-end sl-chev" aria-hidden="true">›</span></summary><div class="sl-fold-body">${body || ''}</div></details>`;
}

/** 줄 묶음(제목은 있을 때만, 묶음 위 작은 회색 글자). 빈 줄은 빼고, 줄이 하나도 없으면 묶음도 없다. */
export function groupHtml(rows, {title = '', attrs} = {}) {
  const list = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
  if (!list.length) return '';
  return `${title ? `<div class="sl-group-title">${esc(title)}</div>` : ''}<div class="sl-group"${attrsHtml(attrs)}>${list.join('')}</div>`;
}

/** 묶음 아래 작은 회색 글 한 줄. */
export const noteHtml = (text, attrs) => (text ? `<p class="sl-note"${attrsHtml(attrs)}>${esc(text)}</p>` : '');

/** 들어간 화면 머리: ‹ 제목. ‹는 그 화면을 연 쪽(내 프로필)으로 돌아간다(누르는 일은 화면 주인이 정함). */
export function pageHeadHtml(title, {backAttrs = {'data-sl-back': true}} = {}) {
  return `<div class="sl-page-head"><button type="button" class="icon-btn sl-back"${attrsHtml(backAttrs)} aria-label="뒤로">‹</button><h2 class="sl-page-title">${esc(title)}</h2></div>`;
}

/** 조용한 시간 같은 '09:00' → 요약용 '9'·'9:30'. 모양이 다르면 그대로. */
export function shortTime(t) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(t || ''));
  if (!m) return String(t || '');
  return m[2] === '00' ? m[1] : `${m[1]}:${m[2]}`;
}

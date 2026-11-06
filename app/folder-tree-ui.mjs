// FOLDER-나무새기준(S51-12, 요청함 11/06 01:31, 시안 folder-unify-library-style.html·folder-inline-expand-pinch.html 명진 01:39 'ㅇㅋ'):
// 파일·노트·사진·자료실 폴더 나무가 함께 쓰는 줄 모양 한 곳(순수 함수: 화면·저장소·네트워크에 닿지 않음, node --test로 시험).
// 모양 규칙은 folder-tree.css의 'ft-' 묶음 한 곳이다.
//  ① 둥근 상자(ftBoxHtml): '최근' 상자, 저장소마다 상자. 머리를 누르면 접기(접는 상자만).
//  ② 줄(ftFolderRowHtml): 넉넉한 높이, 맨 위 단계만 구분선·굵은 이름, 하위는 선 없이 들여쓰기(--ft-depth), 이름 + 회색 개수, 오른쪽 ⋯.
//  ③ 펼침 상태는 폴더 아이콘 열린/닫힌 모양(ftIconHtml). 작은 세모·꺽쇠 없음. 안에 아무것도 없는 폴더는 처음부터 닫힌 모양.
//     파일이 많으면 처음 FT_PREVIEW개 + 'n개 더 보기'(ftMoreRowHtml).
//  ⑤ 휴지통은 상자 맨 아래 회색 줄(ftTrashRowHtml). ⑥ 색을 정한 폴더는 아이콘 색(data-fc, folder-look.css). ⑦ 꺼 둔 폴더는 흐리게 + '끔'.
//  ⑨ 점(●)은 없다(종류 점·색 점을 그리지 않는다).
// 줄을 누르는 동작·상태(어느 폴더가 열렸나)는 각 화면의 상태 주인이 갖고, 이 파일은 HTML만 만든다. 두 손가락으로 그 폴더만 보기는 folder-pinch.js.
import {folderIndent} from './folder-limits.mjs';
import {folderShapeHtml, colorOf} from './folder-look-model.mjs';

// 펼친 폴더에 처음 보이는 파일(노트·사진) 수. 나머지는 'n개 더 보기'.
export const FT_PREVIEW = 5;
// 두 손가락으로 그 폴더만 볼 수 있다는 짧은 안내(손가락으로 쓰는 화면에서만 CSS가 보인다).
export const FT_PINCH_HINT = '두 손가락 벌리면 이 폴더만';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const attrsHtml = attrs => Object.entries(attrs || {}).filter(([, v]) => v !== undefined && v !== null && v !== false)
  .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`)).join('');
const MORE_DOTS = '<span class="more-dots" aria-hidden="true">⋯</span>';

// 폴더 아이콘: 닫힌/열린 폴더 그림 하나(색을 고른 폴더는 data-fc 색, 안 고른 폴더는 기본 노랑 --ds-folder-0-ico).
// open: 지금 펼쳐져 있고 안에 보일 것이 있을 때만 true로 넘긴다(빈 폴더는 늘 닫힌 모양).
export function ftIconHtml({color = null, open = false, className = 'ft-ico'} = {}) {
  const c = colorOf({color});
  return `<span class="${className}"${c ? ` data-fc="${c}"` : ''} data-ft-shape="${open ? 'open' : 'closed'}" aria-hidden="true">${folderShapeHtml(open ? 'open' : 'closed')}</span>`;
}
// 들여쓰기 값(폰이 깨지지 않게 folder-limits.mjs의 4단까지).
export const ftDepth = depth => folderIndent(depth);

// ⋯ 버튼(줄 오른쪽). attr: 그 화면이 메뉴를 여는 data 이름과 값({'data-nx-folder-more': id}), label: 읽기 프로그램 이름.
export function ftMoreButtonHtml({attrs = {}, label = '메뉴', className = ''} = {}) {
  return `<button type="button" class="ft-btn ft-dots${className ? ' ' + className : ''}"${attrsHtml(attrs)} aria-label="${esc(label)}" aria-haspopup="true" aria-expanded="false">${MORE_DOTS}</button>`;
}

// 폴더 줄 하나.
//  name·count(회색 개수, 숫자 또는 짧은 글자)·countLabel(읽기 프로그램용)·depth(0 = 맨 위 단계 → 구분선·굵은 이름)·open·hasContent(펼칠 것이 있나)
//  color(1~8)·off(꺼 둔 폴더: 흐리게 + '끔')·current(지금 고른 폴더)·picked(선택 모드에서 고름)·lead(앞에 붙일 HTML, 선택 칸 등)
//  rowAttrs: 줄 div의 속성, mainAttrs: 줄을 누르는 단추의 속성(펼치기·접기 data 이름), more: ftMoreButtonHtml 인자(없으면 ⋯ 없음)
//  tree: PC 왼쪽 나무처럼 role=tree 안에 있을 때(treeitem·aria-expanded).
//  toggle(S51-25 FOLDER-PC나무): PC 나무처럼 '줄 누르기 = 그 폴더 열기 + 펼침, 아이콘만 누르기 = 접기·펼치기만'인 화면.
//    {attrs: 아이콘 단추 data 이름과 값, label: 읽기 프로그램 이름}. 주면 폴더 아이콘이 줄 앞 따로인 단추가 되고(세모 없음),
//    펼칠 것이 없는 폴더(hasContent false)는 단추 없이 닫힌 아이콘만 같은 자리에 둔다.
export function ftFolderRowHtml({name, count = null, countLabel = '', depth = 0, open = false, hasContent = true, color = null, off = false,
  current = false, picked = false, lead = '', rowAttrs = {}, mainAttrs = {}, more = null, tree = false, className = '', icon = null, toggle = null}) {
  const top = depth === 0, shown = !!open && !!hasContent;
  const cls = ['ft-row', 'ft-folder', top ? 'ft-top' : 'ft-sub', shown ? 'ft-open' : '', off ? 'ft-off' : '', current ? 'ft-current' : '', picked ? 'ft-picked' : '', toggle ? 'ft-has-tog' : '', className].filter(Boolean).join(' ');
  const num = count === null || count === undefined || count === '' ? '' : `<span class="ft-num"${countLabel ? ` aria-label="${esc(countLabel)}"` : ''}>${esc(count)}</span>`;
  const expand = tree || hasContent ? ` aria-expanded="${shown}"` : '';
  const ico = icon ?? ftIconHtml({color, open: shown});
  const tog = !toggle ? '' : hasContent
    ? `<button type="button" class="ft-btn ft-tog"${attrsHtml(toggle.attrs)} aria-expanded="${shown}" aria-label="${esc(toggle.label || `${name} ${shown ? '접기' : '펼치기'}`)}">${ico}</button>`
    : `<span class="ft-tog ft-tog-none">${ico}</span>`;
  return `<div class="${cls}"${attrsHtml(rowAttrs)} style="--ft-depth:${ftDepth(depth)}"${tree ? ' role="treeitem"' : ''}>${tog}`
    + `<button type="button" class="ft-btn ft-main"${attrsHtml(mainAttrs)}${toggle ? '' : expand}${current ? ' aria-current="true"' : ''}>${lead}${toggle ? '' : ico}<span class="ft-name">${esc(name)}</span>${num}${off ? '<span class="ft-offtag">끔</span>' : ''}</button>`
    + `${more ? ftMoreButtonHtml(more) : ''}</div>`;
}

// 'n개 더 보기' 줄(펼친 폴더 안 파일이 FT_PREVIEW개를 넘을 때). attrs: 누르면 그 폴더를 다 보이게 하는 data 이름과 값.
// hint: 두 손가락 안내를 붙일지(손가락 화면에서만 보임).
export function ftMoreRowHtml({rest, depth = 1, attrs = {}, hint = true} = {}) {
  return `<button type="button" class="ft-btn ft-row ft-more-row"${attrsHtml(attrs)} style="--ft-depth:${ftDepth(depth)}">${esc(rest)}개 더 보기${hint ? `<span class="ft-hint"> · ${FT_PINCH_HINT}</span>` : ''}</button>`;
}

// 휴지통 줄(상자 맨 아래 회색). count 없으면 숫자 없음.
export function ftTrashRowHtml({count = null, attrs = {}, label = '휴지통'} = {}) {
  const icon = '<span class="ft-ico ft-ico-trash" aria-hidden="true"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></span>';
  return `<div class="ft-row ft-trash ft-top"><button type="button" class="ft-btn ft-main"${attrsHtml(attrs)}>${icon}<span class="ft-name">${esc(label)}</span>${count === null || count === undefined ? '' : `<span class="ft-num">${esc(count)}</span>`}</button></div>`;
}

// 둥근 상자. head: 머리줄 HTML(없으면 머리 없음), body: 안 줄들. collapsible이면 머리가 접기 단추(toggleAttrs로 누름을 받는다).
// open=false면 안 줄을 그리지 않는다(머리만). tail: 머리 오른쪽 작은 글자('맞추는 중'·'더보기' 단추 등).
// caret: 머리 줄 끝 ▴(펼침)·▾(접힘)로 접기를 보인다('최근' 상자, S51-22). 접으면 tail(더보기)도 숨는다.
export const ftCaretHtml = open => `<span class="ft-box-caret" aria-hidden="true">${open ? '▴' : '▾'}</span>`;
export function ftBoxHtml({head = '', body = '', open = true, collapsible = false, caret = false, toggleAttrs = {}, tail = '', attrs = {}, label = ''} = {}) {
  const headHtml = !head ? '' : collapsible
    ? `<div class="ft-box-head"><button type="button" class="ft-btn ft-box-toggle"${attrsHtml(toggleAttrs)} aria-expanded="${!!open}">${head}${caret ? '' : open ? '' : '<span class="ft-box-folded">접힘</span>'}</button>${caret && !open ? '' : tail}${caret ? ftCaretHtml(open) : ''}</div>`
    : `<div class="ft-box-head"><span class="ft-box-title">${head}</span>${tail}</div>`;
  return `<section class="ft-box${open ? '' : ' ft-box-closed'}"${attrsHtml(attrs)}${label ? ` aria-label="${esc(label)}"` : ''}>${headHtml}${open ? `<div class="ft-box-body">${body}</div>` : ''}</section>`;
}

// 펼친 폴더에 보일 파일만 자르기: 다 보기(all)가 아니면 처음 FT_PREVIEW개, 나머지 수.
export function ftLimit(list, all = false, limit = FT_PREVIEW) {
  const items = Array.isArray(list) ? list : [];
  if (all || items.length <= limit) return {shown: items, rest: 0};
  return {shown: items.slice(0, limit), rest: items.length - limit};
}

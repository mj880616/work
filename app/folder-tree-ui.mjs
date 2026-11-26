// FOLDER-나무새기준(S51-12, 요청함 11/06 01:31, 시안 folder-unify-library-style.html·folder-inline-expand-pinch.html 명진 01:39 'ㅇㅋ'):
// 파일·노트·사진·자료실 폴더 나무가 함께 쓰는 줄 모양 한 곳(순수 함수: 화면·저장소·네트워크에 닿지 않음, node --test로 시험).
// 모양 규칙은 folder-tree.css의 'ft-' 묶음 한 곳이다.
//  ① 둥근 상자(ftBoxHtml): '최근' 상자, 저장소마다 상자. 머리를 누르면 접기(접는 상자만).
//  ② 줄(ftFolderRowHtml): 넉넉한 높이, 맨 위 단계만 구분선·굵은 이름, 하위는 선 없이 들여쓰기(--ft-depth), 이름 + 회색 개수, 오른쪽 ⋯.
//  ③ 펼침 상태는 폴더 아이콘 열린/닫힌 모양(ftIconHtml). 작은 세모 없음. 넓은 화면 탐색기 나무(toggle)만 아이콘 왼쪽 작은 회색 꺾쇠(T10). 안에 아무것도 없는 폴더는 처음부터 닫힌 모양.
//     파일이 많으면 처음 FT_PREVIEW개 + 'n개 더 보기'(ftMoreRowHtml).
//  ⑤ 휴지통은 상자 맨 아래 회색 줄(ftTrashRowHtml). ⑥ 색을 정한 폴더는 아이콘 색(data-fc, folder-look.css). ⑦ 꺼 둔 폴더는 흐리게 + '끔'.
//  ⑨ 점(●)은 없다(종류 점·색 점을 그리지 않는다).
// 줄을 누르는 동작·상태(어느 폴더가 열렸나)는 각 화면의 상태 주인이 갖고, 이 파일은 HTML만 만든다. 두 손가락은 줄 크기(folder-pinch.js, S69-99).
import {folderIndent} from './folder-limits.mjs';
import {folderShapeHtml, colorOf} from './folder-look-model.mjs';
import {chevHtml} from './fold-chevron.mjs';
import {partStyles} from './part-styles.js';
import {emptyHtml} from './wait-state.js';
import {folderFileText, countText} from './folder-count.mjs';
// S67-41: 이 부품의 모양 파일(part-styles.js 표)을 부품이 열리기 전에 붙인다 — 화면 모양 목록에 없어도 꾸밈 없이 그려지지 않게.
await partStyles('folder-tree-ui');

// 펼친 폴더에 처음 보이는 파일(노트·사진) 수. 나머지는 'n개 더 보기'.
export const FT_PREVIEW = 5;

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

// 줄 단추(.ft-main) 하나 — 폴더 줄·항목 줄이 같이 쓴다(모양은 folder-tree.css .ft-main 한 곳). attrs: 이미 만든 속성 글자, inner: 안 HTML.
const ftMainHtml = ({cls = '', attrs = '', inner = ''}) => `<button type="button" class="ft-btn ft-main${cls}"${attrs}>${inner}</button>`;

// 폴더 줄 하나.
//  name·count(회색 개수, 숫자 또는 짧은 글자)·countLabel(읽기 프로그램용)·depth(0 = 맨 위 단계 → 구분선·굵은 이름)·open·hasContent(펼칠 것이 있나)
//  color(1~8)·off(꺼 둔 폴더: 흐리게 + '끔')·current(지금 고른 폴더)·picked(선택 모드에서 고름)·lead(앞에 붙일 HTML, 선택 칸 등)
//  rowAttrs: 줄 div의 속성, mainAttrs: 줄을 누르는 단추의 속성(펼치기·접기 data 이름), mainClass: 그 단추에 더할 class, more: ftMoreButtonHtml 인자(없으면 ⋯ 없음)
//  tree: PC 왼쪽 나무처럼 role=tree 안에 있을 때(treeitem·aria-expanded).
//  toggle(S51-25 FOLDER-PC나무 → TREE-탐색기꺾쇠 S70-81b, T10): 넓은 화면 탐색기 나무('이름 = 오른쪽에 그 폴더, 꺾쇠 = 펼치기·접기만').
//    {attrs: 꺾쇠 단추 data 이름과 값, label: 읽기 프로그램 이름}. 주면 폴더 아이콘 왼쪽에 작은 꺾쇠 단추(.ft-tog)가 붙고,
//    펼칠 것이 없는 폴더(hasContent false)는 꺾쇠 없이 같은 폭 빈 자리만 둔다.
//  tag(LIB-받는폴더 S59-11): 개수 뒤 작은 표시 글자(예: '받는 폴더'). 없으면 아무것도 붙지 않는다.
//  top(S69-90): 맨 위 단계 모양(구분선·굵은 이름)을 depth와 따로 정할 때(사진 PC 나무는 맨 위 줄 아래 한 단계까지 굵게). 없으면 depth === 0.
//  nameTail(S69-90): 이름 뒤 같은 칸에 붙일 작은 글자 HTML(사진 ' · 자리'·'백업 안 됨'). 부르는 쪽이 이미 이스케이프한 HTML만 넘긴다.
//  after(UI-폴더목록한모양 S69-90): 줄 단추와 ⋯ 사이에 둘 그 화면만의 칸(사진 '사진에 보이기' 스위치 등). 없으면 없음.
//  이름 칸(.ft-name)에는 늘 전체 이름 title(UI-긴폴더이름 S70-19, 표준 L2): 좁은 나무에서 … 로 잘려도 마우스를 올리면 전체 이름이 보인다. nameTail은 넣지 않는다.
//  고른 줄(picked)은 [파일]과 같은 표시 — 옅은 강조 바탕 + 왼쪽 진한 세로줄(folder-tree.css .ft-picked). 줄 앞 체크칸은 두지 않는다.
export function ftFolderRowHtml({name, count = null, countLabel = '', depth = 0, open = false, hasContent = true, color = null, off = false,
  current = false, picked = false, lead = '', rowAttrs = {}, mainAttrs = {}, more = null, tree = false, className = '', mainClass = '', icon = null, toggle = null, tag = '', after = '', top: topLook = null, nameTail = ''}) {
  const top = topLook ?? depth === 0, shown = !!open && !!hasContent;
  const cls = ['ft-row', 'ft-folder', top ? 'ft-top' : 'ft-sub', shown ? 'ft-open' : '', off ? 'ft-off' : '', current ? 'ft-current' : '', picked ? 'ft-picked' : '', toggle ? 'ft-has-tog' : '', className].filter(Boolean).join(' ');
  const num = count === null || count === undefined || count === '' ? '' : `<span class="ft-num"${countLabel ? ` aria-label="${esc(countLabel)}"` : ''}>${esc(count)}</span>`;
  const expand = tree || hasContent ? ` aria-expanded="${shown}"` : '';
  const ico = icon ?? ftIconHtml({color, open: shown});
  // TREE-탐색기꺾쇠(S70-81b, T10): 펼치기·접기 단추는 폴더 아이콘 왼쪽 작은 회색 꺾쇠(접힘 › / 펼침 ⌄). 하위가 없으면 같은 폭 빈 자리(꺾쇠 없음).
  //  폴더 아이콘은 이름 단추 안(아이콘·이름 누르기 = 오른쪽에 그 폴더).
  const tog = !toggle ? '' : hasContent
    ? `<button type="button" class="ft-btn ft-tog"${attrsHtml(toggle.attrs)} aria-expanded="${shown}" aria-label="${esc(toggle.label || `${name} ${shown ? '접기' : '펼치기'}`)}">${chevHtml(false, 'ft-chev')}</button>`
    : '<span class="ft-tog ft-tog-none" aria-hidden="true"></span>';
  return `<div class="${cls}"${attrsHtml(rowAttrs)} style="--ft-depth:${ftDepth(depth)}"${tree ? ' role="treeitem"' : ''}>${tog}`
    + ftMainHtml({cls:mainClass ? ' ' + esc(mainClass) : '', attrs:`${attrsHtml(mainAttrs)}${toggle ? '' : expand}${current ? ' aria-current="true"' : ''}`,
      inner:`${lead}${ico}<span class="ft-name" title="${esc(name)}">${esc(name)}${nameTail}</span>${num}${tag ? `<span class="ft-tag">${esc(tag)}</span>` : ''}${off ? '<span class="ft-offtag">끔</span>' : ''}`})
    + `${after}${more ? ftMoreButtonHtml(more) : ''}</div>`;
}

// NOTE-폴더디자인통일(S70-82, 명진 11/26 09:27 "노트메뉴 안에 보드쪽, 폴더쪽 디자인이 살짝 달라 … 파일쪽에 맞춰서"): 폴더 안 항목(노트 등) 줄 한 곳.
// 폴더 줄과 같은 들여쓰기·글자·누름 모양(.ft-main), 높이는 하위 폴더 줄과 같은 --ft-sub-h(좁은 왼쪽 나무), 이름은 폴더 그림 자리만큼 들여 폴더 이름과 줄이 맞는다.
//  name·title(이름 칸 마우스 올림 = 전체 이름, 표준 L2)·depth·tail(이름 뒤 작은 글자 HTML — 부르는 쪽이 이스케이프한 것)·rowAttrs·mainAttrs·more(⋯)
//  current(지금 연 것)·picked(고른 줄, [파일]과 같은 표시)·off(고를 수 없음: 흐리게)·pressed(고르기 창의 aria-pressed, null이면 없음)·className.
export function ftItemRowHtml({name, title = name, depth = 0, tail = '', rowAttrs = {}, mainAttrs = {}, more = null, current = false, picked = false, off = false, pressed = null, className = ''}) {
  const cls = ['ft-row', 'ft-item', 'ft-leaf', current ? 'ft-current' : '', picked ? 'ft-picked' : '', off ? 'ft-off' : '', className].filter(Boolean).join(' ');
  return `<div class="${cls}"${attrsHtml(rowAttrs)} style="--ft-depth:${ftDepth(depth)}">`
    + ftMainHtml({attrs:`${attrsHtml(mainAttrs)}${pressed === null ? '' : ` aria-pressed="${!!pressed}"`}${off ? ' aria-disabled="true"' : ''}${current ? ' aria-current="true"' : ''}`,
      inner:`<span class="ft-name" title="${esc(title)}">${esc(name)}</span>${tail}`})
    + `${more ? ftMoreButtonHtml(more) : ''}</div>`;
}

// 'n개 더 보기' 줄(펼친 폴더 안 파일이 FT_PREVIEW개를 넘을 때). attrs: 누르면 그 폴더를 다 보이게 하는 data 이름과 값.
// UI-폴더줄크기(S69-99): 전의 두 손가락 안내(' · 두 손가락 벌리면 이 폴더만')는 없앴다 — 두 손가락은 줄 크기, 들어가기는 ⋯로만.
export function ftMoreRowHtml({rest, depth = 1, attrs = {}} = {}) {
  return `<button type="button" class="ft-btn ft-row ft-more-row"${attrsHtml(attrs)} style="--ft-depth:${ftDepth(depth)}">${esc(rest)}개 더 보기</button>`;
}

// UI-폴더이름펼치기(명진 11/24 18:09): 그 자리 펼치는 목록에서 빈 폴더를 펼치면 그 아래 '빈 폴더' 한 줄(들어가지 않는다). attrs: 그 화면의 표시(예 data-ft-parent).
export function ftEmptyRowHtml({depth = 1, attrs = {}} = {}) {
  return `<div class="ft-row ft-item ft-empty-row"${attrsHtml(attrs)} style="--ft-depth:${ftDepth(depth)}">${emptyHtml('빈 폴더')}</div>`;
}

// 휴지통 줄(상자 맨 아래 회색). count 없으면 숫자 없음.
// S69-27: current = 지금 고른 줄(PC 나무 표시), tree = 나무 안 줄(role treeitem), countLabel = 숫자 읽는 말. 다른 사용처는 기본값 그대로.
export function ftTrashRowHtml({count = null, attrs = {}, label = '휴지통', current = false, tree = false, countLabel = ''} = {}) {
  const icon = '<span class="ft-ico ft-ico-trash" aria-hidden="true"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></span>';
  return `<div class="ft-row ft-trash ft-top${current ? ' ft-current' : ''}"${tree ? ' role="treeitem"' : ''}><button type="button" class="ft-btn ft-main"${attrsHtml(attrs)}${current ? ' aria-current="true"' : ''}>${icon}<span class="ft-name">${esc(label)}</span>${count === null || count === undefined || count === '' ? '' : `<span class="ft-num"${countLabel ? ` aria-label="${esc(countLabel)}"` : ''}>${esc(count)}</span>`}</button></div>`;
}

// 둥근 상자. head: 머리줄 HTML(없으면 머리 없음), body: 안 줄들. collapsible이면 머리가 접기 단추(toggleAttrs로 누름을 받는다).
// open=false면 안 줄을 그리지 않는다(머리만). tail: 머리 오른쪽 작은 글자('맞추는 중'·'더보기' 단추 등).
// caret: 이름 바로 옆 공용 꺾쇠(⌃ 펼침·⌄ 접힘, UI-접기꺾쇠 S51-33)로 접기를 보인다('최근' 상자, S51-22). 머리 줄 아무 데나 누르면 접기.
// 접으면 tail(더보기)도 숨는다. 꺾쇠는 접기 단추 안 이름 뒤에 붙고, '더보기 ›'는 오른쪽 글자 단추로 따로 있다.
export const ftCaretHtml = open => chevHtml(open, 'ft-box-caret');
export function ftBoxHtml({head = '', body = '', open = true, collapsible = false, caret = false, toggleAttrs = {}, tail = '', attrs = {}, label = ''} = {}) {
  const headHtml = !head ? '' : collapsible
    ? `<div class="ft-box-head"><button type="button" class="ft-btn ft-box-toggle"${attrsHtml(toggleAttrs)} aria-expanded="${!!open}">${head}${caret ? ftCaretHtml(open) : open ? '' : '<span class="ft-box-folded">접힘</span>'}</button>${caret && !open ? '' : tail}</div>`
    : `<div class="ft-box-head"><span class="ft-box-title">${head}</span>${tail}</div>`;
  return `<section class="ft-box${open ? '' : ' ft-box-closed'}"${attrsHtml(attrs)}${label ? ` aria-label="${esc(label)}"` : ''}>${headHtml}${open ? `<div class="ft-box-body">${body}</div>` : ''}</section>`;
}

// 펼친 폴더에 보일 파일만 자르기: 다 보기(all)가 아니면 처음 FT_PREVIEW개, 나머지 수.
export function ftLimit(list, all = false, limit = FT_PREVIEW) {
  const items = Array.isArray(list) ? list : [];
  if (all || items.length <= limit) return {shown: items, rest: 0};
  return {shown: items.slice(0, limit), rest: items.length - limit};
}

// S51-24 FOLDER-그폴더만같은모양(요청함 11/06 21:52, 시안 docs/design/mockups/folder-focus-continuity.html ②):
// '그 폴더만' 화면도 나무와 같은 둥근 상자·같은 줄. 상자 맨 위 작은 회색 위치 줄(누르면 그 단계), 그 아래 머리 = 열린 폴더 그림 + 굵은 이름 + 개수.
// 돌아가기 글자·단추('나무로' 등)는 두지 않는다. [‹]는 위치 줄 맨 앞의 작은 꺽쇠(back: 속성, 없으면 없음).
//  trail: [{label, attrs}] 위 단계(맨 앞 = 저장소·화면 이름), lead: 위치 줄 맨 앞 그림(저장소 로고 등), name·color·count, body: 안 줄(ft 줄 또는 격자).
// icon: 폴더 아이콘 대신 그릴 아이콘 HTML(폴더가 아닌 자리 — 노트 '밑줄'·'보관한 글', S62-17). 없으면 폴더 아이콘.
export function ftFocusHtml({back = null, backLabel = '폴더 나무', lead = '', trail = [], name = '', color = null, count = '', body = '', attrs = {}, icon = ''} = {}) {
  return `<section class="ft-box ft-focus"${attrsHtml(attrs)} aria-label="${esc(name)}">${ftFocusTopHtml({back, backLabel, lead, trail, name, color, count, icon})}<div class="ft-box-body">${body}</div></section>`;
}
// '그 폴더만' [‹] 하나(파일·노트·사진·자료실 같은 단추). attrs: 화면이 누르기를 알아보는 표시.
export function ftFocusBackHtml(attrs, label = '폴더 나무') {
  return attrs ? `<button type="button" class="ft-btn ft-focus-back"${attrsHtml(attrs)} aria-label="${esc(label)}" title="${esc(label)}">‹</button>` : '';
}
// 상자 위쪽만(위치 줄 + 머리): 상자 몸통을 그 화면이 따로 그리는 곳(자료실 목록 상자·사진 격자)에서 상자 맨 위에 넣는다.
// FILES-폰폴더위로 ②: [‹]는 지금 폴더 이름과 같은 줄 맨 앞(누르는 자리 44px), 위치 줄은 그 위 작은 회색 줄(누르면 그 단계).
// backLabel: '위 폴더'(한 단계 위가 있을 때) 또는 '폴더 나무'(folder-walk.mjs walkUpLabel).
export function ftFocusTopHtml({back = null, backLabel = '폴더 나무', lead = '', trail = [], name = '', color = null, count = '', icon = ''} = {}) {
  const steps = (trail || []).map(t => `<button type="button" class="ft-btn ft-focus-step"${attrsHtml(t.attrs)}>${esc(t.label)}</button><span class="ft-focus-sep" aria-hidden="true">›</span>`).join('');
  return `<nav class="ft-focus-anc" aria-label="지금 위치">${lead}${steps}</nav>`
    + `<div class="ft-focus-head">${ftFocusBackHtml(back, backLabel)}${icon || ftIconHtml({color, open: true})}<span class="ft-focus-name">${esc(name)}</span>${count ? ` <span class="ft-num">${esc(count)}</span>` : ''}</div>`;
}
// 상자 머리 개수: '폴더 1 · 파일 3'(없는 쪽은 뺀다). fileWord: 화면마다 '파일'·'노트'·'사진'.
// LIB-폴더개수: 글자는 폴더 줄 개수와 같은 한 곳(folder-count.mjs).
export function ftFocusCount(folders = 0, files = 0, fileWord = '파일') {
  return folderFileText(folders, files, {fileWord, alone: n => n > 0 ? `${fileWord} ${countText(n)}` : ''});
}

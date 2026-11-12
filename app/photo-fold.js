// LIB-사진숨김(S60-10): '사진 n' 단추와 작은 그림 칸의 공용 모양(담당조직·프로젝트 [자료], 자료실). 판정·나누기는 photo-fold-model.mjs.
// - 단추는 그리는 화면이 가진 상태(펼침 여부)를 aria-expanded로 보일 뿐이다. 상태 주인은 그 화면 하나(app/ARCHITECTURE.md 5절).
// - 작은 그림 칸 하나 = 그림(누르면 크게 보기) + 지금 그 자료의 ⋯ 메뉴. PC 우클릭은 공용 context-menu.js가 칸 안 ⋯ 하나를 누르고,
//   폰 꾹 누르기(브라우저 contextmenu)는 bindPhotoTileMenus가 같은 ⋯를 누른다.
// - 그림은 자료실 작은 그림 길(library-photo.js hydrateLibraryThumbs, 소유자 로그인·Drive 읽기만)로 받는다. 기기 저장 없음.
import {docKindBadge, pictureCountLabel} from './photo-fold-model.mjs';
import {chevHtml} from './fold-chevron.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

// 자료 줄의 작은 종류 표시(한글·PDF …). 모르면 ''.
export function docKindHtml(doc) {
  const b = docKindBadge(doc);
  return b ? `<span class="file-kind doc-kind-badge" data-kind="${b.tone}" data-doc-kind="${esc(b.key)}">${esc(b.label)}</span>` : '';
}

// '사진 n' 단추. attrs = 그리는 화면이 누르기를 찾는 속성 문자열(예: ' data-wd-photos').
export function photoToggleHtml(count, {open = false, attrs = '', controls = '', cls = ''} = {}) {
  return `<button type="button" class="ds-chip photo-fold-toggle${cls ? ' ' + cls : ''}" aria-expanded="${open ? 'true' : 'false'}"${controls ? ` aria-controls="${esc(controls)}"` : ''}${attrs}>${esc(pictureCountLabel(count))}${chevHtml(open)}</button>`;
}

// 작은 그림 칸들. tile(doc) → {main: 누르는 그림 요소의 여는 태그 속성, menu: 그 자료 ⋯ 메뉴 HTML}. 그림 칸은 .lu-thumb[data-lu-thumb](자료실 작은 그림 길).
export function photoTilesHtml(docs, tile, {id = '', label = '사진'} = {}) {
  const cells = (docs || []).map(doc => {
    const t = tile(doc) || {}, name = doc.title || doc.file_name || '사진';
    return `<div class="photo-fold-tile" data-photo-tile="${esc(doc.id)}"><button type="button" class="icon-btn photo-fold-thumb lu-thumb" data-lu-thumb="${esc(doc.id)}" aria-label="${esc(name)} 크게 보기" title="${esc(name)}"${t.attrs || ''}></button>${t.menu || ''}</div>`;
  }).join('');
  return `<div class="photo-fold-tiles"${id ? ` id="${esc(id)}"` : ''} role="group" aria-label="${esc(label)}">${cells}</div>`;
}

// 폰 꾹 누르기(contextmenu, 761px 아래): 그 칸의 ⋯를 누른다. PC 넓은 화면은 공용 우클릭(context-menu.js)이 맡는다.
const bound = new WeakSet();
const WIDE = typeof matchMedia === 'function' ? matchMedia('(min-width:761px)') : null;
export function bindPhotoTileMenus(host) {
  if (!host || bound.has(host)) return;
  bound.add(host);
  host.addEventListener('contextmenu', e => {
    const tile = e.target.closest?.('[data-photo-tile]');
    if (!tile || !host.contains(tile) || WIDE?.matches) return;
    const more = tile.querySelector('details > summary, [data-lu-menu], [data-fx-tmenu]');
    if (!more) return;
    e.preventDefault();
    window.KPTUContextMenu?.pinAt?.(more, e.clientX, e.clientY);
    more.click();
  });
}

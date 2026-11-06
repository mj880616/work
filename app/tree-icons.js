// 공용 아이콘 한 곳(S50-20 FOLDER-나무아이콘 → S51-25 LIB-폴더밖아이콘): 화면의 작은 아이콘은 모두 이 파일의 SVG를 쓴다.
// 그림 문자(이모지 📁📂📄🗂🕒📌📍📷🔍🖼📎 등)는 기기·글꼴마다 모양이 달라지거나 PC에서 검은 덩어리로 뭉개지므로 화면 아이콘으로 쓰지 않는다
// (글 내용 안의 이모지는 그대로). 색은 currentColor라 부르는 쪽 CSS 글자색을 따른다.
// 나무 줄 앞: 최근 = 시계, 별표 = 별, 큰 파일 = 문서, 폴더 밖 = 회색 점선 폴더, 원드라이브·구글 드라이브 = 출처 로고(brand-icons.js),
// 폴더 = 폴더 그림(색을 고른 폴더는 그 색, 안 고른 폴더는 기본 노랑 — folder-look.js 하나). 글자 크기·줄 간격은 바꾸지 않는다.
import {brandIconSvg} from './brand-icons.js';
import {folderIconHtml} from './folder-look.js';
import {FOLDER_SHAPE} from './folder-look-model.mjs';

const S = 'fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"';
// 이름 → 16칸 viewBox 안 그림. 선 그림은 S, 채운 그림은 fill.
const PATHS = Object.freeze({
  // 폴더(색 없는 기본 그림 — 글 줄 안 '이름 폴더' 표시용. 나무 줄의 폴더는 아래 treeIconHtml('folder')가 색까지 입힌다).
  folder: FOLDER_SHAPE.closed.replace('<path ', '<path fill="currentColor" '),
  clock: `<circle cx="8" cy="8" r="6.2" ${S}/><path d="M8 4.6V8l2.4 1.6" ${S}/>`,
  doc: `<path d="M4 1.8h5.2L12.5 5v9.2H4z" ${S}/><path d="M9 1.8V5.2h3.4M6 8.4h4.5M6 11h4.5" ${S}/>`,
  // 폴더 밖: 회색 점선 테두리 폴더(요청함 11/06 14:45 '가' 확정).
  outside: '<path d="M1.8 4.4c0-.6.5-1.1 1.1-1.1h2.9c.3 0 .6.1.8.3l.9.9h5.6c.6 0 1.1.5 1.1 1.1v6.4c0 .6-.5 1.1-1.1 1.1H2.9c-.6 0-1.1-.5-1.1-1.1z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2 1.6" stroke-linejoin="round"/>',
  star: '<path d="M8 1.6l1.9 4 4.3.5-3.2 2.9.9 4.3L8 11.1l-3.9 2.2.9-4.3-3.2-2.9 4.3-.5z" fill="currentColor"/>',
  starLine: `<path d="M8 1.6l1.9 4 4.3.5-3.2 2.9.9 4.3L8 11.1l-3.9 2.2.9-4.3-3.2-2.9 4.3-.5z" ${S}/>`,
  pin: `<path d="M6 1.8h4l-.6 4.2 2.4 2.4H4.2l2.4-2.4z" ${S}/><path d="M8 8.4v5.8" ${S}/>`,
  place: `<path d="M8 14.4s4.6-4.4 4.6-8A4.6 4.6 0 0 0 3.4 6.4c0 3.6 4.6 8 4.6 8z" ${S}/><circle cx="8" cy="6.4" r="1.6" ${S}/>`,
  search: `<circle cx="7" cy="7" r="4.4" ${S}/><path d="M10.3 10.3l3.6 3.6" ${S}/>`,
  camera: `<path d="M2 5.2c0-.6.5-1.1 1.1-1.1h1.8l1-1.6h4.2l1 1.6h1.8c.6 0 1.1.5 1.1 1.1v7c0 .6-.5 1.1-1.1 1.1H3.1c-.6 0-1.1-.5-1.1-1.1z" ${S}/><circle cx="8" cy="8.6" r="2.4" ${S}/>`,
  clip: `<path d="M10.8 5.2l-4.6 4.6a1.4 1.4 0 0 0 2 2l5-5a2.8 2.8 0 0 0-4-4l-5 5a4.2 4.2 0 0 0 6 6l4.2-4.2" ${S}/>`,
  image: `<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.4" ${S}/><circle cx="5.6" cy="6.4" r="1.2" ${S}/><path d="M2.4 12l3.8-3.6 2.4 2.2 2-1.8 3.2 3" ${S}/>`,
  warn: `<path d="M8 2.2l6.2 11H1.8z" ${S}/><path d="M8 6.6v3M8 11.6v.1" ${S}/>`,
  play: '<path d="M5 3.2v9.6l7.6-4.8z" fill="currentColor"/>',
  note: `<path d="M6.4 12.2V3.4l6.4-1.4v8.6" ${S}/><circle cx="4.8" cy="12.2" r="1.7" fill="currentColor"/><circle cx="11.2" cy="10.6" r="1.7" fill="currentColor"/>`,
  pc: `<rect x="1.5" y="2.5" width="13" height="8.5" rx="1.2" ${S}/><path d="M5.5 13.5h5M8 11v2.5" ${S}/>`,
  phone: `<rect x="4" y="1.5" width="8" height="13" rx="1.6" ${S}/><circle cx="8" cy="12.2" r=".8" fill="currentColor"/>`,
});
export const ICON_NAMES = Object.freeze(Object.keys(PATHS));

// 그림 하나(svg 글자). 모르는 이름은 빈 글자.
export function iconSvg(name, {size = 14} = {}) {
  const p = PATHS[name];
  return p ? `<svg class="ui-ico-svg" width="${size}" height="${size}" viewBox="0 0 16 16" focusable="false" aria-hidden="true">${p}</svg>` : '';
}
// 글자 줄 안에 넣는 아이콘(span.ui-ico). 뜻은 옆 글자나 버튼 aria-label이 전하므로 아이콘은 읽기 프로그램에서 숨긴다.
export function iconHtml(name, {size = 14, className = ''} = {}) {
  const svg = iconSvg(name, {size});
  return svg ? `<span class="ui-ico ui-ico-${name}${className ? ' ' + className : ''}" aria-hidden="true">${svg}</span>` : '';
}
// DOM 쪽(innerHTML을 쓰지 않는 화면): 같은 아이콘을 요소로.
export function iconNode(name, opts = {}) {
  const t = document.createElement('template');
  t.innerHTML = iconHtml(name, opts);
  return t.content.firstChild || document.createTextNode('');
}

const TREE = Object.freeze({recent: 'clock', big: 'doc', outside: 'outside', starred: 'star', pc: 'pc', ph: 'phone'});
const BRAND = Object.freeze({od: 'onedrive', gd: 'gdrive'});

// kind: 'recent' | 'starred' | 'big' | 'outside' | 'od' | 'gd' | 'ph' | 'pc' | 'folder'. folder는 row(색 color 1~8)와 open을 받는다.
export function treeIconHtml(kind, {row = null, open = false, className = 'nx-ico'} = {}) {
  if (kind === 'folder') return folderIconHtml(row || {}, {open, className});
  if (BRAND[kind]) return `<span class="${className} tree-ico-brand" aria-hidden="true">${brandIconSvg(BRAND[kind], {size: 14})}</span>`;
  const name = TREE[kind];
  if (!name) return '';
  const tone = kind === 'starred' ? 'tree-ico-star' : kind === 'outside' ? 'tree-ico-outside' : 'tree-ico-brand';
  return `<span class="${className} ${tone}" aria-hidden="true">${iconSvg(name, {size: 15})}</span>`;
}

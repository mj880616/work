// S50-20 FOLDER-나무아이콘: 왼쪽 나무 줄 앞 아이콘 한 곳(파일·자료실·노트 나무가 함께 쓴다).
// 최근 = 시계, 별표 = 노란 별, 큰 파일 = 문서, 원드라이브·구글 드라이브 = 위 줄 출처 단추와 같은 로고(brand-icons.js),
// 폴더 = 폴더 아이콘(색을 고른 폴더는 그 색, 안 고른 폴더는 지금의 노란 폴더 — folder-look.js 하나). 글자 크기·줄 간격은 바꾸지 않는다.
import {brandIconSvg} from './brand-icons.js';
import {folderIconHtml} from './folder-look.js';

const EMOJI = Object.freeze({recent: '\u{1F552}', big: '\u{1F4C4}', outside: '\u{1F5C2}'});
const BRAND = Object.freeze({od: 'onedrive', gd: 'gdrive'});
const PC_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="8.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 13.5h5M8 11v2.5" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>';
const PHONE_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="1.5" width="8" height="13" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="12.2" r=".8" fill="currentColor"/></svg>';

// kind: 'recent' | 'starred' | 'big' | 'outside' | 'od' | 'gd' | 'ph' | 'pc' | 'folder'. folder는 row(색 color 1~8)와 open을 받는다.
export function treeIconHtml(kind, {row = null, open = false, className = 'nx-ico'} = {}) {
  if (kind === 'folder') return folderIconHtml(row || {}, {open, className});
  if (kind === 'starred') return `<span class="${className} tree-ico-star" aria-hidden="true">★</span>`;
  if (BRAND[kind]) return `<span class="${className} tree-ico-brand" aria-hidden="true">${brandIconSvg(BRAND[kind], {size: 14})}</span>`;
  if (kind === 'ph') return `<span class="${className} tree-ico-brand" aria-hidden="true">${PHONE_SVG}</span>`;
  if (kind === 'pc') return `<span class="${className} tree-ico-brand" aria-hidden="true">${PC_SVG}</span>`;
  const e = EMOJI[kind];
  return e ? `<span class="${className}" aria-hidden="true">${e}</span>` : '';
}

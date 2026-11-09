// 노트 폴더 나무의 줄 하나(폴더 줄 / 노트 줄) HTML — 노트 보드 노트 고르기(note-boards.js)와 잊지 말기 [노트] 창의 노트 고르기(note-pick.js)가
// 같이 쓰는 부품. 줄 재료는 note-tree.mjs treeRows·recentRows, 모양은 basket.css의 .nbb-pick 줄(.nbb-folder·.nbb-note).
import {treeIconHtml} from './tree-icons.js';
import {noteLineTitle, OUTSIDE_NAME} from './note-tree.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
// 노트 보드 노트 고르기와 같은 줄 한 줄(폴더 줄 / 노트 줄). folderAttr·noteAttr: 줄의 data- 이름. check: 고르기 표시 칸(✓).
// pressed: aria-pressed 값(없으면 붙이지 않음), off: 고를 수 없음, current: 지금 고른 노트, tag: 오른쪽 작은 글(최근 노트의 폴더 이름).
export function noteTreeRowHtml(r, {esc: e = esc, folderAttr, noteAttr, check = false, pressed = null, off = false, current = false, tag = ''} = {}) {
  if (r.type !== 'note') {
    const outside = r.type === 'outside';
    return `<button type="button" class="nbb-folder" data-${folderAttr}="${e(r.id)}" aria-expanded="${!!r.open}" style="--nx-indent:${r.indent}">${treeIconHtml(outside ? 'outside' : 'folder', {row: r, open: !!r.open, className: 'nbb-caret'})}<span class="nbb-name">${e(outside ? OUTSIDE_NAME : r.name)}</span><span class="nbb-num">${r.count}</span></button>`;
  }
  const title = [...noteLineTitle(r.note)].slice(0, 60).join('');
  return `<button type="button" class="nbb-note${off ? ' nbb-on' : ''}" data-${noteAttr}="${e(r.note.id)}"${pressed === null ? '' : ` aria-pressed="${pressed}"`}${off ? ' aria-disabled="true"' : ''}${current ? ' aria-current="true"' : ''} style="--nx-indent:${r.indent}">${check ? `<span class="nbb-check" aria-hidden="true">${pressed ? '✓' : ''}</span>` : ''}<span class="nbb-name">${e(title)}</span>${tag ? `<span class="nbb-num">${e(tag)}</span>` : ''}</button>`;
}


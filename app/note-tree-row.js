// 노트 폴더 나무의 줄 하나(폴더 줄 / 잠긴 폴더 줄 / 노트 줄) HTML — 노트 [보드] 왼쪽 '노트 목록'(note-boards.js), 폰 보드 [+ 노트 붙이기] 고르기 창,
// 잊지 말기 [노트] 창의 노트 고르기(note-pick.js)가 같이 쓰는 부품. 줄 재료는 note-tree.mjs treeRows·recentRows.
// NOTE-폴더디자인통일(S70-82, 사용자 11/26 09:27 "노트메뉴 안에 보드쪽, 폴더쪽 디자인이 살짝 달라 이걸 통일해야함. 파일쪽에 맞춰서"):
// 모양은 [파일]·노트 [폴더] 나무와 같은 공용 줄(folder-tree-ui.mjs ftFolderRowHtml·ftItemRowHtml, folder-tree.css .ft-*) 하나다.
// 전의 노트 전용 줄(.nbb-folder·.nbb-note — 26px/32px 줄, 오른쪽 끝 개수, 잠긴 폴더 큰 [풀기] 단추)은 지웠다.
// 누르기·끌기가 알아보는 data 이름(folderAttr·noteAttr·lockAttr)은 줄 단추(.ft-main)에, 끌기 순서 표시(data-reorder-id)는 줄(.ft-row)에 붙는다.
import {treeIconHtml} from './tree-icons.js';
import {noteLineTitle, OUTSIDE_NAME} from './note-tree.mjs';
import {ftFolderRowHtml, ftItemRowHtml} from './folder-tree-ui.mjs';

export const LOCKED_TAG = '잠김';
const titleOf = note => [...noteLineTitle(note)].slice(0, 60).join('');

// 잠겨 가려진 폴더 줄: 다른 폴더 줄과 같은 높이·글자·닫힌 폴더 그림, 개수 자리(.ft-num — 좁은 칸에서도 이름 다음까지 남는 자리)에 작은 '잠김'.
// 펼치기·개수·끌어 놓기 없음. 줄을 누르면 다른 화면의 '잠김' 줄과 같은 그 자리 PIN 창(feature-lock.js data-lock-here 한 곳).
export function lockedFolderRowHtml(r, {lockAttr}) {
  return ftFolderRowHtml({name:r.name, count:LOCKED_TAG, depth:r.depth || 0, hasContent:false, className:'nx-locked-folder',
    color:r.color, mainAttrs:{[`data-${lockAttr}`]:r.id, 'data-lock-here':'notes', 'aria-label':`${r.name} 잠김 — 눌러서 풀기`}});
}

// 폴더 줄 / 노트 줄. folderAttr·noteAttr: 줄 단추의 data 이름. reorder: 줄에 끌기 순서 표시(data-reorder-id = f:폴더 · n:노트)를 붙일까.
// pressed: 고르기 창의 aria-pressed(없으면 null), off: 고를 수 없음(이미 붙은 노트 — 흐리게), current: 지금 고른 노트, tag: 이름 뒤 작은 글(최근 노트의 폴더 이름),
// on: 보드에 이미 있음(작은 점 + 읽기 프로그램 글), draggable: 노트 줄 단추의 끌기('true'/'false', 없으면 붙이지 않음).
export function noteTreeRowHtml(r, {folderAttr, noteAttr, pressed = null, off = false, current = false, tag = '', reorder = false, on = false, draggable = null} = {}) {
  if (r.type !== 'note') {
    const outside = r.type === 'outside';
    return ftFolderRowHtml({name:outside ? OUTSIDE_NAME : r.name, count:r.count, countLabel:`노트 ${r.count}개`, depth:r.depth || 0, open:!!r.open, hasContent:r.hasContent !== false,
      color:outside ? null : r.color, className:outside ? 'nx-outside' : 'nx-folder', icon:outside ? treeIconHtml('outside', {className:'ft-ico'}) : null,
      rowAttrs:reorder ? {'data-reorder-id':`f:${r.id}`} : {}, mainAttrs:{[`data-${folderAttr}`]:r.id}});
  }
  const name = titleOf(r.note);
  const tail = (tag ? `<span class="ft-num">${escText(tag)}</span>` : '') + (on ? '<span class="ft-on-dot" aria-hidden="true"></span><span class="a11y-only">보드에 있음</span>' : '');
  return ftItemRowHtml({name, title:noteLineTitle(r.note), depth:r.depth || 0, tail, pressed, off, current, className:'nx-leaf',
    rowAttrs:reorder ? {'data-reorder-id':`n:${r.note.id}`} : {},
    mainAttrs:{[`data-${noteAttr}`]:r.note.id, ...(on ? {'data-nbb-on':true} : {}), ...(draggable === null ? {} : {draggable:String(draggable)})}});
}
const escText = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

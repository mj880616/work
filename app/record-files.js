// ORG-기록첨부(S50-22): a linked record's pictures and files, right under its line in an organization's or a project's record list.
// Pictures show small (owner-only basket-files photo view, the 정리함's own path — never a public address) and open large when
// pressed; other files are a name line that opens by kind (file-actions.js pressFile, as the 정리함 does). It reads nothing itself:
// the rows come from readLinkRecords({withFiles:true}) (the note's attachments in the same read).
import { photoElement } from './diary-data.js';
import { openPhotoView } from './photo-view.js';
import { pressFile } from './file-actions.js';
import { attachmentName } from './attachment-name.mjs';
import { fileKind } from './meeting-compact.js';
import { isPictureFile, splitPictures } from './photo-fold-model.mjs';
import { renameHostAttrs, renameButtonHtml, renameMenuAttrs, applyRenamed } from './file-rename.js';
import { menuItemsHtml, fileAttrs } from './file-actions.js';
import { bindPhotoTileMenus } from './photo-fold.js';
import {partStyles} from './part-styles.js';
import { recordLocked } from './basket-link-records.js';
// S67-41: 이 부품의 모양 파일(part-styles.js 표)을 부품이 열리기 전에 붙인다 — 화면 모양 목록에 없어도 꾸밈 없이 그려지지 않게.
await partStyles('record-files');

const SHOWN = 6, THUMBS = 3;
const PHOTO = /^image\/(jpeg|png|webp|gif)$/i;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
// S69 보드잠금가림 전수: 잠긴 폴더 노트의 연결 기록은 사진·파일 띠를 그리지 않는다(이름·그림도 노트 내용).
const filesOf = row => (recordLocked(row) || row?.locked ? [] : Array.isArray(row?.attachments) ? row.attachments : []).filter(f => /^[A-Za-z0-9_-]{1,255}$/.test(String(f?.drive_file_id || '')));
const isPhoto = file => PHOTO.test(String(file?.mime_type || ''));

// 사진은 파일 이름 줄로 늘어놓지 않고 작은 정사각 그림 줄(UI-기록카드하나로 S70-42 — 그 전 LIB-사진숨김의 접는 [사진 n]을 바꿈).
// 누르면 크게 보기. 사진 판정은 [파일]과 같은 공용 판정(photo-fold-model.mjs isPictureFile = files-model.mjs kindOf).
// 작은 그림은 기존 첨부 읽기 길(diary-data.js photoElement, 주인만 읽는 basket-files 'small')로만 받는다 — 새 저장소·기기 저장 없음.
const isPicture = file => isPhoto(file) || isPictureFile({name: attachmentName(file), mime: file?.mime_type});
// ORG-기록첨부이름반영(S60-14): 띠의 파일·사진 이름도 그 자리에서 고친다(공용 부품 file-rename.js 그대로, [AI 이름] 포함).
// - 파일 줄(⋯ 없음): 이름 끝 작은 ✎, PC 이름 두 번 누르기, 폰 이름 꾹 누르기.
// - 사진 칸: 칸 오른쪽 위 ⋯(PC 우클릭·폰 꾹 누르기도 같은 ⋯ — 자료 사진 칸과 같은 photo-fold 길) 안 [Drive에서 열기][내려받기][이름 수정].
//   [이름 수정]은 그 칸의 이름 자리(평소에는 화면에 보이지 않는 이름 글자)를 고치는 칸으로 바꾼다.
// open: [+n]을 눌러 편 것처럼 사진을 모두 그린다(이름을 바꾼 뒤 그 기록만 다시 그릴 때 그대로 두려고 — 저장하지 않음).
const specOf = (row, file) => ({target:'note', id:String(row?.note_id || ''), driveId:String(file?.drive_file_id || ''), name:String(file?.file_name || '')});
export function recordFilesHtml(row, {open = false} = {}) {
  const files = filesOf(row);
  if (!files.length) return '';
  const note = esc(row.note_id), {rest, pictures} = splitPictures(files, isPicture), more = rest.length - SHOWN;
  const items = rest.slice(0, SHOWN).map(file => {
    const id = esc(file.drive_file_id), name = esc(attachmentName(file)), spec = specOf(row, file);
    const kind = fileKind(attachmentName(file));
    return `<span class="record-file" data-fr-row><button type="button" class="record-file-name" data-record-file="${id}" data-record-note="${note}" aria-label="${name} 열기"${renameHostAttrs(spec)}><span class="file-kind" data-kind="${esc(kind.key)}" aria-hidden="true">${esc(kind.label)}</span><span class="record-file-text">${name}</span></button>${renameButtonHtml(spec)}</span>`;
  }).join('');
  const thumbs = pictures.map((file, i) => {
    const id = esc(file.drive_file_id), name = esc(attachmentName(file)), spec = specOf(row, file);
    const fa = {name:attachmentName(file), mime:String(file.mime_type || ''), driveId:String(file.drive_file_id || '')};
    const menu = `<details class="record-photo-more"><summary class="icon-btn" aria-label="사진 관리: ${name}"><span class="more-dots" aria-hidden="true">⋯</span></summary><div class="record-photo-panel" role="group" aria-label="사진 관리">${menuItemsHtml(fa, {attrs:fileAttrs(fa), attr:'data-fa-menu', rename:renameMenuAttrs(spec)})}</div></details>`;
    return `<div class="photo-fold-tile record-photo" data-photo-tile="${id}" data-fr-row${!open && i >= THUMBS ? ' hidden' : ''}><button type="button" class="record-file-thumb" data-record-photo="${id}" data-record-note="${note}" aria-label="${name} 크게 보기" title="${name}"></button><span class="record-photo-name"${renameHostAttrs(spec)}>${name}</span>${menu}</div>`;
  }).join('');
  // UI-기록카드하나로(S70-42, 명진 11/25 "사진은 차라리 썸네일을 보여주던가"): 접는 [사진 n] 줄 대신 작은 정사각 그림을 바로 가로로(앞 THUMBS=3장 — 폰 폭에서도 옆 한 줄 글이 보이게),
  // 넘치면 [+n](누르면 이 화면 메모리에서만 나머지를 편다). 사진만 있는 기록(data-record-only-photos)은 그림 옆에 기록 한 줄(말줄임 — 자동 줄이면 '그림 1장 · 파일 이름').
  const hiddenCount = open ? 0 : Math.max(0, pictures.length - THUMBS);
  const photos = pictures.length ? `<div class="record-photos" data-record-photos="${note}"${open || !hiddenCount ? ' data-all' : ''}><div class="record-photo-thumbs">${thumbs}${hiddenCount ? `<button type="button" class="ds-chip record-photos-more" data-record-photos-more aria-label="사진 ${hiddenCount}장 더 보기">+${hiddenCount}</button>` : ''}</div></div>` : '';
  return `<div class="record-files" data-record-files="${note}"${rest.length ? '' : ' data-record-only-photos'}>${items}${more > 0 ? `<span class="record-files-more">외 ${more}개</span>` : ''}${photos}</div>`;
}

// ORG-기록첨부이름반영: 이름 바뀜 알림('kptu:file-renamed')을 그 화면이 들고 있는 기록 줄들(rows)에 반영한다. 바뀐 줄의 id 목록.
export function renameInRecordRows(rows, detail) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) if (applyRenamed(row?.attachments, detail)) out.push(row.id);
  return out;
}
// 바뀐 줄 글('kptu:record-lines-renamed', record-name-sync.js)을 rows에 반영한다. 옛 글이 그대로인 줄만 바꾼다. 바뀐 줄의 id 목록.
export function applyRenamedLines(rows, links) {
  const out = [];
  for (const link of Array.isArray(links) ? links : []) {
    const row = (Array.isArray(rows) ? rows : []).find(r => r?.id === link?.id);
    if (row && row.summary === link.before) { row.summary = link.summary; out.push(row.id); }
  }
  return out;
}
// 기록 한 줄(el)을 다시 그리기 전에 [+n]으로 사진을 모두 펴 두었는지(다시 그려도 편 채로 — 저장하지 않음).
export const recordPhotosOpen = el => !!el?.querySelector?.('[data-record-photos][data-all]');

// Small pictures for the strips now in host (call after the list is drawn). Pictures behind [+n] wait until it is pressed.
export function paintRecordFiles(host, rows, rt = window.KPTURuntime) {
  if (!host) return;
  for (const thumb of host.querySelectorAll('[data-record-photo]')) {
    if (thumb.childElementCount) continue;
    if (thumb.closest('[hidden]')) continue;
    const row = rows.find(r => r.note_id === thumb.dataset.recordNote), file = filesOf(row).find(f => f.drive_file_id === thumb.dataset.recordPhoto);
    if (row && file) thumb.append(photoElement({id:row.note_id}, file, 'small', {label:'', link:false, rt, retry:false}));
  }
}

// One click listener per host: a picture opens large, a file opens by its kind. getRows() gives the rows drawn now.
const bound = new WeakSet();
export function bindRecordFiles(host, getRows, {rt = window.KPTURuntime, onError = () => {}} = {}) {
  if (!host || bound.has(host)) return;
  bound.add(host);
  bindPhotoTileMenus(host); // 폰 꾹 누르기 = 사진 칸 ⋯ (PC 우클릭은 공용 context-menu.js)
  // 사진 칸 ⋯ 판 자리 맞추기(toggle은 거품이 없어 잡기 단계에서 듣는다).
  host.addEventListener('toggle', e => {
    const box = e.target;
    // 사진 칸 ⋯ 판은 칸 오른쪽 끝에 맞춰 왼쪽으로 열린다. 왼쪽이 창·칸 밖으로 잘리면 칸 왼쪽 끝에 맞춰 오른쪽으로 연다(이 화면 메모리만).
    if (box?.matches?.('details.record-photo-more')) {
      delete box.dataset.side;
      const panel = box.open && box.querySelector('.record-photo-panel');
      if (panel) { let edge = 0; for (let el = box.parentElement; el; el = el.parentElement) { const o = getComputedStyle(el).overflowX; if (o !== 'visible') { edge = Math.max(edge, el.getBoundingClientRect().left); break; } } if (panel.getBoundingClientRect().left < edge + 4) box.dataset.side = 'left'; }
    }
  }, true);
  host.addEventListener('click', e => {
    const more = e.target.closest?.('[data-record-photos-more]');
    if (more && host.contains(more)) { // [+n]: 나머지 사진을 그 자리에서 펴고 작은 그림을 받는다
      e.preventDefault(); e.stopPropagation();
      const box = more.closest('[data-record-photos]');
      box.querySelectorAll('[data-photo-tile][hidden]').forEach(t => { t.hidden = false; });
      box.dataset.all = ''; more.remove(); paintRecordFiles(box, getRows(), rt);
      box.querySelector('[data-record-photo]')?.focus();
      return;
    }
    const el = e.target.closest?.('[data-record-photo],[data-record-file]');
    if (!el || !host.contains(el)) return;
    e.preventDefault(); e.stopPropagation();
    const row = getRows().find(r => r.note_id === el.dataset.recordNote);
    const id = el.dataset.recordPhoto || el.dataset.recordFile, file = filesOf(row).find(f => f.drive_file_id === id);
    if (!row || !file) return;
    if (el.dataset.recordPhoto) { openPhotoView({row:{id:row.note_id}, file, trigger:el, rt}); return; }
    void pressFile({name:attachmentName(file), mime:file.mime_type, driveId:id, noteId:row.note_id}, {viewPhoto:() => openPhotoView({row:{id:row.note_id}, file, trigger:el, rt}), onError});
  });
}

// ORG-기록첨부(S50-22): a linked record's pictures and files, right under its line in an organization's or a project's record list.
// Pictures show small (owner-only basket-files photo view, the 정리함's own path — never a public address) and open large when
// pressed; other files are a name line that opens by kind (file-actions.js pressFile, as the 정리함 does). It reads nothing itself:
// the rows come from readLinkRecords({withFiles:true}) (the note's attachments in the same read).
import { photoElement } from './diary-data.js';
import { openPhotoView } from './photo-view.js';
import { pressFile } from './file-actions.js';
import { attachmentName } from './attachment-name.mjs';
import { fileKind } from './meeting-compact.js';
import { isPictureFile, splitPictures, pictureCountLabel } from './photo-fold-model.mjs';
import { chevHtml } from './fold-chevron.mjs';

const SHOWN = 6;
const PHOTO = /^image\/(jpeg|png|webp|gif)$/i;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const filesOf = row => (Array.isArray(row?.attachments) ? row.attachments : []).filter(f => /^[A-Za-z0-9_-]{1,255}$/.test(String(f?.drive_file_id || '')));
const isPhoto = file => PHOTO.test(String(file?.mime_type || ''));

// LIB-사진숨김(S60-10, 명진 결정 11/12): 사진은 이름 줄·그림 줄로 늘어놓지 않고 [사진 n] 하나(접힌 <details>). 펼치면 그 자리에 작은 그림,
// 누르면 크게 보기. 사진 판정은 [파일]과 같은 공용 판정(photo-fold-model.mjs isPictureFile = files-model.mjs kindOf). 펼침은 저장하지 않아
// 목록을 다시 그리거나 화면을 다시 열면 늘 접힌 채 시작한다. 작은 그림은 펼칠 때만 받는다.
const isPicture = file => isPhoto(file) || isPictureFile({name: attachmentName(file), mime: file?.mime_type});
export function recordFilesHtml(row) {
  const files = filesOf(row);
  if (!files.length) return '';
  const note = esc(row.note_id), {rest, pictures} = splitPictures(files, isPicture), more = rest.length - SHOWN;
  const items = rest.slice(0, SHOWN).map(file => {
    const id = esc(file.drive_file_id), name = esc(attachmentName(file));
    const kind = fileKind(attachmentName(file));
    return `<button type="button" class="record-file-name" data-record-file="${id}" data-record-note="${note}" aria-label="${name} 열기"><span class="file-kind" data-kind="${esc(kind.key)}" aria-hidden="true">${esc(kind.label)}</span><span class="record-file-text">${name}</span></button>`;
  }).join('');
  const thumbs = pictures.map(file => {
    const id = esc(file.drive_file_id), name = esc(attachmentName(file));
    return `<button type="button" class="record-file-thumb" data-record-photo="${id}" data-record-note="${note}" aria-label="${name} 크게 보기" title="${name}"></button>`;
  }).join('');
  const photos = pictures.length ? `<details class="record-photos" data-record-photos="${note}"><summary class="photo-fold-toggle">${esc(pictureCountLabel(pictures.length))}${chevHtml()}</summary><div class="record-photo-thumbs">${thumbs}</div></details>` : '';
  return `<div class="record-files" data-record-files="${note}">${items}${more > 0 ? `<span class="record-files-more">외 ${more}개</span>` : ''}${photos}</div>`;
}

// Small pictures for the strips now in host (call after the list is drawn). Pictures inside a closed [사진 n] wait until it opens.
export function paintRecordFiles(host, rows, rt = window.KPTURuntime) {
  if (!host) return;
  for (const thumb of host.querySelectorAll('[data-record-photo]')) {
    if (thumb.childElementCount) continue;
    if (thumb.closest('details:not([open])')) continue;
    const row = rows.find(r => r.note_id === thumb.dataset.recordNote), file = filesOf(row).find(f => f.drive_file_id === thumb.dataset.recordPhoto);
    if (row && file) thumb.append(photoElement({id:row.note_id}, file, 'small', {label:'', link:false, rt, retry:false}));
  }
}

// One click listener per host: a picture opens large, a file opens by its kind. getRows() gives the rows drawn now.
const bound = new WeakSet();
export function bindRecordFiles(host, getRows, {rt = window.KPTURuntime, onError = () => {}} = {}) {
  if (!host || bound.has(host)) return;
  bound.add(host);
  // [사진 n]을 펼치면 그때 그 안 작은 그림을 받는다(toggle은 거품이 없어 잡기 단계에서 듣는다).
  host.addEventListener('toggle', e => {
    const box = e.target;
    if (box?.matches?.('details[data-record-photos]') && box.open) paintRecordFiles(box, getRows(), rt);
  }, true);
  host.addEventListener('click', e => {
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

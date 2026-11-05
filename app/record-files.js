// ORG-기록첨부(S50-22): a linked record's pictures and files, right under its line in an organization's or a project's record list.
// Pictures show small (owner-only basket-files photo view, the 정리함's own path — never a public address) and open large when
// pressed; other files are a name line that opens by kind (file-actions.js pressFile, as the 정리함 does). It reads nothing itself:
// the rows come from readLinkRecords({withFiles:true}) (the note's attachments in the same read).
import { photoElement } from './diary-data.js';
import { openPhotoView } from './photo-view.js';
import { pressFile } from './file-actions.js';
import { attachmentName } from './attachment-name.mjs';
import { fileKind } from './meeting-compact.js';

const SHOWN = 6;
const PHOTO = /^image\/(jpeg|png|webp|gif)$/i;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const filesOf = row => (Array.isArray(row?.attachments) ? row.attachments : []).filter(f => /^[A-Za-z0-9_-]{1,255}$/.test(String(f?.drive_file_id || '')));
const isPhoto = file => PHOTO.test(String(file?.mime_type || ''));

export function recordFilesHtml(row) {
  const files = filesOf(row);
  if (!files.length) return '';
  const note = esc(row.note_id), more = files.length - SHOWN;
  const items = files.slice(0, SHOWN).map(file => {
    const id = esc(file.drive_file_id), name = esc(attachmentName(file));
    if (isPhoto(file)) return `<button type="button" class="record-file-thumb" data-record-photo="${id}" data-record-note="${note}" aria-label="${name} 크게 보기" title="${name}"></button>`;
    const kind = fileKind(attachmentName(file));
    return `<button type="button" class="record-file-name" data-record-file="${id}" data-record-note="${note}" aria-label="${name} 열기"><span class="file-kind" data-kind="${esc(kind.key)}" aria-hidden="true">${esc(kind.label)}</span><span class="record-file-text">${name}</span></button>`;
  }).join('');
  return `<div class="record-files" data-record-files="${note}">${items}${more > 0 ? `<span class="record-files-more">외 ${more}개</span>` : ''}</div>`;
}

// Small pictures for the strips now in host (call after the list is drawn).
export function paintRecordFiles(host, rows, rt = window.KPTURuntime) {
  if (!host) return;
  for (const thumb of host.querySelectorAll('[data-record-photo]')) {
    if (thumb.childElementCount) continue;
    const row = rows.find(r => r.note_id === thumb.dataset.recordNote), file = filesOf(row).find(f => f.drive_file_id === thumb.dataset.recordPhoto);
    if (row && file) thumb.append(photoElement({id:row.note_id}, file, 'small', {label:'', link:false, rt, retry:false}));
  }
}

// One click listener per host: a picture opens large, a file opens by its kind. getRows() gives the rows drawn now.
const bound = new WeakSet();
export function bindRecordFiles(host, getRows, {rt = window.KPTURuntime, onError = () => {}} = {}) {
  if (!host || bound.has(host)) return;
  bound.add(host);
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

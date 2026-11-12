// ORG-기록첨부(S50-22): the one line a record gets when only pictures or files were put in (11/05 16:41 명진 결정).
// The server AI's reading of one file comes first (library-files mode=record_line); when it gives nothing, the line is made here
// from the files themselves: '그림 1장 · 붙여넣은 그림 11-05 16:18.png'. Pure functions only (the request is in record-attach.js).
import { isPictureFile } from './photo-fold-model.mjs';
export const RECORD_LINE_CHARS = 80;
export const RECORD_LINE_MAX_BYTES = 25 * 1024 * 1024;
const IMAGE = /^image\//i;
const AI_IMAGE = /^image\/(png|jpeg|webp|gif)$/i;
const extOf = name => (String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
const cut = (s, n) => { const a = [...String(s)]; return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); };

// '그림 2장 · 파일 1개' (pictures first; none of a kind is left out).
export function countLabel(files) {
  const list = [...(files || [])], pics = list.filter(f => IMAGE.test(String(f?.type || ''))).length, others = list.length - pics;
  return [pics ? `그림 ${pics}장` : '', others ? `파일 ${others}개` : ''].filter(Boolean).join(' · ');
}

// The line from the files alone: count · first name (· 외 n).
export function fallbackFileLine(files) {
  const list = [...(files || [])];
  if (!list.length) return '';
  const first = String(list[0]?.name || '').replace(/\s+/g, ' ').trim() || '이름 없음';
  return `${countLabel(list)} · ${cut(first, 60)}${list.length > 1 ? ` 외 ${list.length - 1}` : ''}`;
}

// The one file sent to the AI: the first picture or document the server can read (the same kinds as record-line.ts), 25MB at most.
export function lineSource(files) {
  return [...(files || [])].find(f => {
    const size = Number(f?.size) || 0, type = String(f?.type || ''), e = extOf(f?.name);
    if (!(size > 0) || size > RECORD_LINE_MAX_BYTES) return false;
    return AI_IMAGE.test(type) || /^text\//i.test(type) || type === 'application/pdf'
      || ['txt', 'md', 'csv', 'json', 'log', 'xml', 'hwp', 'hwpx', 'pdf', 'doc', 'docx', 'ppt', 'pptx'].includes(e);
  }) || null;
}

// The AI's line for the record: kept as it came (the server checked it), with the count when there were several files.
export function recordFileLine(aiLine, files) {
  const list = [...(files || [])];
  const ai = typeof aiLine === 'string' ? aiLine.replace(/\s+/g, ' ').trim() : '';
  if (!ai) return fallbackFileLine(list);
  return list.length > 1 ? `${ai} (${countLabel(list)})` : ai;
}

// ORG-기록첨부이름반영(S60-14): a file of a record was renamed (file-rename.js → 'kptu:file-renamed' + the old name).
// When the record's line is still the one made from the files ('그림 1장 · 옛 이름(· 외 n)'), the same line with the new name;
// any other line (the AI's, or one a person wrote with [요약 수정]) gives null and stays as it is.
// attachments = the note's attachments after the rename (app_notes.attachments, the server already changed the name).
// Only the first file's name is in the line, so only renaming the first file changes it. The count part is kept as written.
const LINE_HEAD = /^((?:그림 \d+장|파일 \d+개)(?: · 파일 \d+개)?) · ([\s\S]*)$/;
export function renamedRecordLine(summary, attachments, {drive_file_id: id = '', name = '', old_name: oldName = ''} = {}) {
  if (typeof summary !== 'string' || !id || !name || !oldName || name === oldName) return null;
  const list = Array.isArray(attachments) ? attachments : [];
  if (!list.length || list[0]?.drive_file_id !== id) return null;
  const m = summary.match(LINE_HEAD);
  if (!m) return null;
  const more = list.length > 1 ? ` 외 ${list.length - 1}` : '';
  const shown = n => cut(String(n || '').replace(/\s+/g, ' ').trim() || '이름 없음', 60) + more;
  if (m[2] !== shown(oldName)) return null;
  const next = `${m[1]} · ${shown(name)}`;
  return next === summary ? null : next;
}

// ORG-기록첨부표시이름(S61-2): 글 없이 사진·파일만 올린 기록의 목록 줄(요약도 글도 없을 때) — '요약 없음' 대신 '사진 3장'·'파일 2개'·'사진 2장 · 파일 1개'.
// attachments = 그 업데이트의 파일 목록(app_notes.attachments: file_name·mime_type). 사진 판정은 [파일]과 같은 공용 판정(photo-fold-model.mjs isPictureFile).
// 파일이 없으면 ''(부른 곳이 '요약 없음'을 그대로 쓴다).
export function attachmentsLabel(attachments) {
  const list = (Array.isArray(attachments) ? attachments : []).filter(f => f && typeof f === 'object');
  const pics = list.filter(f => isPictureFile({name:String(f.file_name || ''), mime:String(f.mime_type || '')})).length, others = list.length - pics;
  return [pics ? `사진 ${pics}장` : '', others ? `파일 ${others}개` : ''].filter(Boolean).join(' · ');
}

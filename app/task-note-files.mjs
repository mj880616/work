// TASK-첨부열기: the one reader/writer of the "첨부: <파일 이름> <Drive 주소>" lines in a Google task's notes.
// The google-tasks Edge writes these lines (supabase/functions/google-tasks/task-files.ts, fileLine); this file reads and
// writes the same format. The task list card and the edit window both use it, so a task's notes are split in one place:
//   memo        = what the owner wrote (no attachment lines) -> the 메모 box
//   attachments = the lines, shown in the 첨부 row and kept in Google's notes untouched
// Saving puts the two back together (joinTaskNotes). The Edge removes and re-adds the lines of files it knows, so a line
// is never doubled and never lost.
const LINE = /^첨부: (.+) https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)\/view$/;
export const noteFileUrl = id => `https://drive.google.com/file/d/${id}/view`;
const lineName = name => String(name || '파일').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim() || '파일';
export const noteFileLine = f => `첨부: ${lineName(f?.file_name)} ${noteFileUrl(f?.drive_file_id)}`;

// notes -> {memo, attachments:[{drive_file_id, file_name}]}. Notes without a line come back exactly as they are.
export function splitTaskNotes(notes) {
  const text = String(notes ?? '');
  const attachments = [], seen = new Set(), kept = [];
  for (const line of text.split('\n')) {
    const m = line.trimEnd().match(LINE);
    if (!m) { kept.push(line); continue; }
    if (!seen.has(m[2])) { seen.add(m[2]); attachments.push({drive_file_id: m[2], file_name: m[1].trim()}); }
  }
  return {memo: attachments.length ? kept.join('\n').replace(/\s+$/, '') : text, attachments};
}

// memo + attachment lines -> notes (the attachment lines at the end, one per file). No attachments: the memo as it is.
export function joinTaskNotes(memo, attachments) {
  const text = String(memo ?? '');
  const lines = [], seen = new Set();
  for (const f of attachments || []) {
    if (!f?.drive_file_id || seen.has(f.drive_file_id)) continue;
    seen.add(f.drive_file_id); lines.push(noteFileLine(f));
  }
  if (!lines.length) return text;
  const kept = text.replace(/\s+$/, '');
  return kept ? kept + '\n' + lines.join('\n') : lines.join('\n');
}

// The files to show for a task: the link table's files first (attach order, their names win), then lines found only in the notes.
export function taskAttachments(notes, tableFiles = []) {
  const out = [], seen = new Set();
  for (const f of [...(tableFiles || []), ...splitTaskNotes(notes).attachments]) {
    if (!f?.drive_file_id || seen.has(f.drive_file_id)) continue;
    seen.add(f.drive_file_id); out.push({drive_file_id: f.drive_file_id, file_name: String(f.file_name || '파일'), size_bytes: Number(f.size_bytes) || 0});
  }
  return out;
}

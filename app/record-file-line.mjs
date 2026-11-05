// ORG-기록첨부(S50-22): the one line a record gets when only pictures or files were put in (11/05 16:41 명진 결정).
// The server AI's reading of one file comes first (library-files mode=record_line); when it gives nothing, the line is made here
// from the files themselves: '그림 1장 · 붙여넣은 그림 11-05 16:18.png'. Pure functions only (the request is in record-attach.js).
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

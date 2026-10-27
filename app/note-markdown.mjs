// NOTE-마크다운선택: 노트마다 '마크다운' 체크 여부(순수 함수, DOM 없음 — Node 단위 검사에서 그대로 돈다).
// 저장 위치는 노트 행의 기존 metadata jsonb 칸(metadata.markdown, true/false; 새 칸·DB 변경 없음). 새 노트는 해제(false)로 저장한다.
// 값이 없는 기존 노트는 본문에 마크다운 기호(## 머리, **굵게**, 표 |---|, ``` 코드, > [!NOTE] 강조 상자, [글](주소) 링크)가
// 있으면 체크, 없으면 해제로 본다. '- '·'1. '·날짜로 시작하는 줄은 손으로 쓴 글에도 흔하므로 마크다운 표시로 치지 않는다.

const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const MARKS = [
  /^\s{0,3}#{1,6}[ \t]+\S/m,                          // ## 머리
  /\*\*(?=\S)[^*\n]*?\S\*\*/,                          // **굵게**
  /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/m, // 표 구분 줄 |---|---|
  /^\s{0,3}(`{3,}|~{3,})/m,                            // ``` 코드
  /^\s{0,3}>[ \t]?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/im, // 강조 상자
  /\[[^\]\n]+\]\((?:https?:|mailto:)[^)\s]+\)/,         // [글](주소)
];

// The stored choice (true/false), or null when this note has none yet.
export function storedMarkdown(note) {
  const value = plainObject(note?.metadata) ? note.metadata.markdown : undefined;
  return typeof value === 'boolean' ? value : null;
}
export function looksLikeMarkdown(text) {
  const value = String(text ?? '');
  return MARKS.some(re => re.test(value));
}
// What the note's write window and read view use: the stored choice, else the guess from its text.
export function noteMarkdown(note) {
  const stored = storedMarkdown(note);
  return stored ?? looksLikeMarkdown(note?.raw_text);
}

// 날짜 두 번 문제: [노트로 옮기기]는 업데이트 첫 줄을 노트 제목으로 쓴다. 그 첫 줄이 날짜·시각으로 시작하면(담당조직 기록처럼
// "2026.10.21. 14:30 …") 제목과 본문 첫 줄에 같은 날짜·시각이 두 번 보이므로 본문에서 그 줄(과 바로 뒤 빈 줄)을 뺀다.
// 날짜로 시작하지 않는 첫 줄, 제목과 다른 첫 줄은 그대로 둔다(본문이 빠지지 않게).
const DATE_START = /^(?:\d{4}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*[.일]?|\d{1,2}\s*[./월]\s*\d{1,2}\s*[.일])/;
export function startsWithDate(line) { return DATE_START.test(String(line ?? '').trim()); }
export function bodyWithoutTitleLine(text, title) {
  const raw = String(text ?? '').replace(/\r\n?/g, '\n'), head = String(title ?? '').trim();
  if (!head || !startsWithDate(head)) return raw;
  const lines = raw.split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i >= lines.length || lines[i].trim().replace(/\s+/g, ' ') !== head.replace(/\s+/g, ' ')) return raw;
  let next = i + 1;
  while (next < lines.length && !lines[next].trim()) next++;
  return lines.slice(next).join('\n');
}

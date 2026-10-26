// WEEKLY-개인본대조 W-2·W-3 공용 순수 모듈(docs/design/ledger-sources.md 4절): 주간보고 한글 파일 글 → 절 안의 글 줄.
// - 앱(받은 초안을 내줄 때 draft.issued 기록)과 Edge ai-assist(자료실 개인본을 읽어 비교)가 같은 함수로 줄을 나눈다. 두 곳이 어긋나면 같은 줄이 '새 줄'로 잡힌다.
// - 이 파일은 supabase/functions/_shared/weekly-lines.mjs 와 바이트까지 같은 사본이다(org-name-match.mjs 와 같은 방식). 한쪽만 고치지 않는다(tests/weekly-issued-lines.test.mjs 가 지킨다).
// - 화면·네트워크 없음. 글은 업무 글이므로 로그·오류 보고에 넣지 않는다.

export const WEEKLY_LINE_CHARS = 300;
export const WEEKLY_MAX_LINES = 400;
// draft.issued 한 덩어리의 상한(JSON 바이트). 넘으면 기록하지 않는다 → W-3가 그 주를 '기준 없음'으로 건너뛴다(저장 전체가 막히는 것보다 낫다).
export const ISSUED_MAX_BYTES = 65536;

export const WEEKLY_SECTIONS = Object.freeze(['requests', 'work', 'struggle', 'orgs']);

// 양식 글자(표 머리 칸 이름과 상자 칸 이름): 글이 아니라 틀이다. app/weekly-hwpx/template.mjs 의 목록과 같다.
const FORM_LABELS = ['일', '시간/내용/장소', '참석 요청', '사업영역', '세부 과제', '진행 상황 및 이후 계획', '담당 팀원', '일시/장소', '집회/행사명', '참석현황',
  '조직명', '현황', '사업장', '조직현황', '참석자', '제목', '회의제목', '회의 내용', '내용', '차기일정', '보고', '논의결과', '*차기회의'];

const flat = s => String(s ?? '').normalize('NFKC').replace(/\s+/g, '');
// 비교용 글: 소문자, 공백·문장부호·기호를 뺀 글자만.
export const squashLine = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
const FORM_KEYS = new Set(FORM_LABELS.map(squashLine));
export const oneLine = s => [...String(s ?? '')
  .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060-\u2069]+/g, ' ')
  .replace(/\s+/g, ' ').trim()].slice(0, WEEKLY_LINE_CHARS).join('');

const BIG = [
  [/^1[.)]?요청사항$/, 'requests'],
  [/^2[.)]?기본.{0,3}영역.{0,3}의제사업$/, 'work'],
  [/^3[.)]?투쟁사업$/, 'struggle'],
  [/^4[.)]?산하조직현황$/, 'orgs'],
  [/^5[.)]?주요일정$/, null],
];
// 작은 제목 "1) 요약" 같은 줄. 주요 일정 작은 제목은 그 아래 표를 읽지 않는다.
const SUB = /^\d\)(.{1,28})$/;
const SUB_WORDS = ['요약', '세부내용', '집회', '농성', '투쟁사업장', '참고자료', '요청', '주요일정'];
const bigHeading = h => { for (const [re, section] of BIG) if (re.test(h)) return {section}; return null; };

// 글(문단마다 한 줄) → 절 안의 글 줄 [{section, text}]. 절 제목·양식 글자·너무 짧은 줄은 뺀다. 첫 큰 제목 앞(문서 제목·날짜)과 5절은 읽지 않는다.
export function weeklyLines(text) {
  const out = [];
  let section = null, skipSub = false;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = oneLine(raw);
    if (!line) continue;
    const h = flat(line);
    const big = bigHeading(h);
    if (big) { section = big.section; skipSub = false; continue; }
    const sub = SUB.exec(h);
    if (sub && SUB_WORDS.some(w => sub[1].includes(w))) { skipSub = sub[1].includes('주요일정'); continue; }
    if (!section || skipSub) continue;
    const key = squashLine(line);
    if ([...key].length < 2 || FORM_KEYS.has(key)) continue;
    out.push({section, text: line});
    if (out.length >= WEEKLY_MAX_LINES) break;
  }
  return out;
}

const ENTITY = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/gi, (all, v) => {
    if (v[0] !== '#') return ENTITY[v.toLowerCase()] ?? all;
    const n = v[1] === 'x' || v[1] === 'X' ? parseInt(v.slice(2), 16) : parseInt(v.slice(1), 10);
    return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
  });
}
// HWPX 본문 XML 한 쪽에서 글자만: 문단(<hp:p>)마다 <hp:t> 안의 글을 모은다. 표 안 문단도 한 줄씩. 서버가 개인본 글자를 읽는 규칙(_shared/document-text.ts hwpxSectionText)과 같다
// (같은 글이 나오는지는 tests/weekly-issued-lines.test.mjs 가 견준다).
export function sectionXmlText(xml) {
  const lines = [];
  for (const para of String(xml ?? '').split(/<\/hp:p>/)) {
    let line = '';
    for (const m of para.matchAll(/<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/g)) {
      line += decodeEntities(m[1].replace(/<hp:tab\b[^>]*\/>/g, ' ').replace(/<[^>]*>/g, ''));
    }
    if (line.trim()) lines.push(line);
  }
  return lines.join('\n');
}

// ---- draft.issued: 받은 초안의 1~4절 글 줄(표 머리 칸 이름만 뺀 전부) ----
// 모양: {at, from:'generated', lines:[{section, text}]}. section 은 weeklyLines 의 절 이름. 비교는 text(정리한 글자)만 본다.
export const ISSUED_FROM = 'generated';
const issuedBytes = issued => new TextEncoder().encode(JSON.stringify(issued)).length;

// 본문 XML 글들(쪽마다) → issued. 읽은 줄이 없거나 상한을 넘으면 null(기록하지 않음).
export function issuedFromSections(xmls, at) {
  const lines = weeklyLines(xmls.map(sectionXmlText).join('\n')).map(({section, text}) => ({section, text}));
  if (!lines.length) return null;
  const issued = {at: String(at ?? ''), from: ISSUED_FROM, lines};
  return issuedBytes(issued) > ISSUED_MAX_BYTES ? null : issued;
}

// 서버에서 읽은 issued 를 모양대로만 받아들인다(틀린 줄은 버림). 쓸 줄이 없거나 상한을 넘으면 null.
export function readIssued(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.at !== 'string' || raw.at.length > 40 || !Array.isArray(raw.lines)) return null;
  const lines = [];
  for (const l of raw.lines.slice(0, WEEKLY_MAX_LINES)) {
    if (l && typeof l === 'object' && WEEKLY_SECTIONS.includes(l.section) && typeof l.text === 'string' && l.text && [...l.text].length <= WEEKLY_LINE_CHARS) lines.push({section: l.section, text: l.text});
  }
  if (!lines.length) return null;
  const issued = {at: raw.at, from: ISSUED_FROM, lines};
  return issuedBytes(issued) > ISSUED_MAX_BYTES ? null : issued;
}

// 둘 중 더 나중에 낸 것(같으면 앞). 없는 쪽은 무시.
export function newerIssued(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  const x = Date.parse(a.at), y = Date.parse(b.at);
  return Number.isFinite(y) && !(Number.isFinite(x) && x >= y) ? b : a;
}
// 줄이 같은가(낸 시각은 보지 않음 — 같은 글을 다시 내줄 때 서버에 또 쓰지 않으려고).
export const sameIssuedLines = (a, b) => JSON.stringify((a?.lines ?? []).map(l => [l.section, l.text])) === JSON.stringify((b?.lines ?? []).map(l => [l.section, l.text]));

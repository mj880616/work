// WEEKLY-개인본대조 W-2·W-3 공용 순수 모듈(docs/design/ledger-sources.md 4절): 주간보고 한글 파일 글 → 절 안의 글 줄.
// - 앱(받은 초안을 내줄 때 draft.issued 기록)과 Edge ai-assist(자료실 개인본을 읽어 비교)가 같은 함수로 줄을 나눈다. 두 곳이 어긋나면 같은 줄이 '새 줄'로 잡힌다.
// - 이 파일은 supabase/functions/_shared/weekly-lines.mjs 와 바이트까지 같은 사본이다(org-name-match.mjs 와 같은 방식). 한쪽만 고치지 않는다(tests/weekly-issued-lines.test.mjs 가 지킨다).
// - 화면·네트워크 없음. 글은 업무 글이므로 로그·오류 보고에 넣지 않는다.
// - WEEKLY-내양식자유변형 ⑤-3c: 절 제목·표 머리 칸 이름·상자 칸 이름은 코드에 박지 않고 '내 양식' 엔진 profile
//   (app/weekly-hwpx/form-profile.mjs profileOf 결과 {titles, formLabels, boxLabels})을 인자로 받는다. 빠지면 멈춘다(다른 양식으로 몰래 돌지 않음).
//   코드가 아는 것은 자리(role) 이름뿐이다 — 큰 항목 자리 → 절 이름, 작은 항목 자리 가운데 'schedule'(주요 일정) 아래는 읽지 않음.

export const WEEKLY_LINE_CHARS = 300;
export const WEEKLY_MAX_LINES = 400;
// draft.issued 한 덩어리의 상한(JSON 바이트). 넘으면 기록하지 않는다 → W-3가 그 주를 '기준 없음'으로 건너뛴다(저장 전체가 막히는 것보다 낫다).
export const ISSUED_MAX_BYTES = 65536;

export const WEEKLY_SECTIONS = Object.freeze(['requests', 'work', 'struggle', 'orgs']);

// 비교용 글: 소문자, 공백·문장부호·기호를 뺀 글자만.
export const squashLine = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
export const oneLine = s => [...String(s ?? '')
  .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060-\u2069]+/g, ' ')
  .replace(/\s+/g, ' ').trim()].slice(0, WEEKLY_LINE_CHARS).join('');

// 자리(role) → 절. 큰 항목 자리만 절을 연다(5. 주요 일정 자리 'calendar'는 절 null — 읽지 않음). 글자는 profile 에서.
const BIG_SECTIONS = Object.freeze({requests: 'requests', work: 'work', struggle: 'struggle', orgs: 'orgs', calendar: null});
// 그 아래 표를 읽지 않는 작은 항목 자리(1. 2) 주요 일정).
const SKIP_SUBS = Object.freeze(['schedule']);
// profile → 비교 규칙(같은 profile 이면 한 번만 만든다). 제목은 squashLine 으로 견준다(번호 뒤 '.'·')'·가운뎃점·띄어쓰기 차이는 같은 제목).
const rulesMemo = new WeakMap();
function rulesOf(profile) {
  if (!profile || typeof profile !== 'object' || !profile.titles || !Array.isArray(profile.formLabels) || !Array.isArray(profile.boxLabels)) throw new Error('양식(profile)이 없음');
  const known = rulesMemo.get(profile);
  if (known) return known;
  const heads = new Map();
  for (const [role, title] of Object.entries(profile.titles)) {
    const key = squashLine(title);
    if (!key || heads.has(key)) continue;
    heads.set(key, Object.hasOwn(BIG_SECTIONS, role) ? {kind: 'big', section: BIG_SECTIONS[role]} : {kind: 'sub', schedule: SKIP_SUBS.includes(role)});
  }
  const rules = {heads, formKeys: new Set([...profile.formLabels, ...profile.boxLabels].map(squashLine).filter(Boolean))};
  rulesMemo.set(profile, rules);
  return rules;
}
// 양식(profile)이 엔진 모양인지 본다(빠지면 멈춤). 반환은 그 profile.
export const needLineProfile = profile => (rulesOf(profile), profile);
// 한 줄이 절 제목인가(profile 의 항목 제목과 같은 글): 큰 제목 {kind:'big', section}(5절은 section null) · 작은 제목 {kind:'sub', schedule} · 아니면 null.
// weeklyLines 와 weekly-layout.mjs(고친 판 모양 읽기)가 같은 규칙으로 절을 나눈다.
export function headingOf(line, profile) {
  const {heads} = rulesOf(profile);
  return heads.get(squashLine(oneLine(line))) ?? null;
}
// 절 제목·양식 글자·너무 짧은 줄이 아닌 '글 줄'인가(비교용 글자 2자 이상, 표 머리 칸·상자 칸 이름 아님).
export const isTextLine = (line, profile) => { const key = squashLine(oneLine(line)); return [...key].length >= 2 && !rulesOf(profile).formKeys.has(key); };

// 글(문단마다 한 줄) → 절 안의 글 줄 [{section, text}]. 절 제목·양식 글자·너무 짧은 줄은 뺀다. 첫 큰 제목 앞(문서 제목·날짜)과 5절은 읽지 않는다.
export function weeklyLines(text, profile) {
  rulesOf(profile);
  const out = [];
  let section = null, skipSub = false;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = oneLine(raw);
    if (!line) continue;
    const head = headingOf(line, profile);
    if (head?.kind === 'big') { section = head.section; skipSub = false; continue; }
    if (head) { skipSub = head.schedule; continue; }
    if (!section || skipSub) continue;
    if (!isTextLine(line, profile)) continue;
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

// 본문 XML 글들(쪽마다) → issued. 읽은 줄이 없거나 상한을 넘으면 null(기록하지 않음). profile = 그 파일을 만든 엔진 양식.
export function issuedFromSections(xmls, at, profile) {
  const lines = weeklyLines(xmls.map(sectionXmlText).join('\n'), profile).map(({section, text}) => ({section, text}));
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

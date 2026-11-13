// WEEKLY-자동화 ② (docs/design/weekly-automation.md 3.1-1절, 명진 결정 3): 'Web2가 만든 확정 파일' ↔ '명진이 한글에서 고쳐 올린 파일'의
// 모양(빈 줄 띄우기·줄머리 기호·들여쓰기)을 숫자로 견준다. 문장 고침·줄 더함/뺌·줄 순서는 지금처럼 weekly-feedback.mjs diffCells 가 센다.
// - 이 파일은 supabase/functions/_shared/weekly-layout.mjs 와 바이트까지 같은 사본이다(weekly-lines.mjs 와 같은 방식). 한쪽만 고치지 않는다
//   (tests/weekly-layout.test.mjs 가 지킨다). 앱([올리기]·한글 파일 만들기)과 Edge(금요일 자동 초안)가 같은 규칙을 쓴다.
// - 화면·네트워크 없음. 결과(layout)는 숫자와 짧은 표시만이다 — 글을 담지 않으므로 환류 기록(draft.feedback.layout)에 그대로 실어도 된다.
// - 업무 글이 지나가므로 로그·오류 보고에 글을 넣지 않는다.

import {WEEKLY_SECTIONS, WEEKLY_MAX_LINES, headingOf, isTextLine, oneLine} from './weekly-lines.mjs';

export const LAYOUT_VERSION = 1;
export const LAYOUT_MAX_PARAS = 2000;     // 한 판에서 읽는 문단 수 상한(빈 문단 포함)
export const LAYOUT_WEEKS = 4;            // 습관을 볼 지난 주 수(weekly-feedback.mjs LEARN_WEEKS 와 같음)
export const HABIT_MIN_WEEKS = 2;         // 같은 모양이 이만큼 되풀이돼야 습관으로 따른다
export const LAYOUT_MAX_BYTES = 4096;     // feedback.layout 한 덩어리 상한(JSON 바이트)
// 줄머리 기호. 순서가 곧 판정 순서다. none = 기호 없음.
export const BULLETS = Object.freeze(['dash', 'circle', 'dot', 'square', 'note', 'number', 'none']);
const BULLET_RE = [
  ['dash', /^[-–—]\s*/],
  ['circle', /^[○◦●◎]\s*/],
  ['dot', /^[·•ㆍ∙]\s*/],
  ['square', /^[□■▪▫◇◆▶▷]\s*/],
  ['note', /^※\s*/],
  ['number', /^(?:\d{1,2}[.)]|[가-하][.)]|\(\d{1,2}\))\s+/],
];
export const bulletOf = text => { const t = String(text ?? '').trimStart(); for (const [name, re] of BULLET_RE) if (re.test(t)) return name; return 'none'; };

const ENTITY = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/gi, (all, v) => {
    if (v[0] !== '#') return ENTITY[v.toLowerCase()] ?? all;
    const n = v[1] === 'x' || v[1] === 'X' ? parseInt(v.slice(2), 16) : parseInt(v.slice(1), 10);
    return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
  });
}

// HWPX 본문 XML 한 쪽 → 문단 글 목록. weekly-lines.mjs sectionXmlText 와 같은 규칙이지만 **빈 문단을 버리지 않는다**(빈 줄 띄우기를 세려고).
// 문단 앞 공백(들여쓰기)도 그대로 둔다. 표 안 문단도 한 줄씩 나온다.
export function sectionXmlParas(xml) {
  const paras = [];
  const parts = String(xml ?? '').split(/<\/hp:p>/);
  parts.pop(); // 마지막 </hp:p> 뒤 꼬리는 문단이 아니다
  for (const para of parts) {
    let line = '';
    for (const m of para.matchAll(/<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/g)) {
      line += decodeEntities(m[1].replace(/<hp:tab\b[^>]*\/>/g, '\t').replace(/<[^>]*>/g, ''));
    }
    paras.push(line.replace(/[\r\n]+/g, ' '));
    if (paras.length >= LAYOUT_MAX_PARAS) break;
  }
  return paras;
}

const emptyStats = () => ({lines: 0, gaps: 0, blank_gaps: 0, headings: 0, heading_blank: 0, indented: 0, bullets: {}});

// 문단 목록 → 절마다 모양 숫자. 절 나누기는 weeklyLines 와 같다(첫 큰 제목 앞·5절·주요 일정 작은 제목 아래는 세지 않음).
//   lines: 글 줄 수 · gaps: 같은 절 안 이웃한 글 줄 사이 수 · blank_gaps: 그 사이에 빈 문단이 하나 이상 있었던 수
//   headings: 절·작은 제목 수 · heading_blank: 제목 바로 뒤가 빈 문단인 수 · indented: 앞에 공백·탭이 있는 글 줄 수
//   bullets: 줄머리 기호별 글 줄 수
export function layoutStats(paras) {
  const out = {};
  let section = null, skipSub = false, prevText = false, blankSince = false, afterHeading = null, lines = 0;
  for (const raw of (Array.isArray(paras) ? paras : []).slice(0, LAYOUT_MAX_PARAS)) {
    const text = String(raw ?? '');
    const line = oneLine(text);
    if (!line) { blankSince = true; if (afterHeading) { afterHeading.heading_blank++; afterHeading = null; } continue; }
    const head = headingOf(line);
    if (head) {
      if (head.kind === 'big') { section = head.section; skipSub = false; } else skipSub = head.schedule;
      afterHeading = null; prevText = false; blankSince = false;
      if (section && !skipSub) { const st = (out[section] ??= emptyStats()); st.headings++; afterHeading = st; }
      continue;
    }
    afterHeading = null;
    if (!section || skipSub || !isTextLine(line)) { blankSince = false; continue; }
    const st = (out[section] ??= emptyStats());
    st.lines++; lines++;
    if (prevText) { st.gaps++; if (blankSince) st.blank_gaps++; }
    if (/^[ \t\u3000]/.test(text)) st.indented++;
    const b = bulletOf(line); st.bullets[b] = (st.bullets[b] ?? 0) + 1;
    prevText = true; blankSince = false;
    if (lines >= WEEKLY_MAX_LINES) break;
  }
  return out;
}

// 가장 많이 쓴 줄머리 기호(같으면 BULLETS 순서 앞). 글 줄이 없으면 null.
export function mainBullet(bullets) {
  let best = null, n = 0;
  for (const b of BULLETS) { const c = bullets?.[b] ?? 0; if (c > n) { best = b; n = c; } }
  return best;
}
// 빈 줄 띄우기 꼴: 사이의 절반 넘게 띄웠으면 'blank', 하나도 안 띄웠으면 'tight', 그 사이는 'mixed', 사이가 없으면 null.
export function gapStyle(st) {
  if (!st || !st.gaps) return null;
  if (st.blank_gaps === 0) return 'tight';
  return st.blank_gaps * 2 > st.gaps ? 'blank' : 'mixed';
}
const headingStyle = st => (!st || !st.headings ? null : st.heading_blank * 2 > st.headings ? 'blank' : 'tight');
const indentStyle = st => (!st || !st.lines ? null : st.indented * 2 > st.lines ? 'indent' : 'flat');

// Web2 판 문단 ↔ 고친 판 문단 → 환류 기록에 실을 layout(숫자·짧은 표시만). 견줄 절이 하나도 없으면 null.
// sections[절] = {before:{gap, heading, bullet, indent}, after:{…}, changed:[바뀐 항목 이름]}
export function layoutDiff(issuedParas, finalParas) {
  const a = layoutStats(issuedParas), b = layoutStats(finalParas), sections = {};
  for (const section of WEEKLY_SECTIONS) {
    const x = a[section], y = b[section];
    if (!x?.lines || !y?.lines) continue;
    const before = {gap: gapStyle(x), heading: headingStyle(x), bullet: mainBullet(x.bullets), indent: indentStyle(x)};
    const after = {gap: gapStyle(y), heading: headingStyle(y), bullet: mainBullet(y.bullets), indent: indentStyle(y)};
    const changed = Object.keys(before).filter(k => before[k] !== null && after[k] !== null && before[k] !== after[k]);
    sections[section] = {before, after, changed};
  }
  return Object.keys(sections).length ? readLayout({v: LAYOUT_VERSION, sections}) : null;
}

// ---- 저장 모양(draft.feedback.layout) ----
const STYLE = {gap: ['blank', 'tight', 'mixed'], heading: ['blank', 'tight'], bullet: BULLETS, indent: ['indent', 'flat']};
const KEYS = Object.keys(STYLE);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const cleanSide = side => Object.fromEntries(KEYS.map(k => [k, isObj(side) && STYLE[k].includes(side[k]) ? side[k] : null]));
// 서버에서 읽은 layout 을 모양대로만 받는다(모르는 절·값은 버림). 쓸 절이 없거나 상한을 넘으면 null.
export function readLayout(raw) {
  if (!isObj(raw) || raw.v !== LAYOUT_VERSION || !isObj(raw.sections)) return null;
  const sections = {};
  for (const section of WEEKLY_SECTIONS) {
    const s = raw.sections[section];
    if (!isObj(s)) continue;
    const before = cleanSide(s.before), after = cleanSide(s.after);
    const changed = KEYS.filter(k => before[k] !== null && after[k] !== null && before[k] !== after[k]);
    sections[section] = {before, after, changed};
  }
  if (!Object.keys(sections).length) return null;
  const out = {v: LAYOUT_VERSION, sections};
  return new TextEncoder().encode(JSON.stringify(out)).length > LAYOUT_MAX_BYTES ? null : out;
}

// 최근 몇 주 layout(새 것부터) → 따를 모양. 절·항목마다 '고친 판(after)' 값이 HABIT_MIN_WEEKS 주 넘게 같고, 그보다 많이 다른 값이 나오지 않았을 때만.
// 반환: {절: {gap?, heading?, bullet?, indent?}} — 없는 항목은 지금 양식 그대로 둔다(한글 파일 만들기가 읽음, 설계 7절 ⑨).
export function layoutHabit(layouts = []) {
  const recent = (Array.isArray(layouts) ? layouts : []).map(readLayout).filter(Boolean).slice(0, LAYOUT_WEEKS);
  const out = {};
  for (const section of WEEKLY_SECTIONS) {
    for (const k of KEYS) {
      const count = new Map();
      for (const l of recent) { const v = l.sections[section]?.after?.[k]; if (v) count.set(v, (count.get(v) ?? 0) + 1); }
      const ranked = [...count].sort((p, q) => q[1] - p[1]);
      if (!ranked.length || ranked[0][1] < HABIT_MIN_WEEKS || (ranked[1] && ranked[1][1] === ranked[0][1])) continue;
      (out[section] ??= {})[k] = ranked[0][0];
    }
  }
  return out;
}

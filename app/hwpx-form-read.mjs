// 한글 양식 읽기(공용 한 모듈) — WEEKLY-내양식자유변형 ②와 PRODUCT-판매준비범용화 '한글 양식 올리기'가 같이 쓴다(요청 원문 ⑥: 한 번만 만든다).
// 올린 한글 파일(.hwpx 묶음)의 본문에서 규칙으로 양식 뼈대만 읽는다: 문서 제목, 항목(번호·기호·제목 스타일로 시작하는 짧은 줄)의
// 순서·이름·단계, 항목마다 표 머리 줄 칸 이름. 본문 글(보고 내용)은 읽어 두지 않는다 — 돌려주는 것은 양식 글자뿐이다.
// AI 없음. 표 없이 글로만 된 양식은 항목만 나오거나 아무것도 안 나올 수 있다 → 화면이 손 편집으로 넘긴다(요청 원문 ⑥).
// .hwp(5.x)는 부르는 쪽이 먼저 .hwpx로 바꿔 넘긴다(journal-hwpx.js 변환 엔진). 화면·서버 없는 순수 함수(node 시험이 부른다).
// WEEKLY-내양식자유변형 ⑤-3(사용자 결정 11/17 '나'):
//  - 회의 결과 상자(왼쪽 칸 이름 | 오른쪽 내용, 2열)는 첫 줄을 표 머리로 읽지 않는다 — 왼쪽 칸 이름만 칸 이름으로 읽고 오른쪽 본문 글은 읽지 않는다.
//  - readBaseForm(pkg): 바탕(확정본) 파일에서 한글 파일 엔진이 쓸 '내 양식'(자리가 모두 붙은 것)을 읽는다. 자리는 form-profile.mjs 의
//    큰 항목 차례(ROLE_GROUPS)·표 칸 수로만 붙이고, 제목·칸 이름 글자는 파일에 적힌 그대로다. 모양이 하나라도 틀에 맞지 않으면
//    추측하지 않고 {reason}만 돌려준다(부르는 쪽이 저장하지 않고 한 줄 안내 — 몰래 틀리게 만들지 않음).
import {parseXml, kids, kid} from './weekly-hwpx/xml.mjs';
import {readText, headerStyles} from './weekly-hwpx/hwpx.mjs';
import {cleanForm, guessFill, MAX_SECTIONS, MAX_COLUMNS, TITLE_MAX, COLUMN_MAX} from './weekly-own-form-model.mjs';
import {ROLE_GROUPS, ROLE_FILL, TABLE_ROLES} from './weekly-hwpx/form-profile.mjs';

const HEADING_MAX = 40; // 항목 이름으로 볼 줄 길이 상한(이보다 길면 본문 글)
// 1단계: 1. / 1) 없이 숫자+점, Ⅰ. / I. 로마 숫자, □ ■ ◆ 큰 네모. 2단계: 가. 나., 1) (1) ①, ○ ● ◦ - 같은 작은 기호.
const LEVEL1 = /^(?:\d{1,2}\s*[.．]\s*|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]\s*[.．]?\s*|(?:I{1,3}|IV|V|VI{0,3}|IX|X)\s*[.．]\s+|[□■◆◇▣]\s*)/;
const LEVEL2 = /^(?:[가-하]\s*[.．)]\s*|\(?\d{1,2}\)\s*|[①-⑳]\s*|[○●◎▶▷◦]\s*)/;
const DATE_ONLY = /^[\s\d년월일.()~∼\-–/:시분(월화수목금토일)]*$/;

const sectionNames = pkg => [...pkg.files.keys()].filter(n => /^Contents\/section\d+\.xml$/.test(n))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

// 문단 자신의 글(안에 든 표 글은 빼고). hp:t 안의 탭·줄바꿈 표시는 빈칸으로.
function ownText(p) {
  let out = '';
  const visit = n => {
    for (const c of n.children ?? []) {
      if ('text' in c) { out += c.text; continue; }
      if (c.name === 'hp:tbl') continue;
      if (c.name === 'hp:tab' || c.name === 'hp:lineBreak') { out += ' '; continue; }
      visit(c);
    }
  };
  for (const run of kids(p, 'hp:run')) for (const c of run.children) if (c.name === 'hp:t') visit(c);
  return out.replace(/\s+/g, ' ').trim();
}
const tablesOf = p => kids(p, 'hp:run').flatMap(r => kids(r, 'hp:tbl'));
const cellText = tc => {
  const sub = kid(tc, 'hp:subList');
  return (sub ? kids(sub, 'hp:p') : []).map(ownText).filter(Boolean).join(' ').trim();
};
// 회의 결과 상자: 2열, 3줄 이상, 줄마다 칸 둘이고 왼쪽 칸(칸 이름)끼리·오른쪽 칸(내용)끼리 테두리 모양이 같고 둘은 다르다.
// (보통 표는 머리 줄 칸끼리 테두리가 같아 여기 들지 않는다.) 왼쪽 칸 이름 목록(빈 칸 뺌, 차례 그대로).
function boxLabelsOf(tbl) {
  const rows = kids(tbl, 'hp:tr').map(tr => kids(tr, 'hp:tc'));
  if (rows.length < 3 || rows.some(r => r.length !== 2)) return null;
  const left = rows[0][0].attrs.borderFillIDRef, right = rows[0][1].attrs.borderFillIDRef;
  if (left === right || rows.some(([l, r]) => l.attrs.borderFillIDRef !== left || r.attrs.borderFillIDRef !== right)) return null;
  return rows.map(([l]) => cellText(l)).filter(Boolean);
}
// 상자 칸 이름 합치기(같은 이름은 한 번, 처음 나온 차례).
const mergeLabels = (have, more) => [...new Set([...have, ...more])];
// 표 머리 칸: 첫 줄 칸 글. 첫 줄이 비었으면 글이 있는 첫 줄.
function headOf(tbl) {
  for (const tr of kids(tbl, 'hp:tr')) {
    const cells = kids(tr, 'hp:tc').map(cellText);
    if (cells.some(Boolean)) return cells.map((c, i) => c || `칸 ${i + 1}`);
  }
  return [];
}

// 제목 스타일(머리 표 이름에 '제목'이 든 것, 표 안 글자 스타일은 뺌) id → 단계.
function headingStyles(pkg) {
  const map = new Map();
  try {
    const text = readText(pkg, 'Contents/header.xml');
    if (!text) return map;
    for (const s of headerStyles(parseXml(text))) {
      const name = String(s.name ?? '');
      if (!/제목/.test(name) || /표|안건/.test(name)) continue;
      map.set(String(s.id), /큰|개요\s*1/.test(name) ? 1 : 2);
    }
  } catch { /* 머리 표를 못 읽으면 번호·기호 규칙만 쓴다 */ }
  return map;
}

function headingLevel(text, styleLevel) {
  if (!text || text.length > HEADING_MAX || DATE_ONLY.test(text)) return 0;
  if (LEVEL1.test(text)) return 1;
  if (LEVEL2.test(text)) return 2;
  return styleLevel || 0;
}

// pkg: openHwpx/openHwpxAsync 결과. → {title, form:{v, sections}, tables(읽은 표 수)}.
// 못 읽는 묶음(본문 없음·XML 깨짐)은 Error('form_unreadable').
export function readHwpxForm(pkg) {
  const names = sectionNames(pkg);
  if (!names.length) throw new Error('form_unreadable');
  const styles = headingStyles(pkg);
  const sections = [];
  let title = '', lastShort = '', tables = 0, seenBody = false;
  const push = (t, level) => { if (sections.length < MAX_SECTIONS) sections.push({title: t, level, columns: []}); };
  for (const name of names) {
    let doc;
    try { doc = parseXml(readText(pkg, name)); } catch { throw new Error('form_unreadable'); }
    for (const p of kids(doc.root, 'hp:p')) {
      const text = ownText(p);
      const level = headingLevel(text, styles.get(String(p.attrs.styleIDRef ?? '')));
      if (level) { push(text, level); lastShort = ''; }
      else if (text) {
        // 첫 항목 앞 첫 짧은 줄(날짜만인 줄 빼고)은 문서 제목.
        if (!sections.length && !title && !seenBody && text.length <= HEADING_MAX && !DATE_ONLY.test(text)) title = text;
        else seenBody = true;
        lastShort = text.length <= HEADING_MAX && !DATE_ONLY.test(text) ? text : '';
      }
      for (const tbl of tablesOf(p)) {
        const box = boxLabelsOf(tbl);
        const head = box ?? headOf(tbl);
        if (!head.length) continue;
        tables++;
        let cur = sections[sections.length - 1];
        // 상자가 이어 나오면(같은 항목 아래 회의 결과 상자 여러 개) 새 항목을 만들지 않고 칸 이름만 합친다.
        if (box && cur?.box) { cur.columns = mergeLabels(cur.columns, box); lastShort = ''; continue; }
        // 항목 없이 나온 표, 또는 이미 표가 있는 항목 아래 또 나온 표: 바로 위 짧은 줄을 이름으로 새 항목(없으면 '표 n').
        if (!cur || cur.columns.length) {
          push(lastShort || (cur ? `${cur.title} 표 ${tables}` : `표 ${tables}`), cur ? 2 : 1);
          cur = sections[sections.length - 1];
        }
        if (cur && !cur.columns.length) { cur.columns = head; if (box) cur.box = true; }
        lastShort = '';
      }
    }
  }
  const form = cleanForm({sections: sections.map(({box, ...s}, i) => ({id: `s${i + 1}`, ...s, fill: guessFill(s.title, s.columns)}))});
  return {title, form, tables};
}

// ---- 바탕 파일 → 엔진 '내 양식'(⑤-3 '나') ----
// 큰 항목: 숫자+점(1. 2.)·로마 숫자. 작은 항목: 1) (1) 가. ①. 기호(□ ■ ○ ◦)로 시작하는 줄은 본문으로 본다(■ 일시 줄·◦ 일정 줄 등).
const BASE_BIG = /^(?:\d{1,2}\s*[.．](?!\d)|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]\s*[.．]?)\s*\S/;
const BASE_SMALL = /^(?:\(?\d{1,2}\)|[가-하]\s*[.．)]|[①-⑳])\s*\S/;
// 이유(화면 한 줄에 쓰는 열쇠 — 파일 글은 넣지 않는다).
export const BASE_FORM_REASONS = Object.freeze(['unreadable', 'groups', 'items', 'table', 'long']);

// pkg → {form}(자리 모두 붙음, cleanForm 통과) | {reason}. 상자 칸 이름이 없으면(그 주에 회의 결과 상자 없음) details 칸은 빈 목록.
export function readBaseForm(pkg) {
  const names = sectionNames(pkg);
  if (!names.length) return {reason: 'unreadable'};
  const groups = [];
  let group = null, before = false;
  for (const name of names) {
    let doc;
    try { doc = parseXml(readText(pkg, name)); } catch { return {reason: 'unreadable'}; }
    for (const p of kids(doc.root, 'hp:p')) {
      const text = ownText(p);
      const short = text && text.length <= HEADING_MAX;
      if (short && BASE_BIG.test(text)) groups.push(group = {title: text, subs: [], tables: []});
      else if (short && group && BASE_SMALL.test(text)) group.subs.push({title: text, tables: []});
      for (const tbl of tablesOf(p)) {
        if (!group) { before = true; continue; }
        const at = group.subs[group.subs.length - 1] ?? group;
        at.tables.push(tbl);
      }
    }
  }
  if (before) return {reason: 'table'};
  if (groups.length !== ROLE_GROUPS.length) return {reason: 'groups'};
  const sections = [];
  const tableColumns = (role, list) => {
    const want = TABLE_ROLES[role];
    if (!want) return list.length ? null : [];
    if (list.length !== 1) return null;
    const head = kids(kids(list[0], 'hp:tr')[0] ?? {children: []}, 'hp:tc').map(cellText);
    return head.length === want[1] && head.every(Boolean) ? head : null;
  };
  for (const [i, {role, children}] of ROLE_GROUPS.entries()) {
    const g = groups[i];
    const own = tableColumns(role, g.tables);
    if (!own) return {reason: 'table'};
    sections.push({role, level: 1, title: g.title, columns: own});
    const boxAt = children.indexOf('details');
    // 회의 결과 상자 자리는 그 큰 항목의 끝까지(상자마다 붙는 '(1) 회의 이름' 줄과 상자는 보고 내용이라 항목으로 세지 않는다).
    if (boxAt >= 0 ? g.subs.length < boxAt + 1 || boxAt !== children.length - 1 : g.subs.length !== children.length) return {reason: 'items'};
    for (const [k, child] of children.entries()) {
      const sub = g.subs[k];
      if (child === 'details') {
        let labels = [];
        for (const tbl of g.subs.slice(k).flatMap(s => s.tables)) {
          const rows = kids(tbl, 'hp:tr').map(tr => kids(tr, 'hp:tc'));
          if (rows.some(r => r.length !== 2)) return {reason: 'table'};
          labels = mergeLabels(labels, rows.map(([l]) => cellText(l)).filter(Boolean));
        }
        sections.push({role: child, level: 2, title: sub.title, columns: labels});
        continue;
      }
      const columns = tableColumns(child, sub.tables);
      if (!columns) return {reason: 'table'};
      sections.push({role: child, level: 2, title: sub.title, columns});
    }
  }
  // 저장하면 글이 잘리거나 칸이 빠지는 양식(긴 제목·많은 칸)은 파일 글 그대로가 아니게 되므로 받지 않는다.
  if (sections.some(s => s.title.length > TITLE_MAX || s.columns.length > MAX_COLUMNS || s.columns.some(c => c.length > COLUMN_MAX))) return {reason: 'long'};
  const form = cleanForm({sections: sections.map(s => ({id: s.role, ...s, fill: ROLE_FILL[s.role]}))});
  if (form.sections.length !== sections.length) return {reason: 'items'};
  return {form};
}

// 한글 양식 읽기(공용 한 모듈) — WEEKLY-내양식자유변형 ②와 PRODUCT-판매준비범용화 '한글 양식 올리기'가 같이 쓴다(요청 원문 ⑥: 한 번만 만든다).
// 올린 한글 파일(.hwpx 묶음)의 본문에서 규칙으로 양식 뼈대만 읽는다: 문서 제목, 항목(번호·기호·제목 스타일로 시작하는 짧은 줄)의
// 순서·이름·단계, 항목마다 표 머리 줄 칸 이름. 본문 글(보고 내용)은 읽어 두지 않는다 — 돌려주는 것은 양식 글자뿐이다.
// AI 없음. 표 없이 글로만 된 양식은 항목만 나오거나 아무것도 안 나올 수 있다 → 화면이 손 편집으로 넘긴다(요청 원문 ⑥).
// .hwp(5.x)는 부르는 쪽이 먼저 .hwpx로 바꿔 넘긴다(journal-hwpx.js 변환 엔진). 화면·서버 없는 순수 함수(node 시험이 부른다).
import {parseXml, kids, kid} from './weekly-hwpx/xml.mjs';
import {readText, headerStyles} from './weekly-hwpx/hwpx.mjs';
import {cleanForm, guessFill, MAX_SECTIONS} from './weekly-own-form-model.mjs';

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
        const head = headOf(tbl);
        if (!head.length) continue;
        tables++;
        let cur = sections[sections.length - 1];
        // 항목 없이 나온 표, 또는 이미 표가 있는 항목 아래 또 나온 표: 바로 위 짧은 줄을 이름으로 새 항목(없으면 '표 n').
        if (!cur || cur.columns.length) {
          push(lastShort || (cur ? `${cur.title} 표 ${tables}` : `표 ${tables}`), cur ? 2 : 1);
          cur = sections[sections.length - 1];
        }
        if (cur && !cur.columns.length) cur.columns = head;
        lastShort = '';
      }
    }
  }
  const form = cleanForm({sections: sections.map((s, i) => ({id: `s${i + 1}`, ...s, fill: guessFill(s.title, s.columns)}))});
  return {title, form, tables};
}

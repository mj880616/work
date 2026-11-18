// PRODUCT-판매준비범용화한글양식 작업 1(S62-10): 한글 양식 왕복(HWP → HWPX → 칸 하나 고침 → HWP) 비교.
// 엔진이 읽은 두 파일(.hwpx로 바꾼 것)의 뼈대를 세어 '바뀐 것 목록'을 만든다. 목록에는 개수·종류·위치만 넣고
// 글 내용은 넣지 않는다(실제 업무 파일을 비교할 때도 결과를 공개 자리에 옮길 수 있게).
// 시험: tests/hwp-roundtrip-compare.test.mjs(뼈대 세기), tests/app-e2e/hwp-roundtrip.spec.mjs(브라우저 엔진 왕복).
import {openHwpx, packHwpx, readXml, setXml} from '../../app/weekly-hwpx/hwpx.mjs';
import {walk, kid, kids} from '../../app/weekly-hwpx/xml.mjs';

const sectionNames = pkg => [...pkg.files.keys()].filter(n => /^Contents\/section\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
const ownText = p => kids(p, 'hp:run').flatMap(r => kids(r, 'hp:t')).map(t => t.children.map(c => c.text ?? '').join('')).join('');
const bool = (node, name) => (kid(node, name) ? 1 : 0);

// 글자 모양 번호가 다시 매겨져도 같은 모양이면 같게 보도록, 번호 대신 모양(크기·색·굵게·기울임·밑줄·글꼴 번호)으로 적는다.
function charSignatures(header) {
  const map = new Map();
  for (const c of walk(header.root)) {
    if (c.name !== 'hh:charPr') continue;
    const font = kid(c, 'hh:fontRef')?.attrs ?? {};
    const under = kid(c, 'hh:underline')?.attrs?.type ?? 'NONE';
    map.set(c.attrs.id, [c.attrs.height, (c.attrs.textColor || '').toUpperCase(), bool(c, 'hh:bold'), bool(c, 'hh:italic'), under, font.hangul ?? ''].join('/'));
  }
  return map;
}
function paraSignatures(header) {
  const map = new Map();
  for (const p of walk(header.root)) {
    if (p.name !== 'hh:paraPr') continue;
    const align = kid(p, 'hh:align')?.attrs?.horizontal ?? '';
    const spacing = [...walk(p)].find(n => n.name === 'hh:lineSpacing')?.attrs ?? {};
    map.set(p.attrs.id, [align, spacing.type ?? '', spacing.value ?? ''].join('/'));
  }
  return map;
}

// .hwpx 바이트 → 뼈대 요약. pages는 엔진이 잡은 쪽 수(밖에서 넣는다).
export function shapeOf(bytes, zlib, {pages = null} = {}) {
  const pkg = openHwpx(bytes, zlib);
  const header = readXml(pkg, 'Contents/header.xml');
  const chars = charSignatures(header), paraSig = paraSignatures(header);
  const shape = {pages, sections: 0, paragraphs: [], tables: [], headers: 0, footers: 0, runs: [], pageSetup: [], styles: 0};
  shape.styles = [...walk(header.root)].filter(n => n.name === 'hh:style').length;
  for (const name of sectionNames(pkg)) {
    shape.sections++;
    const sec = readXml(pkg, name);
    for (const n of walk(sec.root)) {
      if (n.name === 'hp:p') {
        shape.paragraphs.push({text: ownText(n), para: paraSig.get(n.attrs.paraPrIDRef) ?? `?${n.attrs.paraPrIDRef}`});
        for (const r of kids(n, 'hp:run')) {
          const len = kids(r, 'hp:t').map(t => t.children.map(c => c.text ?? '').join('')).join('').length;
          if (len) shape.runs.push({chars: len, look: chars.get(r.attrs.charPrIDRef) ?? `?${r.attrs.charPrIDRef}`});
        }
      } else if (n.name === 'hp:tbl') {
        const cells = [...walk(n)].filter(c => c.name === 'hp:tc' && nearestTable(n, c));
        shape.tables.push({
          rows: Number(n.attrs.rowCnt), cols: Number(n.attrs.colCnt), cells: cells.length,
          merged: cells.map(c => ({row: Number(kid(c, 'hp:cellAddr')?.attrs.rowAddr), col: Number(kid(c, 'hp:cellAddr')?.attrs.colAddr),
            rowSpan: Number(kid(c, 'hp:cellSpan')?.attrs.rowSpan ?? 1), colSpan: Number(kid(c, 'hp:cellSpan')?.attrs.colSpan ?? 1)}))
            .filter(c => c.rowSpan > 1 || c.colSpan > 1),
          texts: cells.map(c => ({row: Number(kid(c, 'hp:cellAddr')?.attrs.rowAddr), col: Number(kid(c, 'hp:cellAddr')?.attrs.colAddr),
            text: [...walk(kid(c, 'hp:subList') ?? {children: []})].filter(p => p.name === 'hp:p').map(ownText).join('\n')})),
        });
      } else if (n.name === 'hp:header') shape.headers++;
      else if (n.name === 'hp:footer') shape.footers++;
      else if (n.name === 'hp:pagePr') {
        const m = kid(n, 'hp:margin')?.attrs ?? {};
        shape.pageSetup.push([n.attrs.width, n.attrs.height, n.attrs.landscape, m.left, m.right, m.top, m.bottom, m.header, m.footer].join('/'));
      }
    }
  }
  return shape;
}
// 표 안 표의 칸은 바깥 표의 칸으로 세지 않는다: 칸에서 위로 올라가 처음 만나는 표가 이 표인지 본다.
function nearestTable(table, cell) {
  const path = [];
  const find = node => {
    if (node === cell) return true;
    for (const c of node.children ?? []) { path.push(node); if (find(c)) return true; path.pop(); }
    return false;
  };
  find(table);
  return path.filter(n => n.name === 'hp:tbl').at(-1) === table;
}

// 두 뼈대 비교 → 바뀐 것 목록 [{kind, detail}]. 글 내용 없이 개수·위치만.
export function diffShapes(a, b) {
  const out = [];
  const add = (kind, detail) => out.push({kind, detail});
  if (a.pages !== null && b.pages !== null && a.pages !== b.pages) add('쪽 수', `${a.pages} → ${b.pages}`);
  if (a.sections !== b.sections) add('구역 수', `${a.sections} → ${b.sections}`);
  if (a.headers !== b.headers) add('머리말 수', `${a.headers} → ${b.headers}`);
  if (a.footers !== b.footers) add('꼬리말 수', `${a.footers} → ${b.footers}`);
  if (a.styles !== b.styles) add('스타일 수', `${a.styles} → ${b.styles}`);
  if (a.pageSetup.join('|') !== b.pageSetup.join('|')) add('쪽 설정', '용지·여백 값이 다름');
  if (a.paragraphs.length !== b.paragraphs.length) add('문단 수', `${a.paragraphs.length} → ${b.paragraphs.length}`);
  const n = Math.min(a.paragraphs.length, b.paragraphs.length);
  let textDiff = 0, paraDiff = 0;
  for (let i = 0; i < n; i++) {
    if (a.paragraphs[i].text !== b.paragraphs[i].text) textDiff++;
    if (a.paragraphs[i].para !== b.paragraphs[i].para) paraDiff++;
  }
  if (textDiff) add('문단 글', `${textDiff}개 문단의 글이 다름`);
  if (paraDiff) add('문단 모양', `${paraDiff}개 문단의 정렬·줄간격이 다름`);
  const looks = r => r.map(x => `${x.look}×${x.chars}`);
  const la = looks(a.runs), lb = looks(b.runs);
  if (la.length !== lb.length) add('글자 모양 구간 수', `${la.length} → ${lb.length}`);
  const lookDiff = la.filter((x, i) => lb[i] !== undefined && x.split('×')[0] !== lb[i].split('×')[0]).length;
  if (lookDiff) add('글자 모양', `${lookDiff}개 구간의 크기·색·굵기 등이 다름`);
  if (a.tables.length !== b.tables.length) add('표 수', `${a.tables.length} → ${b.tables.length}`);
  a.tables.forEach((ta, i) => {
    const tb = b.tables[i];
    if (!tb) return;
    const at = `표 ${i + 1}`;
    if (ta.rows !== tb.rows || ta.cols !== tb.cols) add('표 크기', `${at}: ${ta.rows}×${ta.cols} → ${tb.rows}×${tb.cols}`);
    if (ta.cells !== tb.cells) add('표 칸 수', `${at}: ${ta.cells} → ${tb.cells}`);
    const m = x => x.merged.map(c => `${c.row},${c.col},${c.rowSpan},${c.colSpan}`).sort().join(' ');
    if (m(ta) !== m(tb)) add('합친 칸', `${at}: ${ta.merged.length}개 → ${tb.merged.length}개(위치·크기 다름)`);
    const tbMap = new Map(tb.texts.map(c => [`${c.row},${c.col}`, c.text]));
    for (const c of ta.texts) {
      const other = tbMap.get(`${c.row},${c.col}`);
      if (other !== undefined && other !== c.text) add('칸 글', `${at} ${c.row + 1}행 ${c.col + 1}열`);
    }
  });
  return out;
}

// 뼈대 요약의 숫자만(보고·PR용, 글 내용 없음).
export function shapeCounts(s) {
  return {
    pages: s.pages, sections: s.sections, paragraphs: s.paragraphs.length, tables: s.tables.length,
    cells: s.tables.reduce((t, x) => t + x.cells, 0), merged: s.tables.reduce((t, x) => t + x.merged.length, 0),
    charLooks: new Set(s.runs.map(r => r.look)).size, runs: s.runs.length, headers: s.headers, footers: s.footers, styles: s.styles,
  };
}

// 표 n번째(0부터)의 (row, col) 칸 첫 문단 글을 바꾼다. 글자 모양(run의 charPrIDRef)은 그대로 둔다. → 새 .hwpx 바이트
export function editCell(bytes, zlib, {table = 0, row, col, text}) {
  const pkg = openHwpx(bytes, zlib);
  for (const name of sectionNames(pkg)) {
    const sec = readXml(pkg, name);
    const tables = [...walk(sec.root)].filter(n => n.name === 'hp:tbl');
    if (table >= tables.length) { table -= tables.length; continue; }
    const tbl = tables[table];
    const cell = [...walk(tbl)].find(c => c.name === 'hp:tc' && nearestTable(tbl, c)
      && Number(kid(c, 'hp:cellAddr')?.attrs.rowAddr) === row && Number(kid(c, 'hp:cellAddr')?.attrs.colAddr) === col);
    if (!cell) throw new Error(`칸을 찾지 못함: 표 ${table + 1} ${row},${col}`);
    const p = kids(kid(cell, 'hp:subList'), 'hp:p')[0];
    const runs = kids(p, 'hp:run');
    // 첫 글 조각에 새 글을 넣고 나머지 글 조각은 비운다. 글 조각이 없으면 첫 run에 하나 단다.
    const pieces = runs.flatMap(r => kids(r, 'hp:t'));
    if (pieces.length) pieces.forEach((t, i) => { t.children = i === 0 ? [{text}] : []; });
    else runs[0].children.push({name: 'hp:t', attrs: {}, children: [{text}]});
    setXml(pkg, name, sec);
    return packHwpx(pkg, zlib);
  }
  throw new Error(`표가 없음: ${table + 1}번째`);
}

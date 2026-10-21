// WEEKLY-한글초안 시제품: "빈 서식" 다루기.
// 빈 서식 = 원본 보고서에서 스타일 표(header.xml)·쪽 설정·문단 견본·표 틀(머리 줄 + 빈 견본 줄)만 남기고 글은 모두 지운 .hwpx.
// 빈 서식 안의 글자는 FORM_LABELS(표 머리 칸 이름)뿐이어야 한다(assertBlank).
import {el, clone, kid, kids, walk, textOf} from './xml.mjs';
import {readXml, setXml, setText, removePart, clonePkg, headerStyles} from './hwpx.mjs';

// 표 머리 칸 이름(양식 글자). 이 밖의 글자는 빈 서식에 남으면 안 된다.
export const REQUEST_HEAD = Object.freeze(['일', '시간/내용/장소', '참석 요청']);
export const SUMMARY_HEAD = Object.freeze(['사업영역', '세부 과제', '진행 상황 및 이후 계획', '담당 팀원']);
// 조직보고 이후 절(상집보고 전체 구조, W3 확대): 3. 투쟁 사업 1)·2), 4. 산하조직 현황 1), 5. 주요 일정
export const RALLY_HEAD = Object.freeze(['일시/장소', '집회/행사명', '참석현황']);
export const SITE_HEAD = Object.freeze(['조직명', '현황']);
export const ORG_HEAD = Object.freeze(['사업장', '조직현황']);
export const SCHEDULE_HEAD = Object.freeze(['일', '시간/내용/장소', '참석자']);
export const HEADED_TABLES = Object.freeze({requestTable: REQUEST_HEAD, summaryTable: SUMMARY_HEAD, rallyTable: RALLY_HEAD, siteTable: SITE_HEAD, orgTable: ORG_HEAD, scheduleTable: SCHEDULE_HEAD});
export const FORM_LABELS = Object.freeze([...new Set(Object.values(HEADED_TABLES).flat())]);
// 회의 결과 상자(2열: 왼쪽 칸 이름 | 내용)의 왼쪽 칸 이름. 같은 문서 안에서 세 가지 묶음이 섞여 쓰인다(기획 문서 1.2절).
// 상자 견본은 칸 이름을 지운 채 빈 서식에 넣고, 칸 이름은 보고 자료가 준다.
export const BOX_LABELS = Object.freeze(['제목', '회의제목', '일시/장소', '참석자', '회의 내용', '내용', '차기일정', '보고', '논의결과', '*차기회의']);
// 빈 서식 본문 견본 순서. 앞 6개는 문단 견본, 뒤 7개는 표 견본(각각 원본에서 표를 담고 있던 문단 속성을 따른다).
export const PROTO_ORDER = Object.freeze(['title', 'body', 'big', 'mid', 'small', 'note',
  'requestTable', 'summaryTable', 'boxTable', 'rallyTable', 'siteTable', 'orgTable', 'scheduleTable']);
export const STYLE_OF = Object.freeze({title: '안건제목', body: '바탕글', big: '큰 제목', mid: '중간 제목', small: '작은 제목', note: '표내부', cell: '표내부'});

// 68바이트 흰 PNG(1×1). 미리보기 그림에 원본 첫 쪽 모습이 남지 않게 바꿔 넣는다.
const BLANK_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/bwXO7YAAAAASUVORK5CYII='), c => c.charCodeAt(0));

const isTable = n => n.name === 'hp:tbl';
const tablesIn = p => [...walk(p)].filter(isTable);
const cellText = tc => textOf(tc).trim();
const headTexts = tbl => kids(kids(tbl, 'hp:tr')[0] ?? el('x'), 'hp:tc').map(cellText);

// 문단 견본: 문단 속성 + 첫 글자 run의 글자 모양. 글은 비움. 첫 문단이면 쪽 설정(secPr·단 설정 run)을 그대로 둔다.
function protoParagraph(p, {keepSection = false} = {}) {
  const out = el('hp:p', {...p.attrs});
  const runs = kids(p, 'hp:run');
  if (keepSection) {
    const sec = runs.find(r => r.children.some(c => c.name === 'hp:secPr'));
    if (sec) out.children.push(el('hp:run', {...sec.attrs}, sec.children.filter(c => c.name === 'hp:secPr' || c.name === 'hp:ctrl').map(clone)));
  }
  const textRun = runs.find(r => r.children.some(c => c.name === 'hp:t')) ?? runs[runs.length - 1];
  out.children.push(el('hp:run', {charPrIDRef: textRun?.attrs.charPrIDRef ?? '0'}));
  return out;
}

// 칸 견본: 칸 속성·subList 속성·칸 크기·여백 + 첫 문단 견본.
function protoCell(tc, row, col, colSpan, width, text = '') {
  const sub = kid(tc, 'hp:subList');
  const p = protoParagraph(kids(sub, 'hp:p')[0]);
  if (text) p.children[0].children.push(el('hp:t', {}, [{text}]));
  return el('hp:tc', {...tc.attrs}, [
    el('hp:subList', {...sub.attrs}, [p]),
    el('hp:cellAddr', {colAddr: String(col), rowAddr: String(row)}),
    el('hp:cellSpan', {colSpan: String(colSpan), rowSpan: '1'}),
    el('hp:cellSz', {width: String(width), height: kid(tc, 'hp:cellSz').attrs.height}),
    clone(kid(tc, 'hp:cellMargin')),
  ]);
}

// 원본 표 → 논리 열(머리 칸 하나 = 열 하나)로 맞춘 견본 표(머리 줄 + 빈 견본 줄 하나).
// 원본의 4열 요청 표처럼 숨은 좁은 열이 있어도 머리 칸 기준 3열로 정리한다.
function protoTable(tbl) {
  const rows = kids(tbl, 'hp:tr');
  const head = kids(rows[0], 'hp:tc');
  const spans = head.map(tc => [Number(kid(tc, 'hp:cellAddr').attrs.colAddr), Number(kid(tc, 'hp:cellSpan').attrs.colSpan)]);
  const logical = start => spans.findIndex(([a, s]) => start >= a && start < a + s);
  const body = Array(head.length).fill(null);
  for (const tr of rows.slice(1)) {
    for (const tc of kids(tr, 'hp:tc')) {
      const i = logical(Number(kid(tc, 'hp:cellAddr').attrs.colAddr));
      if (i >= 0 && !body[i]) body[i] = tc;
    }
    if (body.every(Boolean)) break;
  }
  body.forEach((tc, i) => { if (!tc) body[i] = head[i]; });
  const widths = head.map(tc => Number(kid(tc, 'hp:cellSz').attrs.width));
  const out = el('hp:tbl', {...tbl.attrs, rowCnt: '2', colCnt: String(head.length)});
  for (const name of ['hp:sz', 'hp:pos', 'hp:outMargin', 'hp:inMargin']) { const n = kid(tbl, name); if (n) out.children.push(clone(n)); }
  out.children.push(el('hp:tr', {}, head.map((tc, i) => protoCell(tc, 0, i, 1, widths[i], cellText(tc)))));
  out.children.push(el('hp:tr', {}, body.map((tc, i) => protoCell(tc, 1, i, 1, widths[i]))));
  return out;
}

// 회의 결과 상자 견본: 2열, 칸 이름 칸 + 내용 칸 한 줄(둘 다 빈칸).
function protoBoxTable(tbl) {
  const [first] = kids(tbl, 'hp:tr');
  const [label, body] = kids(first, 'hp:tc');
  const widths = [label, body].map(tc => Number(kid(tc, 'hp:cellSz').attrs.width));
  const out = el('hp:tbl', {...tbl.attrs, rowCnt: '1', colCnt: '2'});
  for (const name of ['hp:sz', 'hp:pos', 'hp:outMargin', 'hp:inMargin']) { const n = kid(tbl, name); if (n) out.children.push(clone(n)); }
  out.children.push(el('hp:tr', {}, [protoCell(label, 0, 0, 1, widths[0]), protoCell(body, 0, 1, 1, widths[1])]));
  return out;
}
export const isBoxTable = tbl => tbl.attrs.colCnt === '2' && kids(tbl, 'hp:tr').length >= 3
  && kids(tbl, 'hp:tr').every(tr => BOX_LABELS.includes(cellText(kids(tr, 'hp:tc')[0] ?? el('x'))));

function anchorWith(p, tbl, make = protoTable) {
  const run = kids(p, 'hp:run').find(r => r.children.some(c => c === tbl || [...walk(c)].includes(tbl)));
  return el('hp:p', {...p.attrs}, [el('hp:run', {charPrIDRef: run.attrs.charPrIDRef}, [make(tbl)])]);
}

// 원본 보고서 .hwpx 묶음 → 빈 서식 묶음. 원본은 바꾸지 않는다.
export function extractBlankTemplate(source) {
  const pkg = clonePkg(source);
  const header = readXml(pkg, 'Contents/header.xml');
  const names = new Map(headerStyles(header).map(s => [s.id, s.name]));
  const sec = readXml(pkg, 'Contents/section0.xml');
  const top = kids(sec.root, 'hp:p');
  const styleName = p => names.get(p.attrs.styleIDRef);
  const find = name => top.find(p => styleName(p) === name && !tablesIn(p).length);
  const findTable = head => {
    for (const p of top) for (const t of tablesIn(p)) if (head.every((label, i) => headTexts(t)[i] === label)) return [p, t];
    throw new Error(`표 머리가 '${head.join(' | ')}'인 표가 없음`);
  };
  const findBox = () => {
    for (const p of top) for (const t of tablesIn(p)) if (isBoxTable(t)) return [p, t];
    throw new Error('회의 결과 상자(2열, 왼쪽 칸 이름 표)가 없음');
  };
  const first = top[0];
  if (!first || !kids(first, 'hp:run').some(r => r.children.some(c => c.name === 'hp:secPr'))) throw new Error('첫 문단에 쪽 설정이 없음');
  const small = find(STYLE_OF.small) ?? first;
  const protos = {
    title: protoParagraph(first, {keepSection: true}),
    body: protoParagraph(find(STYLE_OF.body) ?? first),
    big: protoParagraph(find(STYLE_OF.big) ?? first),
    mid: protoParagraph(find(STYLE_OF.mid) ?? small),
    small: protoParagraph(small),
    note: protoParagraph(find(STYLE_OF.note) ?? find(STYLE_OF.body) ?? first),
    boxTable: anchorWith(...findBox(), protoBoxTable),
  };
  for (const [key, head] of Object.entries(HEADED_TABLES)) protos[key] = anchorWith(...findTable(head));
  sec.root.children = PROTO_ORDER.map(k => protos[k]);
  renumber(sec.root);
  setXml(pkg, 'Contents/section0.xml', sec);
  // 그림·미리보기·문서 정보(제목·만든 사람)도 원본 흔적이므로 지운다.
  for (const name of [...pkg.order]) if (name.startsWith('BinData/') || /^Contents\/section[1-9]\d*\.xml$/.test(name)) removePart(pkg, name);
  setText(pkg, 'Preview/PrvText.txt', '');
  pkg.files.set('Preview/PrvImage.png', BLANK_PNG);
  if (!pkg.order.includes('Preview/PrvImage.png')) pkg.order.push('Preview/PrvImage.png');
  const hpf = readXml(pkg, 'Contents/content.hpf');
  for (const n of walk(hpf.root)) {
    if (n.name === 'opf:manifest') n.children = n.children.filter(i => !(i.attrs?.href ?? '').startsWith('BinData/') && !/^Contents\/section[1-9]\d*\.xml$/.test(i.attrs?.href ?? ''));
    if (n.name === 'opf:spine') n.children = n.children.filter(i => ['header', 'section0'].includes(i.attrs?.idref));
    if (n.name === 'opf:title') n.children = [];
    if (n.name === 'opf:meta') n.children = n.attrs.name === 'creator' ? [{text: 'Web2'}] : [];
  }
  setXml(pkg, 'Contents/content.hpf', hpf);
  const settings = readXml(pkg, 'settings.xml');
  for (const n of walk(settings.root)) if (n.name === 'ha:CaretPosition') Object.assign(n.attrs, {listIDRef: '0', paraIDRef: '0', pos: '0'});
  setXml(pkg, 'settings.xml', settings);
  return pkg;
}

export function renumber(root) {
  let p = 0;
  let t = 1;
  for (const n of walk(root)) {
    if (n.name === 'hp:p') n.attrs.id = String(p++);
    else if (n.name === 'hp:tbl') n.attrs.id = String(1000 + t++);
  }
}

// 빈 서식 견본 읽기(빌더가 씀).
export function readPrototypes(pkg) {
  const sec = readXml(pkg, 'Contents/section0.xml');
  const top = kids(sec.root, 'hp:p');
  if (top.length !== PROTO_ORDER.length) throw new Error(`빈 서식 견본 수가 ${PROTO_ORDER.length}개가 아님(${top.length})`);
  const protos = Object.fromEntries(PROTO_ORDER.map((k, i) => [k, top[i]]));
  for (const [key, head] of Object.entries(HEADED_TABLES)) {
    const [t] = tablesIn(protos[key]);
    if (!t || headTexts(t).join('|') !== head.join('|')) throw new Error(`빈 서식 ${key} 머리가 다름`);
  }
  if (!tablesIn(protos.boxTable).length) throw new Error('빈 서식에 상자 견본이 없음');
  return {sec, protos};
}

const HANGUL_OR_WORD = /[가-힣A-Za-z0-9]/;
// 빈 서식 검사: 본문 글자는 FORM_LABELS만, 그림·미리보기 글 없음, 문서 정보 비움, 머리(header.xml)의 글자는 스타일·글꼴 이름 칸에만.
// forbidden(선택): 원본에서 뽑은 글 조각 목록. 묶음 어디에든 2글자 이상 조각이 남으면 실패(양식 글자·스타일·글꼴 이름 안에 든 조각은 뺌). 결과에는 글 자체를 넣지 않고 개수만 낸다.
export function assertBlank(pkg, {forbidden = []} = {}) {
  const problems = [];
  const sec = readXml(pkg, 'Contents/section0.xml');
  const allowed = new Set(FORM_LABELS);
  let stray = 0;
  for (const n of walk(sec.root)) if (n.name === 'hp:t') { const t = textOf(el('x', {}, [n])).trim(); if (t && !allowed.has(t)) stray++; }
  if (stray) problems.push(`본문에 양식 밖 글 ${stray}개`);
  for (const n of walk(sec.root)) if (n.name === 'hp:pic' || n.name === 'hp:ole' || n.name === 'hp:container') { problems.push('본문에 그림·개체가 남음'); break; }
  if (pkg.order.some(n => n.startsWith('BinData/'))) problems.push('BinData(그림) 파일이 남음');
  const prv = new TextDecoder().decode(pkg.files.get('Preview/PrvText.txt') ?? new Uint8Array());
  if (prv.trim()) problems.push('미리보기 글이 남음');
  const hpf = readXml(pkg, 'Contents/content.hpf');
  for (const n of walk(hpf.root)) {
    if (n.name === 'opf:title' && textOf(n) + n.children.map(c => c.text ?? '').join('')) problems.push('문서 제목이 남음');
    if (n.name === 'opf:meta' && n.attrs.name !== 'creator' && n.children.some(c => (c.text ?? '').trim())) problems.push(`문서 정보 ${n.attrs.name}가 남음`);
  }
  const header = readXml(pkg, 'Contents/header.xml');
  for (const n of walk(header.root)) {
    for (const [k, v] of Object.entries(n.attrs)) {
      if (!/[가-힣]/.test(v)) continue;
      const ok = (n.name === 'hh:style' && (k === 'name' || k === 'engName')) || (n.name === 'hh:font' && k === 'face') || (n.name === 'hh:substFont' && k === 'face');
      if (!ok) { problems.push(`header.xml ${n.name}@${k}에 글자가 남음`); }
    }
    if (n.children.some(c => 'text' in c && HANGUL_OR_WORD.test(c.text) && !/^\^?\(?\^?\d?[.)]?\)?$/.test(c.text.trim()))) {
      // 번호 모양(^1. 같은 것) 말고 글이 있으면 문제
      if (!(n.name === 'hh:paraHead')) problems.push(`header.xml ${n.name}에 글이 남음`);
    }
  }
  if (forbidden.length) {
    const blob = [...pkg.files].filter(([name]) => /\.(xml|hpf|rdf|txt)$/.test(name)).map(([, data]) => new TextDecoder().decode(data)).join('\n');
    const allowedText = new Set([...FORM_LABELS, ...BOX_LABELS, ...headerStyles(header).map(s => s.name), ...[...walk(header.root)].filter(n => n.name === 'hh:font').map(n => n.attrs.face)]);
    const hits = forbidden.map(s => s.trim()).filter(s => [...s].length >= 2 && HANGUL_OR_WORD.test(s) && ![...allowedText].some(a => a.includes(s))).filter(s => blob.includes(s) || blob.includes(escapeForXml(s)));
    if (hits.length) problems.push(`원본 글 조각 ${hits.length}개가 남음`);
  }
  return problems;
}
const escapeForXml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

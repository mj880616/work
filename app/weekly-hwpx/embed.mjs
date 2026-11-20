// S67-29 WEEKLY-논의요청한글: 상집 논의 요청 줄에 붙인 한글 문서(.hwpx 묶음)를 주간보고 한글 파일 안 그 안건 아래에 '그대로' 넣는다.
//
// 넣는 법(문서 조각 병합): 붙인 문서 본문(section*.xml)의 맨 윗 문단을 차례대로 복제해 주간보고 본문에 끼운다. 문단·글자가 가리키는
// 모양 번호(글자 모양·문단 모양·테두리/배경·탭·문단 번호·글머리표·글꼴)는 붙인 문서 머리(header.xml)에서 꺼내 주간보고 머리에 새 번호로
// 더하고(같은 모양이 이미 있으면 그 번호를 씀), 문단·글자·표의 번호를 새 번호로 바꾼다. 그래서 글자 크기·굵기·색·문단 여백·줄 간격·
// 정렬·표 테두리·칸 색·합친 칸은 그대로 남는다.
// 넣지 않는 것(lost에 이름으로 남김): 그림·도형·수식·글상자 같은 개체, 머리말·꼬리말, 각주·미주, 배경 그림. 쪽 설정(용지·여백·단)은
// 주간보고 것을 쓴다. 개요 번호는 같은 모양의 문단 번호로 바꿔 넣는다(번호는 이 문서 안에서 새로 셈).
// 표가 주간보고 쪽 글 폭보다 넓으면 열 너비를 같은 비율로 줄인다. 칸 높이는 붙인 문서 값 그대로(한글이 글 양에 맞춰 늘림).
// 글 내용은 업무 문서라 로그에 쓰지 않는다.
import {el, clone, kid, kids, walk} from './xml.mjs';
import {readXml} from './hwpx.mjs';

// 머리 목록(refList 안 차례 — OWPML 순서): [목록 이름, 항목 이름]
const ORDER = ['hh:fontfaces', 'hh:borderFills', 'hh:charProperties', 'hh:tabProperties', 'hh:numberings', 'hh:bullets', 'hh:paraProperties', 'hh:styles'];
const ITEM = {'hh:borderFills': 'hh:borderFill', 'hh:charProperties': 'hh:charPr', 'hh:tabProperties': 'hh:tabPr', 'hh:numberings': 'hh:numbering', 'hh:bullets': 'hh:bullet', 'hh:paraProperties': 'hh:paraPr'};
const LANGS = Object.freeze({hangul: 'HANGUL', latin: 'LATIN', hanja: 'HANJA', japanese: 'JAPANESE', other: 'OTHER', symbol: 'SYMBOL', user: 'USER'});
// 글자 줄 안에서 두는 것: 글(hp:t)·표(hp:tbl). 그 밖의 개체는 이름을 남기고 뺀다(쪽 설정·단 설정 등 조용히 빼는 것은 null).
const DROP = Object.freeze({
  'hp:pic': '그림', 'hp:container': '그림', 'hp:ole': '그림', 'hp:chart': '차트', 'hp:equation': '수식', 'hp:textart': '글맵시',
  'hp:rect': '도형', 'hp:ellipse': '도형', 'hp:arc': '도형', 'hp:polygon': '도형', 'hp:curve': '도형', 'hp:connectLine': '도형', 'hp:line': '도형',
  'hp:video': '동영상', 'hp:compose': '글자 겹치기', 'hp:dutmal': '덧말', 'hp:formObject': '양식 개체',
  'hp:btn': '양식 개체', 'hp:radioBtn': '양식 개체', 'hp:checkBtn': '양식 개체', 'hp:comboBox': '양식 개체', 'hp:listBox': '양식 개체', 'hp:edit': '양식 개체', 'hp:scrollBar': '양식 개체',
});
const CTRL_DROP = Object.freeze({'hp:header': '머리말·꼬리말', 'hp:footer': '머리말·꼬리말', 'hp:footNote': '각주·미주', 'hp:endNote': '각주·미주'});
// 글(hp:t) 안에서 두는 것: 글자·탭·줄 바꿈·빈칸 류. 형광펜·필드 표시 같은 나머지 표시는 뺀다(글은 남음).
const T_KEEP = new Set(['hp:tab', 'hp:lineBreak', 'hp:nbSpace', 'hp:fwSpace', 'hp:hyphen']);
const NONE_REF = '4294967295';

const idNum = n => (Number.isFinite(Number(n?.attrs?.id)) ? Number(n.attrs.id) : -1);
const sansId = n => JSON.stringify({...n, attrs: {...n.attrs, id: ''}});
function refList(header) { return kid(header.root, 'hh:refList') ?? [...walk(header.root)].find(n => n.name === 'hh:refList'); }
function list(header, name, make = false) {
  const ref = refList(header);
  let node = kid(ref, name);
  if (!node && make) {
    node = el(name, {itemCnt: '0'});
    const at = ref.children.findIndex(c => c?.name && ORDER.indexOf(c.name) > ORDER.indexOf(name));
    if (at < 0) ref.children.push(node); else ref.children.splice(at, 0, node);
  }
  return node ?? null;
}
const items = (header, name) => kids(list(header, name) ?? el('x'), ITEM[name]);

// 붙인 문서 본문 문단(section0, section1, … 차례). 맨 윗 문단만.
export function sectionNames(pkg) {
  return [...pkg.files.keys()].filter(n => /^Contents\/section\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
}
export function docSections(pkg) { return sectionNames(pkg).map(name => readXml(pkg, name).root); }

// 문단 자기 글(안에 든 표 칸 글은 빼고)
const ownText = p => kids(p, 'hp:run').flatMap(r => kids(r, 'hp:t')).map(t => t.children.map(c => (typeof c.text === 'string' ? c.text : c.name === 'hp:tab' ? ' ' : '')).join('')).join('');
const clean = s => String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
// 문서 차례대로 글이 있는 문단 글(표 칸 안 문단 포함, 문서에 나오는 차례).
export function docTexts(pkg) {
  const out = [];
  for (const sec of docSections(pkg)) for (const n of walk(sec)) if (n.name === 'hp:p') { const t = clean(ownText(n)); if (t) out.push(t); }
  return out;
}
// 미리 채우기: 제목 = 글이 있는 첫 문단, 요지 = 그다음 문단(길면 자름). 글이 없으면 빈 글.
export const PREVIEW_NOTE_MAX = 300;
export function previewDoc(pkg, {noteMax = PREVIEW_NOTE_MAX} = {}) {
  const [title = '', ...rest] = docTexts(pkg);
  const note = rest[0] ?? '';
  return {title: [...title].slice(0, 200).join('').trim(), note: [...note].length > noteMax ? `${[...note].slice(0, noteMax - 1).join('').trim()}…` : note};
}

// 붙인 문서 → 주간보고 머리에 모양을 더하고 끼울 문단 목록을 돌려준다.
// target: 주간보고 header.xml 문서(고침), src: 붙인 문서 묶음, bodyWidth: 주간보고 쪽 글 폭(HWPUNIT, 표 줄이기 기준, 없으면 줄이지 않음).
// → {nodes:[hp:p], lost:[빠진 것 이름], tables, paragraphs}
export function embedDoc(target, src, {bodyWidth = 0} = {}) {
  const header = readXml(src, 'Contents/header.xml');
  const sections = docSections(src);
  const lost = new Set();
  const maps = new Map(); // 목록 이름 → Map(옛 번호 → 새 번호)
  const srcItem = (name, id) => items(header, name).find(n => n.attrs.id === String(id));
  // 같은 모양(번호 빼고 같은 글)이 주간보고 머리에 있으면 그 번호, 없으면 새 번호로 더한다.
  const add = (name, node) => {
    const have = items(target, name), key = sansId(node);
    const same = have.find(n => sansId(n) === key);
    if (same) return same.attrs.id;
    const id = String(Math.max(-1, ...have.map(idNum)) + 1);
    node.attrs.id = id;
    const host = list(target, name, true);
    host.children.push(node);
    host.attrs.itemCnt = String(kids(host, ITEM[name]).length);
    return id;
  };
  const mapped = (name, id, copy) => {
    if (id == null || id === '' || id === NONE_REF) return id;
    if (!maps.has(name)) maps.set(name, new Map());
    const m = maps.get(name);
    if (m.has(String(id))) return m.get(String(id));
    const from = srcItem(name, id);
    if (!from) { m.set(String(id), null); return null; }
    const next = add(name, copy(clone(from)));
    m.set(String(id), next);
    return next;
  };
  // 글꼴: 언어별 목록에서 같은 이름의 글꼴 번호, 없으면 더한다.
  const fontMap = new Map();
  const font = (lang, id) => {
    const key = `${lang}:${id}`;
    if (fontMap.has(key)) return fontMap.get(key);
    const face = n => kids(n, 'hh:font');
    const srcFace = kids(list(header, 'hh:fontfaces') ?? el('x'), 'hh:fontface').find(f => f.attrs.lang === lang);
    const from = srcFace && face(srcFace).find(f => f.attrs.id === String(id));
    const faces = list(target, 'hh:fontfaces');
    const dst = faces && kids(faces, 'hh:fontface').find(f => f.attrs.lang === lang);
    let out = '0';
    if (from && dst) {
      const hit = face(dst).find(f => f.attrs.face === from.attrs.face);
      if (hit) out = hit.attrs.id;
      else {
        const copy = clone(from); copy.attrs.id = String(Math.max(-1, ...face(dst).map(idNum)) + 1);
        dst.children.push(copy); dst.attrs.fontCnt = String(face(dst).length); out = copy.attrs.id;
      }
    } else if (dst && face(dst).length) out = face(dst)[0].attrs.id;
    fontMap.set(key, out);
    return out;
  };
  const border = id => mapped('hh:borderFills', id, b => {
    for (const n of walk(b)) if (n.name === 'hc:fillBrush') { const before = n.children.length; n.children = n.children.filter(c => c.name !== 'hc:imgBrush'); if (n.children.length !== before) lost.add('배경 그림'); }
    b.children = b.children.filter(c => !(c.name === 'hc:fillBrush' && !c.children.length));
    return b;
  });
  const charPr = id => mapped('hh:charProperties', id, c => {
    if (c.attrs.borderFillIDRef != null) c.attrs.borderFillIDRef = border(c.attrs.borderFillIDRef) ?? '1';
    const ref = kid(c, 'hh:fontRef');
    if (ref) for (const [attr, lang] of Object.entries(LANGS)) if (ref.attrs[attr] != null) ref.attrs[attr] = font(lang, ref.attrs[attr]);
    return c;
  });
  const fixHead = n => { for (const x of walk(n)) if ((x.name === 'hh:paraHead' || x.name === 'hh:bullet') && x.attrs.charPrIDRef != null && x.attrs.charPrIDRef !== NONE_REF) x.attrs.charPrIDRef = charPr(x.attrs.charPrIDRef) ?? NONE_REF; return n; };
  const numbering = id => mapped('hh:numberings', id, n => fixHead(n));
  const bullet = id => mapped('hh:bullets', id, b => {
    if (b.attrs.charPrIDRef != null && b.attrs.charPrIDRef !== NONE_REF) b.attrs.charPrIDRef = charPr(b.attrs.charPrIDRef) ?? NONE_REF;
    const before = b.children.length; b.children = b.children.filter(c => c.name !== 'hc:img'); if (b.children.length !== before) lost.add('그림 글머리표');
    return b;
  });
  const tabPr = id => mapped('hh:tabProperties', id, t => t);
  // 개요 번호: 붙인 문서 쪽 설정의 개요 번호(outlineShapeIDRef)를 그대로 옮긴 문단 번호로.
  const outlineId = (() => { for (const sec of sections) for (const n of walk(sec)) if (n.name === 'hp:secPr' && n.attrs.outlineShapeIDRef) return n.attrs.outlineShapeIDRef; return null; })();
  const paraPr = id => mapped('hh:paraProperties', id, p => {
    if (p.attrs.tabPrIDRef != null) p.attrs.tabPrIDRef = tabPr(p.attrs.tabPrIDRef) ?? '0';
    for (const n of walk(p)) {
      if (n.name === 'hh:border' && n.attrs.borderFillIDRef != null) n.attrs.borderFillIDRef = border(n.attrs.borderFillIDRef) ?? '1';
      if (n.name === 'hh:heading') {
        const type = n.attrs.type ?? 'NONE';
        let ref = null;
        if (type === 'NUMBER') ref = numbering(n.attrs.idRef);
        else if (type === 'BULLET') ref = bullet(n.attrs.idRef);
        else if (type === 'OUTLINE') { ref = outlineId ? numbering(outlineId) : null; if (ref != null) n.attrs.type = 'NUMBER'; }
        if (type !== 'NONE' && ref == null) { n.attrs.type = 'NONE'; n.attrs.idRef = '0'; n.attrs.level = '0'; lost.add('문단 번호'); }
        else if (ref != null) n.attrs.idRef = ref;
      }
    }
    return p;
  });
  const fallback = name => (items(target, name)[0]?.attrs.id ?? '0');

  // 본문 노드 고치기(복제본 위에서)
  let tables = 0, paragraphs = 0;
  const fixPara = p => {
    paragraphs++;
    p.attrs = {...p.attrs, paraPrIDRef: paraPr(p.attrs.paraPrIDRef) ?? fallback('hh:paraProperties'), styleIDRef: '0', pageBreak: '0', columnBreak: '0'};
    p.children = p.children.filter(c => c.name === 'hp:run').map(fixRun).filter(Boolean);
    if (!p.children.length) p.children.push(el('hp:run', {charPrIDRef: fallback('hh:charProperties')}, []));
    return p;
  };
  const fixRun = r => {
    r.attrs = {...r.attrs, charPrIDRef: charPr(r.attrs.charPrIDRef) ?? fallback('hh:charProperties')};
    const keep = [];
    for (const c of r.children) {
      if (!c?.name) continue;
      if (c.name === 'hp:t') { c.children = c.children.filter(x => typeof x.text === 'string' || T_KEEP.has(x.name)); keep.push(c); }
      else if (c.name === 'hp:tbl') keep.push(fixTable(c));
      else if (c.name === 'hp:ctrl') { for (const x of c.children) if (CTRL_DROP[x?.name]) lost.add(CTRL_DROP[x.name]); }
      else if (DROP[c.name]) lost.add(DROP[c.name]);
    }
    r.children = keep;
    return r;
  };
  const fixTable = t => {
    tables++;
    t.attrs = {...t.attrs, borderFillIDRef: border(t.attrs.borderFillIDRef) ?? '1', pageBreak: t.attrs.pageBreak ?? 'CELL'};
    // 캡션은 뺀다(표 번호가 주간보고 차례와 섞이지 않게).
    if (t.children.some(c => c.name === 'hp:caption')) lost.add('표 캡션');
    t.children = t.children.filter(c => c.name !== 'hp:caption');
    for (const tr of kids(t, 'hp:tr')) for (const tc of kids(tr, 'hp:tc')) {
      tc.attrs.borderFillIDRef = border(tc.attrs.borderFillIDRef) ?? '1';
      const sub = kid(tc, 'hp:subList');
      if (sub) { sub.children = kids(sub, 'hp:p').map(fixPara); if (!sub.children.length) sub.children.push(fixPara(el('hp:p', {paraPrIDRef: '0', styleIDRef: '0'}, [el('hp:run', {charPrIDRef: '0'}, [])]))); }
    }
    if (bodyWidth > 0) fitWidth(t, bodyWidth);
    return t;
  };

  const nodes = [];
  for (const sec of sections) for (const p of kids(sec, 'hp:p')) {
    const copy = fixPara(clone(p));
    // 쪽 설정만 있던 빈 첫 문단은 넣지 않는다(글·표가 없으면).
    const empty = !copy.children.some(r => r.children.some(c => c.name === 'hp:tbl' || (c.name === 'hp:t' && c.children.length)));
    if (empty && kids(p, 'hp:run').some(r => r.children.some(c => c.name === 'hp:secPr'))) continue;
    nodes.push(copy);
  }
  // 맨 끝 빈 문단은 뺀다(안건 사이 간격은 주간보고 쪽이 정함).
  while (nodes.length && isEmptyPara(nodes.at(-1))) nodes.pop();
  return {nodes, lost: [...lost], tables, paragraphs};
}
const isEmptyPara = p => !p.children.some(r => r.children?.some(c => c.name === 'hp:tbl' || (c.name === 'hp:t' && c.children.some(x => (typeof x.text === 'string' ? x.text.trim() : true)))));

// 표가 글 폭보다 넓으면 열 너비를 같은 비율로 줄인다(칸 너비·표 너비).
export function fitWidth(tbl, bodyWidth) {
  const sz = kid(tbl, 'hp:sz'), width = Number(sz?.attrs.width);
  if (!(width > bodyWidth) || !(bodyWidth > 0)) return false;
  const rate = bodyWidth / width;
  sz.attrs.width = String(Math.floor(width * rate));
  for (const tr of kids(tbl, 'hp:tr')) for (const tc of kids(tr, 'hp:tc')) { const c = kid(tc, 'hp:cellSz'); if (c?.attrs.width != null) c.attrs.width = String(Math.floor(Number(c.attrs.width) * rate)); }
  return true;
}

// 주간보고 쪽 글 폭(용지 너비 − 왼쪽·오른쪽·제본 여백).
export function bodyWidthOf(sec) {
  const page = [...walk(sec)].find(n => n.name === 'hp:pagePr');
  const m = page && kid(page, 'hp:margin');
  if (!page || !m) return 0;
  const w = page.attrs.landscape === 'NARROWLY' ? Number(page.attrs.height) : Number(page.attrs.width);
  return Math.max(0, w - Number(m.attrs.left || 0) - Number(m.attrs.right || 0) - Number(m.attrs.gutter || 0));
}

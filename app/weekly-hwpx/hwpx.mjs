// WEEKLY-한글초안 시제품: .hwpx 묶음 열기·저장, 머리(header.xml) 스타일 표 읽기, OWPML 규격 검사.
// 압축 함수는 부르는 쪽이 넘긴다({deflateRaw, inflateRaw}) — Node는 node:zlib, 브라우저는 CompressionStream.
import {readZip, writeZip, readZipAsync, writeZipAsync} from './zip.mjs';
import {parseXml, toXml, kid, kids, walk} from './xml.mjs';

export const MIMETYPE = 'application/hwp+zip';
export const REQUIRED_PARTS = Object.freeze(['mimetype', 'version.xml', 'META-INF/container.xml', 'Contents/content.hpf', 'Contents/header.xml', 'Contents/section0.xml']);
const dec = new TextDecoder();

// → {order:[name], files:Map(name→Uint8Array), firstMethod}
export function openHwpx(bytes, zlib) {
  const entries = readZip(bytes, zlib);
  return {order: entries.map(e => e.name), files: new Map(entries.map(e => [e.name, e.data])), firstMethod: entries[0]?.method};
}
// 브라우저용(압축이 비동기): {inflateRawAsync} / {deflateRawAsync}
export async function openHwpxAsync(bytes, zlib) {
  const entries = await readZipAsync(bytes, zlib);
  return {order: entries.map(e => e.name), files: new Map(entries.map(e => [e.name, e.data])), firstMethod: entries[0]?.method};
}
export function packHwpxAsync(pkg, zlib) {
  const names = ['mimetype', ...pkg.order.filter(n => n !== 'mimetype')];
  return writeZipAsync(names.map(name => ({name, data: pkg.files.get(name), store: name === 'mimetype'})), zlib);
}
export const readText = (pkg, name) => (pkg.files.has(name) ? dec.decode(pkg.files.get(name)) : null);
export const readXml = (pkg, name) => parseXml(readText(pkg, name));
export function setText(pkg, name, text) {
  if (!pkg.order.includes(name)) pkg.order.push(name);
  pkg.files.set(name, new TextEncoder().encode(text));
}
export const setXml = (pkg, name, doc) => setText(pkg, name, toXml(doc.root, doc.prolog || undefined));
export function removePart(pkg, name) {
  pkg.files.delete(name);
  pkg.order = pkg.order.filter(n => n !== name);
}
// OWPML: mimetype가 맨 앞, 압축 없이.
export function packHwpx(pkg, zlib) {
  const names = ['mimetype', ...pkg.order.filter(n => n !== 'mimetype')];
  return writeZip(names.map(name => ({name, data: pkg.files.get(name), store: name === 'mimetype'})), zlib);
}
export const clonePkg = pkg => ({order: [...pkg.order], files: new Map([...pkg.files].map(([k, v]) => [k, new Uint8Array(v)]))});

// 머리 스타일 표: [{id, name, engName, paraPr, charPr}]
export function headerStyles(header) {
  const styles = kid(kid(header.root, 'hh:refList') ?? header.root, 'hh:styles') ?? [...walk(header.root)].find(n => n.name === 'hh:styles');
  return kids(styles, 'hh:style').map(s => ({id: s.attrs.id, name: s.attrs.name, engName: s.attrs.engName, paraPr: s.attrs.paraPrIDRef, charPr: s.attrs.charPrIDRef}));
}
export function styleByName(header, name) {
  const style = headerStyles(header).find(s => s.name === name);
  if (!style) throw new Error(`서식에 '${name}' 스타일이 없음`);
  return style;
}

const LISTS = [['hh:fontfaces', 'hh:fontface'], ['hh:borderFills', 'hh:borderFill'], ['hh:charProperties', 'hh:charPr'], ['hh:tabProperties', 'hh:tabPr'],
  ['hh:numberings', 'hh:numbering'], ['hh:bullets', 'hh:bullet'], ['hh:paraProperties', 'hh:paraPr'], ['hh:styles', 'hh:style']];

// OWPML 묶음·참조 검사. → {errors:[문장], parts, tables, paragraphs}
export function validateHwpx(bytes, zlib) {
  let pkg;
  try { pkg = openHwpx(bytes, zlib); } catch (e) { return {errors: [`압축 구조: ${e.message}`]}; }
  return validatePackage(pkg);
}
// 브라우저용: 묶은 바이트를 다시 열어 같은 검사를 한다.
export async function validateHwpxAsync(bytes, zlib) {
  let pkg;
  try { pkg = await openHwpxAsync(bytes, zlib); } catch (e) { return {errors: [`압축 구조: ${e.message}`]}; }
  return validatePackage(pkg);
}
export function validatePackage(pkg) {
  const errors = [];
  if (pkg.order[0] !== 'mimetype') errors.push('mimetype이 첫 항목이 아님');
  if (pkg.firstMethod !== 0) errors.push('mimetype이 압축됨(저장만 해야 함)');
  if (readText(pkg, 'mimetype') !== MIMETYPE) errors.push(`mimetype 값이 ${MIMETYPE}이 아님`);
  for (const part of REQUIRED_PARTS) if (!pkg.files.has(part)) errors.push(`필수 파일 없음: ${part}`);
  const docs = {};
  for (const name of pkg.order) {
    if (!/\.(xml|hpf|rdf)$/.test(name)) continue;
    try { docs[name] = readXml(pkg, name); } catch (e) { errors.push(`${name}: ${e.message}`); }
  }
  if (errors.length) return {errors};
  // 묶음 목록이 가리키는 파일이 있는지
  for (const rf of [...walk(docs['META-INF/container.xml'].root)].filter(n => n.name === 'ocf:rootfile')) {
    if (!pkg.files.has(rf.attrs['full-path'])) errors.push(`container.xml이 없는 파일을 가리킴: ${rf.attrs['full-path']}`);
  }
  const hpf = docs['Contents/content.hpf'].root;
  const items = [...walk(hpf)].filter(n => n.name === 'opf:item');
  for (const item of items) if (!pkg.files.has(item.attrs.href)) errors.push(`content.hpf가 없는 파일을 가리킴: ${item.attrs.href}`);
  const ids = new Set(items.map(i => i.attrs.id));
  for (const ref of [...walk(hpf)].filter(n => n.name === 'opf:itemref')) if (!ids.has(ref.attrs.idref)) errors.push(`spine이 없는 항목을 가리킴: ${ref.attrs.idref}`);
  const sections = items.filter(i => /^Contents\/section\d+\.xml$/.test(i.attrs.href));
  if (!sections.length) errors.push('content.hpf에 본문(section) 항목이 없음');
  // 머리 목록 개수와 id
  const head = docs['Contents/header.xml'].root;
  const known = {};
  for (const [list, item] of LISTS) {
    const node = [...walk(head)].find(n => n.name === list);
    if (!node) { if (list !== 'hh:numberings' && list !== 'hh:bullets') errors.push(`header.xml에 ${list} 없음`); continue; }
    const children = kids(node, item);
    if (node.attrs.itemCnt !== undefined && Number(node.attrs.itemCnt) !== children.length) errors.push(`${list} itemCnt(${node.attrs.itemCnt}) ≠ 실제 ${children.length}`);
    if (item !== 'hh:fontface') known[item] = new Set(children.map(c => c.attrs.id));
  }
  // 본문 참조·표 격자
  let tables = 0, paragraphs = 0;
  for (const {attrs: {href}} of sections) {
    const sec = docs[href]?.root;
    if (!sec) { errors.push(`${href} 읽기 실패`); continue; }
    for (const n of walk(sec)) {
      if (n.name === 'hp:p') {
        paragraphs++;
        if (!known['hh:style']?.has(n.attrs.styleIDRef)) errors.push(`${href}: 없는 스타일 ${n.attrs.styleIDRef}`);
        if (!known['hh:paraPr']?.has(n.attrs.paraPrIDRef)) errors.push(`${href}: 없는 문단 모양 ${n.attrs.paraPrIDRef}`);
      } else if (n.name === 'hp:run') {
        if (!known['hh:charPr']?.has(n.attrs.charPrIDRef)) errors.push(`${href}: 없는 글자 모양 ${n.attrs.charPrIDRef}`);
      } else if (n.name === 'hp:tbl') {
        tables++;
        errors.push(...checkTable(n, known['hh:borderFill']).map(e => `${href} 표 ${tables}: ${e}`));
      }
    }
  }
  return {errors, parts: pkg.order.length, tables, paragraphs};
}

function checkTable(tbl, borderFills) {
  const errors = [];
  const rowCnt = Number(tbl.attrs.rowCnt), colCnt = Number(tbl.attrs.colCnt);
  const rows = kids(tbl, 'hp:tr');
  if (rows.length !== rowCnt) errors.push(`rowCnt ${rowCnt} ≠ 줄 ${rows.length}`);
  if (borderFills && !borderFills.has(tbl.attrs.borderFillIDRef)) errors.push(`없는 테두리 ${tbl.attrs.borderFillIDRef}`);
  const grid = Array.from({length: rowCnt}, () => new Array(colCnt).fill(0));
  rows.forEach((tr, r) => {
    for (const tc of kids(tr, 'hp:tc')) {
      const addr = kid(tc, 'hp:cellAddr').attrs, span = kid(tc, 'hp:cellSpan').attrs;
      const row = Number(addr.rowAddr), col = Number(addr.colAddr), rs = Number(span.rowSpan), cs = Number(span.colSpan);
      if (row !== r) errors.push(`칸 rowAddr ${row}이 ${r}번째 줄에 있음`);
      if (borderFills && !borderFills.has(tc.attrs.borderFillIDRef)) errors.push(`칸 없는 테두리 ${tc.attrs.borderFillIDRef}`);
      if (!kid(tc, 'hp:subList') || !kids(kid(tc, 'hp:subList'), 'hp:p').length) errors.push(`칸(${row},${col})에 문단 없음`);
      for (let y = row; y < row + rs; y++) for (let x = col; x < col + cs; x++) {
        if (y >= rowCnt || x >= colCnt) { errors.push(`칸(${row},${col})이 표 밖으로 나감`); continue; }
        grid[y][x]++;
      }
    }
  });
  grid.forEach((line, y) => line.forEach((n, x) => { if (n !== 1) errors.push(`격자(${y},${x})를 덮는 칸 ${n}개`); }));
  return errors;
}

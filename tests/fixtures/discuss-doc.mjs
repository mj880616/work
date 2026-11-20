// S67-29 시험용 합성 '상집 논의 요청' 한글 문서(.hwpx). 실제 문서는 쓰지 않는다(공개 저장소): 저장소의 rhwp 빈 문서
// (tests/fixtures/hwp-lab/sample.hwpx)에 가상 글꼴·글자 모양(크고 굵은 빨간 글)·문단 모양(가운데 정렬·왼쪽 여백·번호)·칸 색 테두리를
// 더하고, 본문에 제목·요지 문단·2×2 표·번호 문단·그림 개체(빠져야 함)를 넣는다.
import {readFileSync} from 'node:fs';
import {zlib, SAMPLE} from '../../scripts/weekly-hwpx/cli.mjs';
import {openHwpx, packHwpx, readXml, setXml, readText, setText} from '../../app/weekly-hwpx/hwpx.mjs';
import {parseXml, el, kid, kids, walk, clone} from '../../app/weekly-hwpx/xml.mjs';

export const DOC = Object.freeze({
  title: '가상 안건 — 시험용 논의 요청',
  note: '가상 요지 문단입니다. 이 문서는 시험용으로 만든 합성 문서입니다.',
  cells: ['가상 칸 갑', '가상 칸 을', '가상 칸 병', '가상 칸 정'],
  numbered: '가상 번호 문단',
  font: '가상시험바탕',
  color: '#C00000',
  height: '1700',
  fill: '#DDEEFF',
});

const listOf = (head, name) => [...walk(head.root)].find(n => n.name === name);
const nextId = list => String(Math.max(-1, ...list.children.filter(c => c.name).map(c => Number(c.attrs.id))) + 1);
const push = (list, node) => { list.children.push(node); list.attrs.itemCnt = String(list.children.filter(c => c.name).length); return node.attrs.id; };

export function makeDiscussDoc({wide = false} = {}) {
  const pkg = openHwpx(new Uint8Array(readFileSync(SAMPLE)), zlib);
  const head = readXml(pkg, 'Contents/header.xml');
  // 글꼴: 한글 목록에 가상 글꼴 하나
  const hangul = kids(listOf(head, 'hh:fontfaces'), 'hh:fontface').find(f => f.attrs.lang === 'HANGUL');
  const font = clone(kids(hangul, 'hh:font')[0]); font.attrs.id = String(kids(hangul, 'hh:font').length); font.attrs.face = DOC.font;
  hangul.children.push(font); hangul.attrs.fontCnt = String(kids(hangul, 'hh:font').length);
  // 테두리·칸 색
  const fills = listOf(head, 'hh:borderFills');
  const side = n => el(n, {type: 'SOLID', width: '0.4 mm', color: '#123456'});
  const fillId = push(fills, el('hh:borderFill', {id: nextId(fills), threeD: '0', shadow: '0', centerLine: 'NONE', breakCellSeparateLine: '0'}, [
    el('hh:slash', {type: 'NONE', Crooked: '0', isCounter: '0'}), el('hh:backSlash', {type: 'NONE', Crooked: '0', isCounter: '0'}),
    side('hh:leftBorder'), side('hh:rightBorder'), side('hh:topBorder'), side('hh:bottomBorder'), el('hh:diagonal', {type: 'SOLID', width: '0.1 mm', color: '#000000'}),
    el('hc:fillBrush', {}, [el('hc:winBrush', {faceColor: DOC.fill, hatchColor: 'none', alpha: '0'})])]));
  // 글자 모양: 크고 굵은 빨간 글, 가상 글꼴
  const chars = listOf(head, 'hh:charProperties');
  const cp = clone(kids(chars, 'hh:charPr')[0]);
  cp.attrs = {...cp.attrs, id: nextId(chars), height: DOC.height, textColor: DOC.color};
  kid(cp, 'hh:fontRef').attrs.hangul = font.attrs.id;
  cp.children.splice(cp.children.findIndex(k => k.name === 'hh:underline'), 0, el('hh:bold'));
  const bigId = push(chars, cp);
  // 문단 모양: 가운데 정렬 + 왼쪽 여백 2000 / 번호 문단(시험 문서의 번호 1)
  const paras = listOf(head, 'hh:paraProperties');
  const pp = clone(kids(paras, 'hh:paraPr')[0]); pp.attrs.id = nextId(paras);
  for (const n of walk(pp)) { if (n.name === 'hh:align') n.attrs.horizontal = 'CENTER'; if (n.name === 'hc:left') n.attrs.value = '2000'; }
  const centerId = push(paras, pp);
  const np = clone(kids(paras, 'hh:paraPr')[0]); np.attrs.id = nextId(paras);
  for (const n of walk(np)) if (n.name === 'hh:heading') Object.assign(n.attrs, {type: 'NUMBER', idRef: '1', level: '1'});
  const numId = push(paras, np);
  setXml(pkg, 'Contents/header.xml', head);

  // 본문
  const sec = readXml(pkg, 'Contents/section0.xml');
  const first = kids(sec.root, 'hp:p')[0];
  const secRun = kids(first, 'hp:run').find(r => r.children.some(c => c.name === 'hp:secPr'));
  const P = (para, char, inner) => `<hp:p id="0" paraPrIDRef="${para}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${char}">${inner}</hp:run><hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1000" textheight="1000" baseline="850" spacing="600" horzpos="0" horzsize="42520" flags="393216"/></hp:linesegarray></hp:p>`;
  const T = text => `<hp:t>${text}</hp:t>`;
  const w = wide ? 30000 : 20000;
  const tc = (r, c, text) => `<hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${fillId}"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${P(centerId, bigId, T(text))}</hp:subList><hp:cellAddr colAddr="${c}" rowAddr="${r}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${w}" height="2000"/><hp:cellMargin left="0" right="0" top="0" bottom="0"/></hp:tc>`;
  const tbl = `<hp:tbl id="1" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="0" rowCnt="2" colCnt="2" cellSpacing="0" borderFillIDRef="${fillId}" noAdjust="0"><hp:sz width="${w * 2}" widthRelTo="ABSOLUTE" height="4000" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="140" right="140" top="140" bottom="140"/><hp:inMargin left="285" right="285" top="285" bottom="285"/>`
    + `<hp:tr>${tc(0, 0, DOC.cells[0])}${tc(0, 1, DOC.cells[1])}</hp:tr><hp:tr>${tc(1, 0, DOC.cells[2])}${tc(1, 1, DOC.cells[3])}</hp:tr></hp:tbl>`;
  const pic = '<hp:pic id="7" zOrder="1" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="7" reverse="0"><hc:img binaryItemIDRef="image1" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/></hp:pic>';
  const body = [P(centerId, bigId, T(DOC.title)), P('0', '0', T(DOC.note)), P('0', '0', tbl), P(numId, '0', T(DOC.numbered)), P('0', '0', pic + T('')), P('0', '0', '')].join('');
  const wrapped = parseXml(`<x xmlns:hp="p" xmlns:hc="c">${body}</x>`).root.children;
  // 첫 문단은 쪽 설정만 남기고(글 없음), 그 뒤에 본문 문단
  first.children = [secRun];
  sec.root.children = [first, ...wrapped];
  setXml(pkg, 'Contents/section0.xml', sec);
  setText(pkg, 'Preview/PrvText.txt', '');
  return pkg;
}
export const discussDocBytes = o => packHwpx(makeDiscussDoc(o), zlib);
export {readText};

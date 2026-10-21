#!/usr/bin/env node
// WEEKLY-한글초안 시제품 명령(사람이 PC에서 돌리는 도구, 운영 접속 없음). 설계: docs/design/weekly-hwpx-draft.md
//
//   node scripts/weekly-hwpx/cli.mjs fake <out.hwpx>                         가짜 주간보고(시험용) 만들기
//   node scripts/weekly-hwpx/cli.mjs template <report.hwpx> <out.hwpx>        보고서에서 빈 서식 뽑기 + 빈 서식 검사
//   node scripts/weekly-hwpx/cli.mjs build <template.hwpx> <data.json|demo> <out.hwpx>   빈 서식 + 보고 자료 → 보고서
//   node scripts/weekly-hwpx/cli.mjs validate <file.hwpx>                    OWPML 묶음·참조 검사
//   node scripts/weekly-hwpx/cli.mjs convert <rhwp core 폴더> <in.hwp> <out.hwpx>    HWP 5 → .hwpx (rhwp 엔진, 내용 그대로)
//   node scripts/weekly-hwpx/cli.mjs reread <rhwp core 폴더> <file.hwpx>      rhwp 엔진으로 다시 열어 쪽·스타일 수 확인
//
// 실제 업무 문서를 넣을 때는 결과를 저장소 밖에 두고, 화면에 본문을 찍지 않는다(이 도구는 개수·검사 결과만 찍는다).
import {readFileSync, writeFileSync} from 'node:fs';
import {deflateRawSync, inflateRawSync} from 'node:zlib';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {openHwpx, packHwpx, validateHwpx, readXml, headerStyles} from './hwpx.mjs';
import {extractBlankTemplate, assertBlank, FORM_LABELS, BOX_LABELS} from './template.mjs';
import {buildReport, readReport, reportTexts} from './report.mjs';
import {makeFakeReport, DEMO_DATA, FAKE_TEXTS} from './fixture.mjs';

export const zlib = {deflateRaw: b => deflateRawSync(b, {level: 9}), inflateRaw: b => inflateRawSync(b)};
export const SAMPLE = fileURLToPath(new URL('../../tests/fixtures/hwp-lab/sample.hwpx', import.meta.url));
const load = path => openHwpx(new Uint8Array(readFileSync(path)), zlib);
const save = (path, pkg) => { const bytes = packHwpx(pkg, zlib); writeFileSync(path, bytes); return bytes; };

// 빈 서식 검사용 원본 글 조각: 문장 전체 + 한글 3글자 이상 낱말(양식 글자에 들어 있는 낱말은 뺌).
const LABEL_TEXT = [...FORM_LABELS, ...BOX_LABELS].join(' ');
export const reportWords = report => {
  const texts = reportTexts(report).filter(t => !BOX_LABELS.includes(t));
  const words = texts.flatMap(t => t.split(/[^가-힣A-Za-z0-9]+/)).filter(w => /[가-힣]/.test(w) && [...w].length >= 3 && !LABEL_TEXT.includes(w));
  return [...new Set([...texts, ...words])];
};

async function rhwp(core) {
  const mod = await import(pathToFileURL(join(core, 'rhwp.js')).href);
  mod.initSync({module: readFileSync(join(core, 'rhwp_bg.wasm'))});
  return mod;
}

// rhwp 엔진(편집기와 같은 @rhwp/core)으로 다시 열어: 쪽 수, 스타일 이름 표, 글 전체(공백 뺀 글자)가 우리 해석과 같은지, HWP 5로 다시 저장되는지.
// 글 내용은 돌려주지 않고 개수·일치 여부만 돌려준다.
export function rereadWithRhwp(r, bytes) {
  const doc = new r.HwpDocument(bytes);
  const styles = JSON.parse(doc.getStyleList()).map(s => s.name);
  const pkg = openHwpx(bytes, zlib);
  const mine = headerStyles(readXml(pkg, 'Contents/header.xml')).map(s => s.name);
  const squash = s => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/\s+/g, '');
  const rhwpText = squash(JSON.parse(doc.getTextFileUnicode()));
  const ownText = squash([...readXml(pkg, 'Contents/section0.xml').root.children].map(textOfDeep).join(''));
  return {pages: doc.pageCount(), styles: styles.length, sameStyles: JSON.stringify(styles) === JSON.stringify(mine),
    rhwpChars: [...rhwpText].length, ownChars: [...ownText].length, sameText: rhwpText === ownText, hwpBytes: doc.exportHwp().length};
}
const textOfDeep = node => ('text' in node ? '' : node.name === 'hp:t' ? node.children.map(c => c.text ?? '').join('') : node.children.map(textOfDeep).join(''));

function report(label, bytes) {
  const v = validateHwpx(bytes, zlib);
  console.log(`${label}: ${v.errors.length ? '실패' : '통과'} (파일 ${v.parts ?? '-'}개, 표 ${v.tables ?? '-'}개, 문단 ${v.paragraphs ?? '-'}개)`);
  for (const e of v.errors.slice(0, 20)) console.log(`  - ${e}`);
  return v.errors.length === 0;
}

export async function main([cmd, ...args]) {
  if (cmd === 'fake') {
    return report('가짜 보고서', save(args[0], makeFakeReport(load(SAMPLE))));
  }
  if (cmd === 'template') {
    const source = load(args[0]);
    const forbidden = [];
    try { forbidden.push(...reportWords(readReport(source))); } catch { /* 표가 없으면 아래 extract가 이유를 알려 줌 */ }
    const blank = extractBlankTemplate(source);
    const problems = assertBlank(blank, {forbidden: [...forbidden, ...FAKE_TEXTS]});
    const ok = report('빈 서식', save(args[1], blank));
    console.log(problems.length ? `빈 서식 검사: 실패\n${problems.map(p => `  - ${p}`).join('\n')}` : '빈 서식 검사: 통과(양식 글자 말고 남은 글 없음)');
    return ok && !problems.length;
  }
  if (cmd === 'build') {
    const data = args[1] === 'demo' ? DEMO_DATA : JSON.parse(readFileSync(args[1], 'utf8'));
    const {pkg, changedCharPr} = buildReport(load(args[0]), data);
    console.log(`바뀐 글 글자 모양: ${changedCharPr ?? '서식에 없음(표시 없이 씀)'}`);
    return report('보고서', save(args[2], pkg));
  }
  if (cmd === 'validate') return report(args[0], new Uint8Array(readFileSync(args[0])));
  if (cmd === 'convert') {
    const r = await rhwp(args[0]);
    const doc = new r.HwpDocument(new Uint8Array(readFileSync(args[1])));
    writeFileSync(args[2], doc.exportHwpx());
    return report('변환본', new Uint8Array(readFileSync(args[2])));
  }
  if (cmd === 'reread') {
    const result = rereadWithRhwp(await rhwp(args[0]), new Uint8Array(readFileSync(args[1])));
    console.log(`rhwp 다시 열기: 쪽 ${result.pages}개, 스타일 ${result.styles}개(${result.sameStyles ? '머리 표와 같음' : '머리 표와 다름'}), 글자 ${result.rhwpChars}/${result.ownChars}(${result.sameText ? '같음' : '다름'}), HWP 5 재저장 ${result.hwpBytes > 0 ? '통과' : '실패'}`);
    return result.sameStyles && result.sameText && result.hwpBytes > 0;
  }
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 11).join('\n'));
  return false;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(ok => { process.exitCode = ok ? 0 : 1; }, e => { console.error(e.message); process.exitCode = 1; });
}

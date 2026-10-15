// HWP-편집기 시험용 샘플(tests/fixtures/hwp-lab/sample.hwp·sample.hwpx)을 만든다. 업무 문서가 아닌 빈 문서에 시험 문장 한 줄.
// 사용법: node scripts/hwp-lab/make-samples.mjs <@rhwp/core@0.8.7 압축을 푼 package 폴더>
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const core = process.argv[2];
if (!core) throw new Error('usage: make-samples.mjs <@rhwp/core package dir>');
const rhwp = await import(pathToFileURL(join(core, 'rhwp.js')).href);
rhwp.initSync({ module: readFileSync(join(core, 'rhwp_bg.wasm')) });
const doc = rhwp.HwpDocument.createEmpty();
doc.createBlankDocument();
doc.insertText(0, 0, 0, 'HWP 편집기 시험 문서입니다. 이 문장을 고쳐 보세요.');
const out = new URL('../../tests/fixtures/hwp-lab/', import.meta.url);
writeFileSync(new URL('sample.hwp', out), doc.exportHwp());
writeFileSync(new URL('sample.hwpx', out), doc.exportHwpx());

// PERF-첫로딩 P3: loader-v2.js의 미리 받기(modulepreload) 목록 검사.
// - 적힌 파일은 모두 저장소에 있고, 같은 loader가 실제로 import()하거나 그 정적 import 사슬 안에 든 파일이다(쓰지 않는 파일을 받지 않음).
// - 사업영역 창 그릇(area-window.js)·새 판 알림(version-notice.js)의 정적 import 사슬은 빠짐없이 적는다(사슬이 바뀌면 이 시험이 알려 준다).
// - 기능 모듈 미리 받기는 로그인 확인(if(!authenticated)) 뒤에만 있다. 그 앞에는 로그인 확인에 쓰는 파일만.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';

const read = file => readFileSync(new URL('../app/' + file, import.meta.url), 'utf8');
const loader = read('loader-v2.js');
const staticImports = file => [...read(file).matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?['"](\.\/[^'"]+)['"]/gm)].map(m => m[1].slice(2));
function closure(file, seen = new Set()) {
  for (const dep of staticImports(file)) if (!seen.has(dep)) { seen.add(dep); closure(dep, seen); }
  return seen;
}
const lists = [...loader.matchAll(/preload\(\[([^\]]*)\]\)/g)].map(m => ({at: m.index, files: [...m[1].matchAll(/'\.\/([^']+)'/g)].map(x => x[1])}));
const imported = [...loader.matchAll(/import\('\.\/([^']+)'\)/g)].map(m => m[1]);

test('미리 받기 목록은 loader가 실제로 부르는 파일과 그 정적 사슬뿐이다', () => {
  assert.ok(lists.length >= 2);
  const reachable = new Set(imported);
  for (const file of imported) for (const dep of closure(file)) reachable.add(dep);
  for (const {files} of lists) for (const file of files) {
    assert.ok(existsSync(new URL('../app/' + file, import.meta.url)), file + ' 없음');
    assert.ok(reachable.has(file), file + '은 loader가 부르지 않는 파일');
  }
});

test('사업영역 창 그릇·새 판 알림의 정적 사슬을 빠짐없이 미리 받는다', () => {
  const listed = new Set(lists.flatMap(l => l.files));
  for (const root of ['area-window.js', 'version-notice.js'])
    for (const file of [root, ...closure(root)]) assert.ok(listed.has(file), file + ' 빠짐');
});

test('기능 모듈 미리 받기는 로그인 확인 뒤에만', () => {
  const gate = loader.indexOf('if(!authenticated)');
  assert.ok(gate > 0);
  const authOnly = new Set(['auth-handoff-client.js', 'auth-bootstrap.js', 'auth-service.js']);
  for (const {at, files} of lists) if (at < gate) for (const file of files) assert.ok(authOnly.has(file), file + '을 로그인 확인 전에 받음');
  assert.ok(lists.some(l => l.at > gate && l.files.includes('team.js')));
});

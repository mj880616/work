// OPS-작업속도: 화면 시험을 시험 하나씩 갈래마다 나누는 계획(scripts/ci/e2e-shard.mjs)이 시험을 빠뜨리거나 겹치지 않는지 본다.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {collectSpecs, partition, plan, verify, titlePattern, grepFor} from '../scripts/ci/e2e-shard.mjs';

const spec = (file, title, id) => ({title, id, file, line: 1, column: 1, tests: [{projectName: 'chromium'}]});
// heavy.spec.mjs 시험 10개가 앞쪽에 몰린 목록(옛 --shard에서 한 갈래에 몰리던 모양).
const report = {
  errors: [],
  suites: [
    {title: 'tests/app-e2e/a.spec.mjs', file: 'tests/app-e2e/a.spec.mjs', specs: [spec('tests/app-e2e/a.spec.mjs', 'a1', 'a1'), spec('tests/app-e2e/a.spec.mjs', 'a2', 'a2')]},
    {title: 'tests/app-e2e/heavy.spec.mjs', file: 'tests/app-e2e/heavy.spec.mjs',
      specs: Array.from({length: 10}, (_, i) => spec('tests/app-e2e/heavy.spec.mjs', `h${i}`, `h${i}`)),
      suites: [{title: '390px', specs: [spec('tests/app-e2e/heavy.spec.mjs', 'same (1+1)? [x]', 'hs')]}]},
    {title: 'tests/app-e2e/z.spec.mjs', file: 'tests/app-e2e/z.spec.mjs', specs: [spec('tests/app-e2e/z.spec.mjs', 'same (1+1)? [x]', 'z1')]},
  ],
};

test('collectSpecs: 파일 경로부터 묶음 제목까지 전체 제목', () => {
  const specs = collectSpecs(report);
  assert.equal(specs.length, 14);
  assert.deepEqual(specs.find(s => s.id === 'hs').titles, ['tests/app-e2e/heavy.spec.mjs', '390px', 'same (1+1)? [x]']);
});

test('partition: 모든 시험이 정확히 한 갈래에, 갈래 크기 차이 1 이하, 무거운 파일이 모든 갈래에 퍼짐', () => {
  for (const total of [1, 3, 4, 7, 24]) {
    const shards = partition(collectSpecs(report), total);
    const ids = shards.flatMap(s => s.specs.map(x => x.id));
    assert.equal(ids.length, 14);
    assert.equal(new Set(ids).size, 14);
    const sizes = shards.map(s => s.tests);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `${total}: ${sizes}`);
  }
  const four = partition(collectSpecs(report), 4);
  for (const shard of four) assert.ok(shard.specs.some(s => s.file.endsWith('heavy.spec.mjs')));
});

test('plan: 갈래 계획을 모두 모으면 목록 전체와 같다', () => {
  const total = 5, ids = [];
  let tests = 0;
  for (let i = 1; i <= total; i++) { const p = plan(report, i, total); ids.push(...p.specIds); tests += p.tests; }
  assert.deepEqual(ids.sort(), collectSpecs(report).map(s => s.id).sort());
  assert.equal(tests, 14);
  assert.throws(() => plan(report, 0, 5), /bad shard index/);
  assert.throws(() => plan(report, 6, 5), /bad shard index/);
  assert.throws(() => plan({errors: [{message: 'x'}], suites: []}, 1, 1), /list errors/);
  assert.throws(() => plan({errors: [], suites: []}, 1, 1), /no tests/);
});

test('grep: 전체 제목이 정확히 같은 시험만 맞는다(다른 파일·앞뒤에 글이 더 붙은 제목은 아님)', () => {
  const specs = collectSpecs(report);
  const hs = specs.find(s => s.id === 'hs');
  const re = new RegExp(titlePattern(hs));
  assert.ok(re.test(' chromium tests/app-e2e/heavy.spec.mjs 390px same (1+1)? [x]'));
  assert.ok(!re.test(' chromium tests/app-e2e/z.spec.mjs same (1+1)? [x]'));
  assert.ok(!re.test(' chromium tests/app-e2e/heavy.spec.mjs 390px same (1+1)? [x] more'));
  assert.ok(!re.test(' chromium xtests/app-e2e/heavy.spec.mjs 390px same (1+1)? [x]'));
  const grep = grepFor([hs, specs[0]]);
  assert.match(grep, /^\/.*\/$/);
  const whole = new RegExp(grep.slice(1, -1));
  assert.ok(whole.test(' chromium tests/app-e2e/a.spec.mjs a1'));
  assert.ok(!whole.test(' chromium tests/app-e2e/a.spec.mjs a2'));
});

test('verify: 빠진 시험·덧붙은 시험·시험 수 차이를 잡는다', () => {
  const p = plan(report, 1, 2);
  const run = ids => ({suites: [{title: 'f', specs: ids.map(id => spec('f', id, id))}]});
  assert.equal(verify(p, run(p.specIds)).ok, true);
  const missing = verify(p, run(p.specIds.slice(1)));
  assert.equal(missing.ok, false);
  assert.match(missing.problems.join(), /돌지 않은 spec 1개/);
  const extra = verify(p, run([...p.specIds, 'other']));
  assert.match(extra.problems.join(), /맡지 않은 spec 1개/);
});

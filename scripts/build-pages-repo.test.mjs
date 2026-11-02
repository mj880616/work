import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { buildPages, fillStaticChains, staticChain } from './build-pages.mjs';
import { checkBuild } from './check-pages-build.mjs';

// The repository (plain paths since CI-버전자동화 3단계) is the Pages build input.
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const source = /\.(?:html|js|mjs|css)$/i;
const input = Object.fromEntries(execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\0').filter(file => file && existsSync(`${root}/${file}`))
  // Git and GitHub Pages hold LF; a Windows checkout may hold CRLF.
  .map(file => [file, source.test(file) ? readFileSync(`${root}/${file}`, 'utf8').replace(/\r\n/g, '\n') : readFileSync(`${root}/${file}`)]));

test('the repository builds into hashed references, a matching manifest and Worker-pinnable assets', async () => {
  const output = buildPages(input);
  const result = await checkBuild(output);
  assert.deepEqual(result.errors, []);
  assert.ok(result.references > 300 && result.assets > 100 && result.workerChecked > 100, JSON.stringify(result));
  assert.match(output['app/index.html'], /<script src="\.\/app\.js\?v=[0-9a-f]{10}" defer><\/script>/);
  assert.match(output['app/app.js'], /import\('\.\/loader-v2\.js\?v=[0-9a-f]{10}'\)/);
  assert.ok(!Object.hasOwn(input, 'app/asset-manifest.json'), 'the manifest exists only in the build output');
});

test('the build is deterministic for the same repository input', () => {
  assert.deepEqual(buildPages(input), buildPages(input));
});

test('an unbuilt tree fails the hash check, so the check cannot pass by accident', async () => {
  const { errors } = await checkBuild(input);
  assert.ok(errors.includes('(a) app/index.html: ./app.js → ?v= 없음'), errors.slice(0, 3).join('\n'));
});

// PERF-첫로딩 P4: 빌드가 채운 미리 받기 목록(tests/loader-preload.test.mjs는 소스만 본다).
test('the build fills the Web2 preload lists with whole static chains, and the pre-login list stays auth-only', () => {
  const filled = fillStaticChains(input);
  const lists = file => [...filled[file].matchAll(/\/\*static-chain\*\/\[([^\]]*)\]/g)].map(m => ({ at: m.index, files: [...m[1].matchAll(/'\.\/([^'?]+)'/g)].map(x => `app/${x[1]}`) }));
  const loader = lists('app/loader-v2.js');
  const listed = new Set(loader.flatMap(l => l.files));
  for (const root of ['app/area-window.js', 'app/team.js', 'app/topbar-actions.js']) {
    for (const file of staticChain(input, [root])) assert.ok(listed.has(file), `${root} 사슬의 ${file} 빠짐`);
  }
  const gate = filled['app/loader-v2.js'].indexOf('if(!authenticated)');
  assert.ok(gate > 0);
  for (const { at, files } of loader) if (at < gate) assert.deepEqual(files, ['app/auth-handoff-client.js', 'app/auth-bootstrap.js', 'app/auth-service.js']);
  const views = lists('app/view-loader.js');
  const home = views.find(l => l.files[0] === 'app/journal.js');
  assert.ok(home && home.files.length > 30, '홈 첫 프로그램 사슬');
  const team = views.find(l => l.files[0] === 'app/suborganizations.js');
  assert.ok(team && !team.files.includes('app/workplace-detail.js'), '담당조직 첫 목록에 조직 상세는 넣지 않는다(P5)');
});

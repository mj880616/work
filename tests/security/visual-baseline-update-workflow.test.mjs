// CI-기준사진갱신: 기준 사진을 CI에서 찍어 PR 브랜치에 커밋하는 수동 workflow의 안전 규칙과 검사 도우미를 고정한다.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  SNAP_DIR, checkPrNumber, parseNames, grepFor, checkPr, parseStatusZ, checkChanges, labelOf, pick, sizeRows,
} from '../../scripts/ops/visual-baseline-update.mjs';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n');
const wfRaw = read('.github/workflows/visual-baseline-update.yml');
// 주석 줄을 뺀 본문(설명 글에 나온 낱말로 시험이 틀리지 않게).
const wf = wfRaw.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
const e2e = read('.github/workflows/app-e2e-check.yml');
const spec = read('tests/app-e2e/visual-baseline.spec.mjs');
const REPO = 'owner/repo';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);

const jobBlock = name => {
  const m = new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z][a-z-]*:\\n|$)`).exec(wf);
  assert.ok(m, `job ${name}`);
  return m[1];
};

// ---- workflow 모양 ----

test('수동 실행만, pull_request_target·비밀값 없음, 맨 위 권한은 비움', () => {
  assert.match(wf, /\non:\n  workflow_dispatch:\n/);
  assert.doesNotMatch(wf, /pull_request_target|pull_request:|push:|schedule:/);
  assert.doesNotMatch(wf, /secrets\./);
  assert.match(wf, /\npermissions: \{\}\n/);
  assert.match(wf, /pr:\n        description: [^\n]+\n        required: true/);
  assert.match(wf, /names:\n        description: [^\n]+\n        required: false/);
});

test('쓰기 권한은 commit job(contents)·recheck job(actions)에만', () => {
  for (const job of ['prepare', 'capture', 'commit', 'recheck']) assert.match(jobBlock(job), /permissions:\n/, job);
  const writes = [...wf.matchAll(/^\s+([a-z-]+): write$/gm)].map(m => m[1]);
  assert.deepEqual(writes.sort(), ['actions', 'contents']);
  assert.match(jobBlock('commit'), /contents: write/);
  assert.match(jobBlock('recheck'), /actions: write/);
  assert.doesNotMatch(jobBlock('capture'), /: write/);
  assert.doesNotMatch(jobBlock('prepare'), /: write/);
});

test('main에서만 실행하고, 입력·PR 검사는 main 쪽 스크립트로', () => {
  const p = jobBlock('prepare');
  assert.match(p, /if: github\.ref != 'refs\/heads\/main'[\s\S]*exit 1/);
  assert.match(p, /check-input "\$IN_PR" "\$IN_NAMES"/);
  assert.match(p, /check-pr \/tmp\/pr\.json "\$REPO" "\$DEFAULT_BRANCH"/);
  // 입력값은 env로만 넘긴다(run 안에 ${{ inputs.* }} 직접 넣지 않음 — 명령 주입 방지).
  for (const m of wf.matchAll(/run: \|?\n?([\s\S]*?)(?=\n      - |\n  [a-z]|\n$)/g)) assert.doesNotMatch(m[1], /\$\{\{\s*(inputs|github\.event)\./);
});

test('capture는 고정 SHA를 인증정보 없이 받고, CI와 같은 설치 action을 캐시 저장 없이 쓴다', () => {
  const c = jobBlock('capture');
  assert.match(c, /ref: \$\{\{ needs\.prepare\.outputs\.head_sha \}\}\n\s+persist-credentials: false/);
  assert.match(c, /uses: \.\/\.github\/actions\/setup-playwright\n\s+with:\n\s+save-cache: 'false'/);
  assert.match(e2e, /uses: \.\/\.github\/actions\/setup-playwright/);
  assert.match(c, /tests\/app-e2e\/helpers\/static-server\.py 8123/);
  assert.match(c, /tests\/app-e2e\/visual-baseline\.spec\.mjs --browser=chromium --workers=2 --reporter=line --update-snapshots=changed/);
  assert.doesNotMatch(c, /\n\s+version:/, 'Playwright 판은 setup-playwright 기본값(CI와 같음)');
  assert.doesNotMatch(c, /GH_TOKEN|github\.token/);
});

test('commit job은 PR 코드를 실행하지 않는다(검사는 trusted/ 스크립트, npm·npx 없음)', () => {
  const c = jobBlock('commit');
  assert.match(c, /path: trusted\n\s+persist-credentials: false/);
  assert.match(c, /path: pr\n\s+ref: \$\{\{ needs\.prepare\.outputs\.head_sha \}\}/);
  assert.doesNotMatch(c, /\bnpm\b|\bnpx\b|node pr\/|setup-playwright/);
  for (const m of c.matchAll(/node (\S+)/g)) assert.equal(m[1], 'trusted/scripts/ops/visual-baseline-update.mjs');
  assert.match(c, /check-changes \/tmp\/vb-status/);
  assert.match(c, /pick \/tmp\/vb-dl \/tmp\/vb-new/);
});

test('push 전 PR이 그대로인지 다시 보고, 강제 push 없이 github-actions noreply로 커밋', () => {
  const c = jobBlock('commit');
  assert.match(c, /"\$state" != "open" \] \|\| \[ "\$sha" != "\$HEAD_SHA" \][\s\S]*exit 1/);
  assert.match(c, /git config user\.email '41898299\+github-actions\[bot\]@users\.noreply\.github\.com'/);
  assert.match(c, /git commit -q -m "기준 사진 갱신: \$\{LABEL\/\/,\/, \} \(workflow 실행 #\$RUN_NUMBER\)"/);
  assert.match(c, /git push origin "HEAD:refs\/heads\/\$HEAD_REF"/);
  assert.doesNotMatch(wf, /--force|push -f|\+HEAD/);
  assert.match(c, /git add -- tests\/app-e2e\/visual-baseline\.spec\.mjs-snapshots\n/);
});

// ---- 입력 ----

test('PR 번호는 숫자만', () => {
  assert.equal(checkPrNumber(' 3277 '), '3277');
  for (const bad of ['', '0', '-1', '12a', '1;rm', '3277 3217', '12345678']) assert.throws(() => checkPrNumber(bad), /PR 번호/, bad);
});

test('이름 목록 읽기: 빈칸 허용·중복 제거, 모양이 틀리면 실패', () => {
  assert.deepEqual(parseNames(''), []);
  assert.deepEqual(parseNames(' home:phone, note:phone,library:pc,home:phone '), [
    { name: 'home', tag: 'phone' }, { name: 'note', tag: 'phone' }, { name: 'library', tag: 'pc' }]);
  // FIX-노트폴드목록: 폴드 펼침 폭 사진(<화면>:fold, 712px)도 이름으로 고를 수 있다.
  assert.deepEqual(parseNames('note-folder:fold'), [{ name: 'note-folder', tag: 'fold' }]);
  assert.match('visual-baseline.spec.mjs 기준 사진 note-folder (fold 712px)', new RegExp(grepFor(parseNames('note-folder:fold'))));
  assert.deepEqual(parseNames('menu-edit:pc'), [{ name: 'menu-edit', tag: 'pc' }]);
  for (const bad of ['home', 'home:tablet', 'Home:pc', '../x:pc', 'home:pc;ls', 'a b:pc', '-x:pc', 'x-:pc', '$(id):pc']) {
    assert.throws(() => parseNames(bad), /이름 모양/, bad);
  }
  assert.throws(() => parseNames(Array.from({ length: 41 }, (_, i) => `s${i}:pc`).join(',')), /너무 많/);
});

test('--grep 정규식은 시험 제목과 정확히 맞는다', () => {
  assert.equal(grepFor([]), '');
  const re = new RegExp(grepFor(parseNames('home:phone,library:pc')));
  const titles = [];
  for (const m of spec.matchAll(/\{name:'([a-z0-9-]+)'/g)) for (const [tag, w] of [['pc', 1280], ['phone', 412]]) titles.push([m[1], tag, `visual-baseline.spec.mjs 기준 사진 ${m[1]} (${tag} ${w}px)`]);
  assert.ok(titles.length >= 40);
  const hit = titles.filter(t => re.test(t[2])).map(t => `${t[0]}:${t[1]}`);
  assert.deepEqual(hit.sort(), ['home:phone', 'library:pc']);
  // 시험 제목 모양이 바뀌면 이 workflow의 고르기도 같이 고쳐야 한다.
  assert.match(spec, /test\(`기준 사진 \$\{screen\.name\} \(\$\{tag\} \$\{width\}px\)`/);
  assert.match(spec, /\{tag:'pc',width:1280,[^}]*\},\{tag:'phone',width:412,/);
  assert.match(spec, /toHaveScreenshot\(`\$\{screen\.name\}-\$\{tag\}\.png`/);
});

// ---- PR 검사 ----

const goodPr = (over = {}) => ({
  number: 3277, state: 'open',
  head: { ref: 'ui/some-change', sha: 'a'.repeat(40), repo: { full_name: REPO } },
  base: { ref: 'main', repo: { full_name: REPO } },
  ...over,
});

test('열린 같은 저장소 PR이면 브랜치·SHA를 돌려준다', () => {
  assert.deepEqual(checkPr(goodPr(), REPO, 'main'), { headRef: 'ui/some-change', headSha: 'a'.repeat(40) });
});

test('닫힌 PR·포크·기본 브랜치·이상한 브랜치 이름·SHA 없음은 거절', () => {
  assert.throws(() => checkPr(goodPr({ state: 'closed' }), REPO, 'main'), /열린 PR/);
  assert.throws(() => checkPr(goodPr({ head: { ref: 'x', sha: 'a'.repeat(40), repo: { full_name: 'other/repo' } } }), REPO, 'main'), /포크/);
  assert.throws(() => checkPr(goodPr({ head: { ref: 'x', sha: 'a'.repeat(40), repo: null } }), REPO, 'main'), /포크/);
  for (const ref of ['main', 'master', 'gh-pages']) {
    assert.throws(() => checkPr(goodPr({ head: { ref, sha: 'a'.repeat(40), repo: { full_name: REPO } } }), REPO, 'main'), /기본 브랜치/, ref);
  }
  assert.throws(() => checkPr(goodPr({ head: { ref: 'develop', sha: 'a'.repeat(40), repo: { full_name: REPO } } }), REPO, 'develop'), /기본 브랜치/);
  for (const ref of ['-x', 'a..b', 'a b', 'a;b', 'x.lock', 'x/', '$(id)', '']) {
    assert.throws(() => checkPr(goodPr({ head: { ref, sha: 'a'.repeat(40), repo: { full_name: REPO } } }), REPO, 'main'), /브랜치 이름/, ref);
  }
  assert.throws(() => checkPr(goodPr({ head: { ref: 'x', sha: 'abc', repo: { full_name: REPO } } }), REPO, 'main'), /SHA/);
  assert.throws(() => checkPr(goodPr({ base: { ref: 'main', repo: { full_name: 'other/repo' } } }), REPO, 'main'), /이 저장소/);
});

// ---- 바뀐 파일 검사 ----

const z = (...rows) => rows.join('\0') + '\0';

test('기준 사진 PNG(새로·고침)만 바뀌었으면 통과하고 이름표를 만든다', () => {
  const files = checkChanges(parseStatusZ(z(` M ${SNAP_DIR}/home-phone-chromium-linux.png`, `?? ${SNAP_DIR}/menu-edit-pc-chromium-linux.png`)));
  assert.deepEqual(files, [`${SNAP_DIR}/home-phone-chromium-linux.png`, `${SNAP_DIR}/menu-edit-pc-chromium-linux.png`]);
  assert.deepEqual(files.map(labelOf), ['home:phone', 'menu-edit:pc']);
  assert.deepEqual(checkChanges(parseStatusZ('')), []);
});

test('다른 파일·지움·이름 바뀜·다른 폴더 PNG가 끼면 실패', () => {
  const bad = [
    z(` M ${SNAP_DIR}/home-phone-chromium-linux.png`, ' M app/app.js'),
    z(`?? .github/workflows/x.yml`),
    z(` D ${SNAP_DIR}/home-phone-chromium-linux.png`),
    z(`R  ${SNAP_DIR}/home-pc-chromium-linux.png`, `${SNAP_DIR}/home-phone-chromium-linux.png`),
    z(`?? tests/app-e2e/other.spec.mjs-snapshots/home-pc-chromium-linux.png`),
    z(`?? ${SNAP_DIR}/home-pc-chromium-darwin.png`),
    z(`?? ${SNAP_DIR}/sub/home-pc-chromium-linux.png`),
    z(`?? ${SNAP_DIR}/home-pc-chromium-linux.png.txt`),
  ];
  for (const s of bad) assert.throws(() => checkChanges(parseStatusZ(s)), /기준 사진 말고/, s);
});

// ---- 받은 사진 고르기 ----

test('pick: 이름·PNG 모양이 맞는 사진만 평평하게 옮기고, 아니면 멈춘다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vb-pick-'));
  const from = join(dir, 'from');
  mkdirSync(join(from, 'nested'), { recursive: true });
  writeFileSync(join(from, 'home-phone-chromium-linux.png'), PNG);
  writeFileSync(join(from, 'nested', 'note-pc-chromium-linux.png'), PNG);
  assert.deepEqual(pick(from, join(dir, 'to')), ['home-phone-chromium-linux.png', 'note-pc-chromium-linux.png']);
  assert.deepEqual(readdirSync(join(dir, 'to')).sort(), ['home-phone-chromium-linux.png', 'note-pc-chromium-linux.png']);

  const notPng = join(dir, 'b');
  mkdirSync(notPng);
  writeFileSync(join(notPng, 'home-phone-chromium-linux.png'), 'not a png');
  assert.throws(() => pick(notPng, join(dir, 'to2')), /모양이 아닌/);

  const otherName = join(dir, 'c');
  mkdirSync(otherName);
  writeFileSync(join(otherName, 'x.yml'), 'x');
  assert.throws(() => pick(otherName, join(dir, 'to3')), /모양이 아닌/);

  const link = join(dir, 'd');
  mkdirSync(link);
  symlinkSync('/etc/hostname', join(link, 'home-pc-chromium-linux.png'));
  assert.throws(() => pick(link, join(dir, 'to4')), /모양이 아닌/);

  const dup = join(dir, 'e');
  mkdirSync(join(dup, 'a'), { recursive: true });
  mkdirSync(join(dup, 'b'));
  writeFileSync(join(dup, 'a', 'home-pc-chromium-linux.png'), PNG);
  writeFileSync(join(dup, 'b', 'home-pc-chromium-linux.png'), PNG);
  assert.throws(() => pick(dup, join(dir, 'to5')), /같은 이름/);

  const empty = join(dir, 'f');
  mkdirSync(empty);
  assert.deepEqual(pick(empty, join(dir, 'to6')), []);
});

test('요약 표: 크기 전후와 차이, 새 사진 표시', () => {
  const rows = sizeRows([`${SNAP_DIR}/home-phone-chromium-linux.png`, `${SNAP_DIR}/menu-edit-pc-chromium-linux.png`],
    f => (f.includes('home') ? 1000 : null), f => (f.includes('home') ? 900 : 1200));
  assert.deepEqual(rows, ['| home:phone | 1000 | 900 | -100 |', '| menu-edit:pc | 없음 | 1200 | 새 사진 |']);
});

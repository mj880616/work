import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FACE_IDS } from './brand-face.mjs';

// S67-56(2026-11-20 사용자 결정, AGENTS.md 5절): 운영 배포는 WORK ON 기본 단어 얼굴(girok)이다.
// 운영 Pages를 만드는 곳(pages-deploy.yml)과 운영 파일과 맞춰 보는 곳(cloudflare-worker-deploy.yml)이 같은 얼굴이어야 하고,
// PR 검사(pages-build-check.yml)는 그 얼굴 빌드를 따로 만들어 같은 검사·화면 시험을 한다.
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const builds = file => [...read(file).matchAll(/node scripts\/build-pages\.mjs _site "\$RUNNER_TEMP\/([\w-]+)"([^\n]*)/g)].map(m => ({ out: m[1], rest: m[2].trim() }));
const PRODUCTION_FACE = 'girok';

test('운영 Pages 빌드와 Worker 대조 빌드는 같은 얼굴(girok)이다', () => {
  assert.ok(FACE_IDS.includes(PRODUCTION_FACE));
  for (const file of ['.github/workflows/pages-deploy.yml', '.github/workflows/cloudflare-worker-deploy.yml']) {
    const found = builds(file);
    assert.equal(found.length, 1, `${file}: 빌드 한 번`);
    assert.equal(found[0].rest, `--face=${PRODUCTION_FACE}`, file);
  }
  assert.match(read('.github/workflows/pages-deploy.yml'), /node scripts\/check-girok-words\.mjs "\$RUNNER_TEMP\/pages-out"/, '배포 전 화면 글자 검사');
});

test('PR 검사는 운영 얼굴 빌드를 만들어 검사·화면 시험·운영 비교를 한다', () => {
  const file = '.github/workflows/pages-build-check.yml', yml = read(file);
  const face = builds(file).find(b => b.rest === `--face=${PRODUCTION_FACE}`);
  assert.ok(face, '운영 얼굴 빌드');
  for (const step of [`check-pages-build.mjs "$RUNNER_TEMP/${face.out}"`, `check-girok-words.mjs "$RUNNER_TEMP/${face.out}"`, `compare-pages.mjs --live "$RUNNER_TEMP/${face.out}"`, `cd "$RUNNER_TEMP/${face.out}" && python3 -m http.server 8126`]) {
    assert.ok(yml.includes(step), step);
  }
});

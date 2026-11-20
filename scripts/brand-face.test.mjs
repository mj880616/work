import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { buildPages } from './build-pages.mjs';
import { checkBuild } from './check-pages-build.mjs';
import { applyFace, faceHtml, FACE_FILE, WEB_MANIFEST, APP_ICON } from './brand-face.mjs';
import { FACES } from '../app/brand/faces.mjs';

// APP-올인원다이어리 단계 2: 빌드가 얼굴을 정한다. 지금 운영(nojo) 빌드는 얼굴 기능 전과 같고, girok(WORK ON 기본 단어) 빌드는 따로 나온다.
// 앱 이름·아이콘은 두 얼굴 모두 WORK ON 표장 A(S67-49).
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const source = /\.(?:html|js|mjs|css)$/i;
const input = Object.fromEntries(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\0').filter(file => file && existsSync(`${root}/${file}`))
  .map(file => [file, source.test(file) ? readFileSync(`${root}/${file}`, 'utf8').replace(/\r\n/g, '\n') : readFileSync(`${root}/${file}`)]));

const nojo = buildPages(input);
const girok = buildPages(input, { face: 'girok' });
const text = value => typeof value === 'string' ? value : value.toString('utf8');
// 사람 눈에 보이는 글자: 태그 사이 글자와 aria-label·alt·title 값.
const visible = html => [
  ...[...html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, '').matchAll(/>([^<>]+)</g)].map(m => m[1].trim()).filter(Boolean),
  ...[...html.matchAll(/\s(?:aria-label|alt|title)="([^"]*)"/g)].map(m => m[1])
];

test('지금 운영 얼굴(nojo)은 빌드 입력을 그대로 쓴다: 얼굴을 적든 안 적든 결과가 한 바이트도 같다', () => {
  assert.equal(applyFace(input), input);
  assert.equal(applyFace(input, 'nojo'), input);
  assert.deepEqual(buildPages(input, { face: 'nojo' }), nojo);
  for (const file of [FACE_FILE, WEB_MANIFEST, APP_ICON, 'app/index.html', 'app/login/index.html']) {
    // 고쳐 쓰는 파일은 ?v= 말고는 저장소 글자 그대로.
    assert.equal(text(nojo[file]).replace(/\?v=[0-9a-f]{10}/g, ''), text(input[file]).replace(/\?v=[0-9a-f]{10}/g, ''), file);
  }
  assert.match(text(nojo[WEB_MANIFEST]), /"name":"WORK ON"/);
  assert.match(nojo['app/index.html'], /<title>WORK ON<\/title>/);
});

test('모르는 얼굴은 빌드하지 않는다', () => {
  assert.throws(() => buildPages(input, { face: 'other' }), /모르는 얼굴/);
});

test('girok 빌드: 얼굴 한 줄·manifest·아이콘·제목이 WORK ON이고 검사를 통과한다', async () => {
  const face = FACES.girok;
  assert.equal(girok[FACE_FILE], "export const FACE_ID = 'girok';\n");
  const manifest = JSON.parse(text(girok[WEB_MANIFEST]));
  assert.equal(manifest.name, 'WORK ON');
  assert.equal(manifest.short_name, 'WORK ON');
  assert.equal(manifest.theme_color, face.themeColor);
  assert.equal(face.icon, APP_ICON, '두 얼굴이 같은 표장 A');
  assert.deepEqual(manifest.icons, JSON.parse(text(input[WEB_MANIFEST])).icons, '같은 아이콘이라 PNG 아이콘 목록 그대로');
  assert.ok(Buffer.from(girok[APP_ICON]).equals(Buffer.from(nojo[APP_ICON])));
  const index = girok['app/index.html'];
  assert.match(index, /<title>WORK ON<\/title>/);
  assert.match(girok['app/login/index.html'], /<title>로그인 · WORK ON<\/title>/);
  assert.match(index, /icons\/app-icon-180\.png/, '같은 아이콘이라 PNG 아이콘 줄 그대로');
  const seen = Object.keys(girok).filter(file => file.startsWith('app/') && file.endsWith('.html')).flatMap(file => visible(girok[file]));
  for (const word of Object.keys(face.words).filter(key => !key.includes('#'))) assert.ok(!seen.some(text => text.includes(word)), `기록+ 화면 글자에 '${word}'가 남음`);
  for (const word of ['활동 기록', '거래처·직원', 'WORK ON']) assert.ok(seen.includes(word), `기록+ 화면 글자에 '${word}'`);
  const result = await checkBuild(girok);
  assert.deepEqual(result.errors, []);
  // 저장소 입력은 그대로(빌드 출력에서만 고침).
  assert.equal(input[FACE_FILE], "export const FACE_ID = 'nojo';\n");
});

test('girok 빌드는 얼굴이 닿는 파일 말고는 nojo 빌드와 ?v= 번호만 다르다', () => {
  const touched = new Set([FACE_FILE, WEB_MANIFEST, APP_ICON, 'app/asset-manifest.json']);
  assert.deepEqual(Object.keys(girok).sort(), Object.keys(nojo).sort());
  for (const file of Object.keys(nojo)) {
    if (touched.has(file) || (file.startsWith('app/') && file.endsWith('.html'))) continue;
    const a = text(nojo[file]).replace(/\?v=[0-9a-f]{10}/g, '?v='), b = text(girok[file]).replace(/\?v=[0-9a-f]{10}/g, '?v=');
    assert.equal(b, a, file);
  }
});

test('HTML 얼굴 입히기는 눈에 보이는 글자만 바꾼다(script·style·주석·속성 이름은 그대로)', () => {
  const html = '<title>WORK ON</title><a data-view="team" data-kind="담당조직">조직 관리</a><span>담당조직을 고르세요</span><div aria-label="사업 관리"></div><input placeholder="사업영역 이름"><!-- 담당조직 --><style>.x{}</style><script>const a="사업 관리"</script>';
  assert.equal(faceHtml(html, FACES.girok), '<title>WORK ON</title><a data-view="team" data-kind="담당조직">거래처·직원</a><span>관리 대상을 고르세요</span><div aria-label="활동 기록"></div><input placeholder="프로젝트 이름"><!-- 담당조직 --><style>.x{}</style><script>const a="사업 관리"</script>');
  assert.equal(faceHtml(html, FACES.nojo).replace(/<title>[^<]*<\/title>/, ''), html.replace(/<title>[^<]*<\/title>/, ''), 'nojo 단어표는 비어 있다');
});

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { buildPages } from './build-pages.mjs';
import { checkBuild } from './check-pages-build.mjs';
import { applyFace, faceHtml, FACE_FILE, WEB_MANIFEST, APP_ICON } from './brand-face.mjs';
import { FACES } from '../app/brand/faces.mjs';

// APP-올인원다이어리 단계 2: 빌드가 얼굴을 정한다. 노동조합+ 빌드는 얼굴 기능 전과 같고, 기록+ 빌드는 따로 나온다.
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

test('노동조합+ 얼굴은 빌드 입력을 그대로 쓴다: 얼굴을 적든 안 적든 결과가 한 바이트도 같다', () => {
  assert.equal(applyFace(input), input);
  assert.equal(applyFace(input, 'nojo'), input);
  assert.deepEqual(buildPages(input, { face: 'nojo' }), nojo);
  for (const file of [FACE_FILE, WEB_MANIFEST, APP_ICON, 'app/index.html', 'app/login/index.html']) {
    // 고쳐 쓰는 파일은 ?v= 말고는 저장소 글자 그대로.
    assert.equal(text(nojo[file]).replace(/\?v=[0-9a-f]{10}/g, ''), text(input[file]).replace(/\?v=[0-9a-f]{10}/g, ''), file);
  }
  assert.match(text(nojo[WEB_MANIFEST]), /"name":"노동조합\+"/);
  assert.match(nojo['app/index.html'], /<title>노동조합\+<\/title>/);
});

test('모르는 얼굴은 빌드하지 않는다', () => {
  assert.throws(() => buildPages(input, { face: 'other' }), /모르는 얼굴/);
});

test('기록+ 빌드: 얼굴 한 줄·manifest·아이콘·제목이 기록+이고 검사를 통과한다', async () => {
  const face = FACES.girok;
  assert.equal(girok[FACE_FILE], "export const FACE_ID = 'girok';\n");
  const manifest = JSON.parse(text(girok[WEB_MANIFEST]));
  assert.equal(manifest.name, '기록+');
  assert.equal(manifest.short_name, '기록+');
  assert.equal(manifest.theme_color, face.themeColor);
  assert.deepEqual(manifest.icons.map(icon => icon.src), ['./app-icon.svg']);
  assert.ok(Buffer.from(girok[APP_ICON]).equals(Buffer.from(input[face.icon])), '기록+ 임시 아이콘이 app-icon.svg 자리에');
  assert.ok(!Buffer.from(girok[APP_ICON]).equals(Buffer.from(nojo[APP_ICON])));
  const index = girok['app/index.html'];
  assert.match(index, /<title>기록\+<\/title>/);
  assert.match(girok['app/login/index.html'], /<title>로그인 · 기록\+<\/title>/);
  assert.doesNotMatch(index, /icons\/app-icon-/, '노동조합+ PNG 아이콘 줄 없음');
  const seen = Object.keys(girok).filter(file => file.startsWith('app/') && file.endsWith('.html')).flatMap(file => visible(girok[file]));
  for (const word of Object.keys(face.words)) assert.ok(!seen.includes(word), `기록+ 화면 글자에 '${word}'가 남음`);
  for (const word of ['프로젝트·거래처', '사람 수첩', '기록+']) assert.ok(seen.includes(word), `기록+ 화면 글자에 '${word}'`);
  const result = await checkBuild(girok);
  assert.deepEqual(result.errors, []);
  // 저장소 입력은 그대로(빌드 출력에서만 고침).
  assert.equal(input[FACE_FILE], "export const FACE_ID = 'nojo';\n");
});

test('기록+ 빌드는 얼굴이 닿는 파일 말고는 노동조합+ 빌드와 ?v= 번호만 다르다', () => {
  const touched = new Set([FACE_FILE, WEB_MANIFEST, APP_ICON, 'app/asset-manifest.json']);
  assert.deepEqual(Object.keys(girok).sort(), Object.keys(nojo).sort());
  for (const file of Object.keys(nojo)) {
    if (touched.has(file) || (file.startsWith('app/') && file.endsWith('.html'))) continue;
    const a = text(nojo[file]).replace(/\?v=[0-9a-f]{10}/g, '?v='), b = text(girok[file]).replace(/\?v=[0-9a-f]{10}/g, '?v=');
    assert.equal(b, a, file);
  }
});

test('HTML 얼굴 입히기는 글자 칸 전체가 같은 단어일 때만 바꾼다', () => {
  const html = '<title>노동조합+</title><a data-view="team">조직 관리</a><span>조직 관리 화면</span><div aria-label="사업 관리"></div><script>const a="사업 관리"</script>';
  assert.equal(faceHtml(html, FACES.girok), '<title>기록+</title><a data-view="team">사람 수첩</a><span>조직 관리 화면</span><div aria-label="프로젝트·거래처"></div><script>const a="사업 관리"</script>');
});

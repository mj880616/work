import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { buildPages } from './build-pages.mjs';
import { checkBuild } from './check-pages-build.mjs';
import { applyFace, faceHtml, FACE_FILE, WEB_MANIFEST, APP_ICON } from './brand-face.mjs';
import { FACES, wordIn } from '../app/brand/faces.mjs';

// APP-올인원다이어리 단계 2: 빌드가 얼굴을 정한다. 지금 운영(nojo) 빌드는 얼굴 기능 전과 같고, girok(WORK ON+ 기본 단어) 빌드는 따로 나온다.
// 앱 이름·아이콘은 두 얼굴 모두 WORK ON+ 표장 A(S67-49).
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
  assert.match(text(nojo[WEB_MANIFEST]), /"name":"WORK ON\+"/);
  assert.match(nojo['app/index.html'], /<title>WORK ON\+<\/title>/);
});

test('모르는 얼굴은 빌드하지 않는다', () => {
  assert.throws(() => buildPages(input, { face: 'other' }), /모르는 얼굴/);
});

test('girok 빌드: 얼굴 한 줄·manifest·아이콘·제목이 WORK ON+고 검사를 통과한다', async () => {
  const face = FACES.girok;
  assert.equal(girok[FACE_FILE], "export const FACE_ID = 'girok';\n");
  const manifest = JSON.parse(text(girok[WEB_MANIFEST]));
  assert.equal(manifest.name, 'WORK ON+');
  assert.equal(manifest.short_name, 'WORK ON+');
  assert.equal(manifest.theme_color, face.themeColor);
  assert.equal(face.icon, APP_ICON, '두 얼굴이 같은 표장 A');
  assert.deepEqual(manifest.icons, JSON.parse(text(input[WEB_MANIFEST])).icons, '같은 아이콘이라 PNG 아이콘 목록 그대로');
  assert.ok(Buffer.from(girok[APP_ICON]).equals(Buffer.from(nojo[APP_ICON])));
  const index = girok['app/index.html'];
  assert.match(index, /<title>WORK ON\+<\/title>/);
  assert.match(girok['app/login/index.html'], /<title>로그인 · WORK ON\+<\/title>/);
  assert.match(index, /icons\/app-icon-180\.png/, '같은 아이콘이라 PNG 아이콘 줄 그대로');
  const seen = Object.keys(girok).filter(file => file.startsWith('app/') && file.endsWith('.html')).flatMap(file => visible(girok[file]));
  // NAV-조직사업합침(2026-11-28 사용자 결정): 글자 그대로 두는 열쇠(메뉴 이름 '조직·사업')는 화면에 남는 것이 맞다.
  const kept = Object.keys(face.words).filter(key => !key.includes('#') && face.words[key] === key);
  const plain = seen.map(text => kept.reduce((out, key) => out.split(key).join(''), text));
  for (const word of Object.keys(face.words).filter(key => !key.includes('#') && !kept.includes(key))) assert.ok(!plain.some(text => text.includes(word)), `기록+ 화면 글자에 '${word}'가 남음`);
  for (const word of ['조직·사업', 'WORK ON+']) assert.ok(seen.includes(word), `기록+ 화면 글자에 '${word}'`);
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
  const html = '<title>WORK ON+</title><a data-view="team" data-kind="담당조직">조직 관리</a><span>담당조직을 고르세요</span><div aria-label="사업 관리"></div><input placeholder="사업영역 이름"><!-- 담당조직 --><style>.x{}</style><script>const a="사업 관리"</script>';
  assert.equal(faceHtml(html, FACES.girok), '<title>WORK ON+</title><a data-view="team" data-kind="담당조직">거래처·직원</a><span>관리 대상을 고르세요</span><div aria-label="활동 기록"></div><input placeholder="프로젝트 이름"><!-- 담당조직 --><style>.x{}</style><script>const a="사업 관리"</script>');
  assert.equal(faceHtml(html, FACES.nojo).replace(/<title>[^<]*<\/title>/, ''), html.replace(/<title>[^<]*<\/title>/, ''), 'nojo 단어표는 비어 있다');
});

// S67-56: 운영이 girok 얼굴이 되면서, 고친 이름(custom_words)이 있는 사람도 앱 바탕 글자를 제 이름으로 봐야 한다.
// S67-62: 바탕 낱말 묶음(노동조합+ 낱말)인 사람은 칸 밖 낱말까지 원래 글자여야 해서, 앱 바탕(app/index.html)에서 바꾼 글자는 모두 원래 글자를 남긴다.
test('girok 앱 바탕: 바꾼 글자마다 원래 글자를 남기고, 다른 HTML은 남기지 않는다', () => {
  const index = girok['app/index.html'];
  assert.match(index, /<html data-word-faced lang="ko">/);
  // NAV-조직사업합침: 메뉴 이름 '조직·사업'은 모든 사람 같은 글자라 얼굴 입히기가 바꾸지 않는다(원래 글자 남길 일 없음).
  assert.match(index, /data-view="team" data-nav-group="team meetings projects weekly" href="\.\/\?view=team">조직·사업<\/a>/);
  assert.match(index, /<span>조직·사업<\/span>/);
  assert.match(index, /aria-label="활동 기록으로 돌아가기" data-word-aria-label="사업 관리로 돌아가기"/);
  // 이름 칸 밖 낱말(서식 등)도 남긴다(S67-62).
  assert.match(index, /<!--word:노조 양식으로 새 문서-->서식으로 새 문서</);
  for (const file of Object.keys(girok)) if (file !== 'app/index.html' && file.endsWith('.html')) assert.doesNotMatch(text(girok[file]), /<!--word:|data-word-/, file);
  assert.doesNotMatch(nojo['app/index.html'], /<!--word:|data-word-/, 'nojo 빌드는 저장소 그대로');
  // 남긴 원래 글자에 얼굴 단어를 다시 쓰면 지금 보이는 글자와 같다(빌드와 시작 때 글자 입히기가 같은 규칙).
  for (const [, from, to] of index.matchAll(/<!--word:([^>]*)-->([^<]*)</g)) assert.equal(wordIn(FACES.girok, from), to, from);
  // 원래 글자로 되돌리면(주석 자리 → 원래 글자, data-word-* → 그 속성) nojo 빌드 앱 바탕과 같다(남기지 않은 글자 = 바꾸지 않은 글자).
  const back = index
    .replace(/<!--word:([^>]*)-->[^<]*</g, (_, from) => `${from}<`)
    .replace(/(\s(aria-label|alt|title|placeholder)=")[^"]*(")([^>]*?) data-word-\2="([^"]*)"/g, (_, a, name, b, rest, from) => `${a}${from}${b}${rest}`)
    .replace('<html data-word-faced', '<html')
    .replace(/(<meta name="theme-color" content=")[^"]*(" media="\(prefers-color-scheme: light\)">)/g, `$1${FACES.nojo.themeColor}$2`);
  assert.doesNotMatch(back, /data-word-/);
  const unhashed = html => html.replace(/\?v=[0-9a-f]+/g, '');  // 빌드 해시는 얼굴마다 다른 파일 내용이라 다르다
  assert.equal(unhashed(back), unhashed(nojo['app/index.html']));
});

test('앱 바탕에 원래 글자를 남길 수 없는 글자(주석을 깨는 --, 글자 참조 &)는 빌드를 멈춘다', () => {
  assert.throws(() => faceHtml('<html><b>사업 관리--</b></html>', FACES.girok, { keepOriginals: true }), /원래 글자를 남길 수 없음/);
  assert.throws(() => faceHtml('<html><b>사업 관리 &amp; 기타</b></html>', FACES.girok, { keepOriginals: true }), /원래 글자를 남길 수 없음/);
  assert.equal(faceHtml('<html><b>사업 관리</b></html>', FACES.girok), '<html><b>활동 기록</b></html>', '앱 바탕이 아니면 남기지 않음');
  assert.equal(faceHtml('<html><b>회의</b></html>', FACES.girok, { keepOriginals: true }), '<html data-word-faced><b>회의</b></html>', '바꾸지 않은 글자는 남기지 않음');
});

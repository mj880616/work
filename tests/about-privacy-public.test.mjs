// S62-35 PRODUCT-개인정보처리방침(사용자 11/16): 플레이 콘솔 '앱 콘텐츠'에 넣을 공개 개인정보 처리방침이
// ① Pages 빌드 결과에 그대로 들어가고 ② work.bokdoong.com·nojoplus.com 경로 규칙(410·404)에 걸리지 않으며
// ③ 폰 앱 권한·AI 처리 업체 설명이 실제 코드와 맞는지 본다. Google 권한 표는 tests/about-privacy-page.test.mjs가 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPages} from '../scripts/build-pages.mjs';
import router, {web1Closed} from '../cloudflare/bokdoong-router.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const page = read('about/privacy/index.html');

function walk(dir) {
  return readdirSync(join(root, dir)).flatMap(name => {
    const rel = join(dir, name);
    return statSync(join(root, rel)).isDirectory() ? walk(rel) : [rel];
  });
}

test('Pages 빌드 결과에 about/ 세 페이지와 CSS·로고가 그대로 들어간다', () => {
  const input = Object.fromEntries(walk('about').map(f => [f, f.endsWith('.png') ? readFileSync(join(root, f)) : read(f)]));
  const output = buildPages(input);
  for (const file of ['about/index.html', 'about/privacy/index.html', 'about/terms/index.html', 'about/about.css', 'about/nojoplus-logo-120.png']) {
    assert.ok(Object.hasOwn(output, file), `빌드 결과에 없음: ${file}`);
  }
  // 빌드는 저장소 안 파일 주소에 ?v=(내용 해시)만 붙인다. 그것을 빼면 원문과 같아야 한다.
  assert.equal(output['about/privacy/index.html'].replace(/\?v=[0-9a-f]+/g, ''), page);
  const excluded = read('_config.yml').split('\n').filter(l => /^\s*-\s/.test(l)).map(l => l.replace(/^\s*-\s*/, '').trim());
  assert.ok(!excluded.includes('about') && !excluded.includes('about/'), 'Jekyll이 about/를 빼면 안 된다');
});

test('처리방침 주소는 410·404에 걸리지 않고 Pages에서 가져온다', async () => {
  assert.equal(web1Closed('work.bokdoong.com', '/work/about/privacy/'), false);
  const originalFetch = globalThis.fetch;
  for (const host of ['work.bokdoong.com', 'nojoplus.com']) {
    const calls = [];
    globalThis.fetch = async input => { calls.push(input); return new Response('ok'); };
    try {
      const response = await router.fetch(new Request(`https://${host}/work/about/privacy/`));
      assert.equal(response.status, 200, host);
      assert.equal(calls[0].url, 'https://mj880616.github.io/work/about/privacy/', host);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});

test('소개 페이지와 로그인 화면이 처리방침으로 이어진다', () => {
  assert.match(read('about/index.html'), /href="\.\/privacy\/"/);
  assert.ok(read('app/login/index.html').includes('href="https://work.bokdoong.com/work/about/privacy/"'));
});

test('폰 앱 권한 표가 AndroidManifest.xml의 권한 전부와 같다', () => {
  const manifest = read('android-app/app/src/main/AndroidManifest.xml');
  const requested = [...manifest.matchAll(/<uses-permission android:name="android\.permission\.([A-Z_]+)"/g)].map(m => m[1]).sort();
  assert.ok(requested.length >= 5, `권한을 찾지 못함: ${requested}`);
  const start = page.indexOf('<table id="app-permissions">');
  assert.ok(start > 0, '폰 앱 권한 표 없음');
  const table = page.slice(start, page.indexOf('</table>', start));
  const listed = [...table.matchAll(/<code>([A-Z_]+)<\/code>/g)].map(m => m[1]).sort();
  assert.deepEqual(listed, requested, '처리방침 권한 표와 앱 권한이 다름');
});

test('코드가 부르는 AI 처리 업체가 처리방침에 모두 적혀 있다', () => {
  const code = walk('supabase/functions').filter(f => /\.(ts|mjs|js)$/.test(f)).map(read).join('\n');
  const vendors = [['api.openai.com', 'OpenAI'], ['generativelanguage.googleapis.com', 'Google Gemini API']];
  for (const [host, name] of vendors) {
    if (code.includes(host)) assert.ok(page.includes(name), `처리방침에 AI 업체 없음: ${name}`);
  }
  assert.match(page, /만 14세 미만은 가입 대상이 아닙니다/);
  assert.match(page, /쿠키를 만들지 않습니다/);
  // S69 STORE-계정삭제: 앱 안 [계정 삭제]가 생겼다(옛 문구 '아직 없습니다'는 없어야 한다).
  assert.match(page, /내 프로필 › 계정 › \[계정 삭제\]/);
  assert.doesNotMatch(page, /버튼은 아직 없습니다/);
});

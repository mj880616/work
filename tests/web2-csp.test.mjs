// SEC-Web2CSP 1단계(보고만 하기): Web2 첫 화면·로그인 화면의 보고 전용 CSP와 referrer 정책.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import router from '../cloudflare/bokdoong-router.mjs';
import {WEB2_CSP, WEB2_REFERRER_POLICY, THEME_BOOTSTRAP_HASH, web2CspPage} from '../cloudflare/web2-csp.mjs';

const PAGES = ['app/index.html', 'app/login/index.html'];
const directive = name => WEB2_CSP.split('; ').find(part => part.startsWith(name + ' '))?.split(' ').slice(1) || null;

for (const path of PAGES) {
  const html = readFileSync(path, 'utf8');
  test(`${path}: 인라인 스크립트는 테마 첫 줄 하나뿐이고 정책의 해시와 같다`, () => {
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(([, attrs]) => !/\bsrc=/.test(attrs));
    assert.equal(inline.length, 1);
    assert.match(inline[0][1], /data-kptu-theme-bootstrap/);
    const hash = `'sha256-${createHash('sha256').update(inline[0][2]).digest('base64')}'`;
    assert.equal(hash, THEME_BOOTSTRAP_HASH);
    assert.ok(directive('script-src').includes(hash));
  });
  test(`${path}: <style>·on…=·style= 없음, referrer meta 있음, meta CSP 없음(헤더로만)`, () => {
    assert.doesNotMatch(html, /<style[\s>]/i);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
    assert.doesNotMatch(html, /\sstyle\s*=/i);
    assert.match(html, /<meta name="referrer" content="strict-origin-when-cross-origin">/);
    assert.ok(html.indexOf('name="referrer"') < html.indexOf('rel="stylesheet"'));
    assert.doesNotMatch(html, /http-equiv="Content-Security-Policy/i);
  });
}

test('정책: 스크립트는 eval·인라인 없이, 플러그인·base 바꾸기·남의 화면 안 넣기 막음', () => {
  const script = directive('script-src');
  assert.ok(script.includes("'self'"));
  for (const bad of ["'unsafe-inline'", "'unsafe-eval'", 'https:', '*', 'data:', 'blob:']) assert.ok(!script.includes(bad), bad);
  assert.deepEqual(directive('script-src-attr'), ["'none'"]);
  assert.deepEqual(directive('object-src'), ["'none'"]);
  assert.deepEqual(directive('base-uri'), ["'self'"]);
  assert.deepEqual(directive('frame-ancestors'), ["'self'"]);
  assert.ok(directive('connect-src').includes('https://xmlkxfjeagycwttklxjw.supabase.co'));
  // 넓은 와일드카드(모든 https)는 쓰지 않는다.
  for (const part of WEB2_CSP.split('; ')) assert.ok(!part.split(' ').slice(1).some(v => v === 'https:' || v === '*'), part);
  assert.equal(WEB2_REFERRER_POLICY, 'strict-origin-when-cross-origin');
});

async function request(url, upstream) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => upstream;
  try { return await router.fetch(new Request(url)); } finally { globalThis.fetch = original; }
}
const page = (status = 200) => new Response(status === 304 ? null : '<!doctype html>', {status, headers: status === 304 ? {} : {'Content-Type': 'text/html; charset=utf-8'}});

test('Worker: bokdoong.com의 Web2 첫 화면·로그인 화면에만 보고 전용 CSP와 Referrer-Policy를 붙인다', async () => {
  for (const url of ['https://bokdoong.com/work/app/', 'https://bokdoong.com/work/app/index.html', 'https://bokdoong.com/work/app/login/', 'https://bokdoong.com/work/app/login/index.html', 'https://bokdoong.com/work/app/?view=calendar']) {
    for (const status of [200, 304]) {
      const response = await request(url, page(status));
      assert.equal(response.headers.get('Content-Security-Policy-Report-Only'), WEB2_CSP, `${url} ${status}`);
      assert.equal(response.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
      // 1단계는 막지 않는다.
      assert.equal(response.headers.get('Content-Security-Policy'), null);
    }
  }
});

test('Worker: 다른 화면·파일·공유 페이지·오류 응답에는 붙이지 않는다', async () => {
  for (const [url, upstream] of [
    ['https://bokdoong.com/work/app/my-work.html', page()],
    ['https://bokdoong.com/work/app/onedrive-return.html', page()],
    ['https://bokdoong.com/work/app/hwp-lab/rhwp-0.8.7/studio/index.html', page()],
    ['https://bokdoong.com/work/app/app.js', new Response('js', {headers: {'Content-Type': 'text/javascript'}})],
    ['https://bokdoong.com/work/app/login/missing/', page(404)],
    ['https://work.bokdoong.com/work/share/', page()],
    ['https://work.bokdoong.com/work/', page()]
  ]) {
    const response = await request(url, upstream);
    assert.equal(response.headers.get('Content-Security-Policy-Report-Only'), null, url);
  }
  assert.equal(web2CspPage('/work/app/login'), false);
  assert.equal(web2CspPage('/work/app/login/'), true);
});

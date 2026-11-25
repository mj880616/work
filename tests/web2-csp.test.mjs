// SEC-Web2CSP 1단계(보고만 하기): Web2 첫 화면·로그인 화면의 보고 전용 CSP와 referrer 정책.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import router from '../cloudflare/bokdoong-router.mjs';
import {WEB2_CSP, WEB2_REFERRER_POLICY, WEB2_REPORTING_ENDPOINTS, CSP_REPORT_URL, CSP_REPORT_GROUP, THEME_BOOTSTRAP_HASH, web2Csp, web2CspPage} from '../cloudflare/web2-csp.mjs';

const PAGES = ['app/index.html', 'app/login/index.html', 'app/oauth-consent/index.html'];
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

// SEC-Web2CSP I-5 보고 받는 곳: 보고 전용 정책에 report-to(새 방식)·report-uri(옛 방식)가 붙고, 둘 다 Edge csp-report 하나를 가리킨다.
test('정책: report-to·report-uri가 Edge csp-report를 가리키고, 여전히 보고 전용(막는 정책에는 없음)', () => {
  assert.equal(CSP_REPORT_URL, 'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/csp-report');
  assert.deepEqual(directive('report-to'), [CSP_REPORT_GROUP]);
  assert.deepEqual(directive('report-uri'), [CSP_REPORT_URL]);
  assert.equal(WEB2_REPORTING_ENDPOINTS, `${CSP_REPORT_GROUP}="${CSP_REPORT_URL}"`);
  assert.match(CSP_REPORT_GROUP, /^[a-z0-9-]+$/);
  // 보고 주소만 바꾼 정책은 나머지 지시어가 같다(E2E는 시험 서버 주소로 바꿔 쓴다).
  const other = web2Csp('http://127.0.0.1:1/__csp-report');
  assert.equal(other.replace('http://127.0.0.1:1/__csp-report', CSP_REPORT_URL), WEB2_CSP);
  assert.equal(WEB2_CSP.split('; ').filter(p => p.startsWith('report-')).length, 2);
  assert.ok(WEB2_CSP.endsWith(`report-to ${CSP_REPORT_GROUP}`));
});

async function request(url, upstream) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => upstream;
  try { return await router.fetch(new Request(url)); } finally { globalThis.fetch = original; }
}
const page = (status = 200) => new Response(status === 304 ? null : '<!doctype html>', {status, headers: status === 304 ? {} : {'Content-Type': 'text/html; charset=utf-8'}});

test('Worker: workonplus.com의 Web2 첫 화면·로그인 화면에만 보고 전용 CSP와 Referrer-Policy를 붙인다', async () => {
  for (const url of ['https://workonplus.com/work/app/', 'https://workonplus.com/work/app/index.html', 'https://workonplus.com/work/app/login/', 'https://workonplus.com/work/app/login/index.html', 'https://workonplus.com/work/app/?view=calendar']) {
    for (const status of [200, 304]) {
      const response = await request(url, page(status));
      assert.equal(response.headers.get('Content-Security-Policy-Report-Only'), WEB2_CSP, `${url} ${status}`);
      assert.equal(response.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
      assert.equal(response.headers.get('Reporting-Endpoints'), WEB2_REPORTING_ENDPOINTS, `${url} ${status}`);
      // 1단계 정책 전체는 막지 않는다. 막는 CSP는 SEC-보안헤더의 frame-ancestors 하나뿐이다.
      assert.equal(response.headers.get('Content-Security-Policy'), "frame-ancestors 'self'");
    }
  }
});

test('Worker: 다른 화면·파일·공유 페이지·오류 응답에는 붙이지 않는다', async () => {
  for (const [url, upstream] of [
    ['https://workonplus.com/work/app/my-work.html', page()],
    ['https://workonplus.com/work/app/onedrive-return.html', page()],
    ['https://workonplus.com/work/app/hwp-lab/rhwp-0.8.7/studio/index.html', page()],
    ['https://workonplus.com/work/app/app.js', new Response('js', {headers: {'Content-Type': 'text/javascript'}})],
    ['https://workonplus.com/work/app/login/missing/', page(404)],
    ['https://work.bokdoong.com/work/share/', page()],
    ['https://work.bokdoong.com/work/', page()]
  ]) {
    const response = await request(url, upstream);
    assert.equal(response.headers.get('Content-Security-Policy-Report-Only'), null, url);
    assert.equal(response.headers.get('Reporting-Endpoints'), null, url);
  }
  assert.equal(web2CspPage('/work/app/login'), false);
  assert.equal(web2CspPage('/work/app/login/'), true);
});

// SEC-보안헤더: Web2 모든 응답에 끼워 넣기 금지(frame-ancestors·X-Frame-Options)와 형식 추측 금지(nosniff).
test('Worker: workonplus.com의 Web2 응답 전부에 frame-ancestors·X-Frame-Options·nosniff를 붙인다', async () => {
  for (const [url, upstream] of [
    ['https://workonplus.com/work/app/', page()],
    ['https://workonplus.com/work/app/?view=calendar', page(304)],
    ['https://workonplus.com/work/app/login/', page()],
    ['https://workonplus.com/work/app/my-work.html', page()],
    ['https://workonplus.com/work/app/hwp-lab/rhwp-0.8.7/studio/index.html', page()],
    ['https://workonplus.com/work/app/app.js', new Response('js', {headers: {'Content-Type': 'text/javascript'}})],
    ['https://workonplus.com/work/app/login/missing/', page(404)]
  ]) {
    const response = await request(url, upstream);
    assert.equal(response.headers.get('Content-Security-Policy'), "frame-ancestors 'self'", url);
    assert.equal(response.headers.get('X-Frame-Options'), 'SAMEORIGIN', url);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff', url);
  }
  // 첫 화면은 막는 헤더(frame-ancestors)와 보고 전용 CSP가 함께 붙는다.
  const home = await request('https://workonplus.com/work/app/', page());
  assert.equal(home.headers.get('Content-Security-Policy-Report-Only'), WEB2_CSP);
});

test('Worker: Web2 밖(공유 페이지·Web1)에는 이번 헤더를 붙이지 않는다', async () => {
  for (const url of ['https://work.bokdoong.com/work/share/', 'https://work.bokdoong.com/work/']) {
    const response = await request(url, page());
    assert.equal(response.headers.get('X-Frame-Options'), null, url);
    assert.equal(response.headers.get('Content-Security-Policy'), null, url);
  }
});

test('Worker: 저장해 둔 판(edge cache)을 돌려줄 때도 같은 헤더를 붙인다', async () => {
  const stored = new Response('js', {headers: {'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=31536000, immutable'}});
  const original = globalThis.caches;
  globalThis.caches = {default: {match: async () => stored.clone(), put: async () => {}}};
  try {
    const response = await request('https://workonplus.com/work/app/app.js?v=abc', new Response('never'));
    assert.equal(await response.text(), 'js');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(response.headers.get('X-Frame-Options'), 'SAMEORIGIN');
  } finally { globalThis.caches = original; }
});

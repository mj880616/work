// SEC-github.io넘기기: Web2를 github.io에서 열면 bokdoong.com 같은 경로·?뒤·#뒤로 넘기고, 뒤따르는 스크립트가 돌지 않게 한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../app/origin-redirect.js', import.meta.url), 'utf8');
const PAGES = ['app/index.html', 'app/login/index.html', 'app/native-callback.html', 'app/onedrive-return.html', 'app/my-work.html'];
const BROWSER_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36';

function run(href, ua = BROWSER_UA) {
  const calls = {replace: [], write: []};
  const window = {};
  const ctx = {
    window, URL, String,
    location: {href, replace: (u) => calls.replace.push(u)},
    navigator: {userAgent: ua},
    document: {write: (s) => calls.write.push(s)},
  };
  vm.runInNewContext(SRC, ctx);
  return {calls, api: window.KPTUOriginRedirect};
}

test('github.io의 Web2 주소는 bokdoong.com 같은 경로·?뒤·#뒤로 넘기고 남은 문서를 막는다', () => {
  const {calls} = run('https://mj880616.github.io/work/app/?view=home&x=1#section');
  assert.deepEqual(calls.replace, ['https://bokdoong.com/work/app/?view=home&x=1#section']);
  assert.deepEqual(calls.write, ['<plaintext hidden>'], '뒤따르는 스크립트가 실행되지 않게');
  for (const [from, to] of [
    ['https://mj880616.github.io/work/app/login/?return=https%3A%2F%2Fmj880616.github.io%2Fwork%2Fapp%2F', 'https://bokdoong.com/work/app/login/?return=https%3A%2F%2Fmj880616.github.io%2Fwork%2Fapp%2F'],
    ['https://mj880616.github.io/work/app/native-callback.html?native=android', 'https://bokdoong.com/work/app/native-callback.html?native=android'],
    ['https://mj880616.github.io/work/app/onedrive-return.html', 'https://bokdoong.com/work/app/onedrive-return.html'],
  ]) assert.deepEqual(run(from).calls.replace, [to], from);
});

test('넘기지 않는 경우: bokdoong.com·다른 호스트·Web2 밖 경로·설치 앱', () => {
  for (const href of [
    'https://bokdoong.com/work/app/?view=home',
    'https://desk.bokdoong.com/work/app/',
    'https://mj880616.github.io/work/p/',
    'https://mj880616.github.io/work/',
    'http://mj880616.github.io/work/app/',
    'http://localhost:8080/work/app/',
  ]) {
    const {calls} = run(href);
    assert.deepEqual(calls, {replace: [], write: []}, href);
  }
  for (const ua of [`${BROWSER_UA} KPTUWindows/0.1.0`, `${BROWSER_UA} KPTUAndroid/0.3.1`]) {
    assert.deepEqual(run('https://mj880616.github.io/work/app/', ua).calls, {replace: [], write: []}, ua);
  }
  const {api} = run('https://bokdoong.com/work/app/');
  assert.equal(api.target('not a url', BROWSER_UA), null);
});

test('모든 Web2 HTML이 다른 스크립트·미리 불러오기보다 먼저 넘김 스크립트를 동기로 부른다', () => {
  for (const page of PAGES) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    const rel = page === 'app/login/index.html' ? '../origin-redirect.js' : './origin-redirect.js';
    const tag = `<script src="${rel}"></script>`;
    const at = html.indexOf(tag);
    assert.ok(at > 0, `${page}: 넘김 스크립트`);
    assert.ok(at < html.indexOf('</head>'), `${page}: head 안`);
    const before = html.slice(0, at);
    assert.ok(!/<script\s+src=/.test(before) && !/<script\s+type="module"/.test(before) && !/modulepreload/.test(before), `${page}: 앞에 다른 외부 스크립트 없음`);
    assert.ok(before.includes('<meta charset="utf-8">'), `${page}: 글자 설정 뒤`);
  }
});

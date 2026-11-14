import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pickPhoneApp, apkUrl, APK_MAX_BYTES} from '../scripts/phone-app-latest.mjs';
import {downloadPlan, apkFromInfo, loadPhoneAppInfo, RELEASES_PAGE, INSTALL_HINT, OTHER_HINT} from '../app/app-download.mjs';

// APP-앱내려받기버튼: 최신 폰 앱 APK 고르기(배포 때)와 화면이 보이는 것(로그인 화면·계정 메뉴)을 한 곳에서 시험한다.
const rel = (tag, assets = [], extra = {}) => ({tag_name: tag, draft: false, prerelease: false, assets, ...extra});
const apk = (version, size = 9_000_000) => ({name: `web2-phone-${version}.apk`, size, browser_download_url: 'https://example.invalid/evil.apk'});

test('폰 앱 고르기: phone-app-v*의 web2-phone-<같은 판>.apk 중 판 번호가 가장 큰 것, 바구니 PC 릴리스와 섞이지 않는다', () => {
  const list = [
    rel('basket-pc-v9.9.9', [{name: 'basket-pc-9.9.9.zip', size: 10}]),
    rel('phone-app-v0.5.8', [apk('0.5.8')]),
    rel('phone-app-v0.5.10', [apk('0.5.10')]),
    rel('phone-app-v0.5.9', [apk('0.5.9')]),
    rel('phone-app-v0.6.0', [apk('0.6.0')], {draft: true}),
    rel('phone-app-v0.7.0', [apk('0.7.0')], {prerelease: true}),
    rel('phone-app-v0.8.0', [apk('0.7.9')]),
    rel('phone-app-v0.9.0', [apk('0.9.0', 0)]),
    rel('phone-app-v1.0.0', [apk('1.0.0', APK_MAX_BYTES + 1)]),
    rel('phone-app-v0.05.11', [apk('0.05.11')]),
    rel('phone-app-v0.5.11-beta', [apk('0.5.11-beta')])
  ];
  const got = pickPhoneApp(list);
  assert.deepEqual(got, {version: '0.5.10', url: apkUrl('0.5.10'), size: 9_000_000}, '0.5.10 > 0.5.9 > 0.5.8(숫자 비교), 초안·미리보기·다른 이름·크기 0·64MB 초과·이상한 태그 제외');
  assert.equal(got.url, 'https://github.com/mj880616/work/releases/download/phone-app-v0.5.10/web2-phone-0.5.10.apk', '주소는 받은 값이 아니라 저장소·태그·파일 이름으로 만든다');
  for (const bad of [null, {}, 'x', [], [rel('basket-pc-v0.5.1', [{name: 'web2-phone-0.5.1.apk', size: 5}])]]) assert.equal(pickPhoneApp(bad), null);
});

test('화면 계획: 폰 앱 안은 없음, 안드로이드 브라우저는 최신 APK 버튼 + 설치 안내, PC·아이폰은 안내 한 줄', () => {
  const info = {version: '0.5.10', url: apkUrl('0.5.10'), size: 1};
  assert.deepEqual(downloadPlan({ua: 'Mozilla/5.0 (Linux; Android 14) Chrome/130 KPTUAndroid/0.5.10', info}), {kind: 'app'});
  assert.deepEqual(downloadPlan({ua: 'Mozilla/5.0 (Linux; Android 14; SM-F956N) SamsungBrowser/27.0 Chrome/125 Mobile', info}),
    {kind: 'android', url: info.url, version: '0.5.10', hint: INSTALL_HINT});
  assert.deepEqual(downloadPlan({ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', info}), {kind: 'other', hint: OTHER_HINT});
  assert.deepEqual(downloadPlan({ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari', info}), {kind: 'other', hint: OTHER_HINT});
  // 파일이 없거나 값이 이상하면 폰 앱 릴리스 목록 주소(맨 위가 최신).
  const android = 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile';
  assert.equal(downloadPlan({ua: android}).url, RELEASES_PAGE);
  for (const bad of [{version: '0.5.10', url: 'https://evil.example/web2-phone-0.5.10.apk'}, {version: '0.5', url: apkUrl('0.5')}, {version: 5}, null])
    assert.equal(apkFromInfo(bad), null, JSON.stringify(bad));
  assert.match(INSTALL_HINT, /알 수 없는 앱 설치 허용/);
});

test('phone-app.json 읽기: 같은 주소 한 파일, 쿠키 없이, 못 읽으면 null', async () => {
  const seen = [];
  const ok = await loadPhoneAppInfo(async (url, init) => { seen.push([url, init]); return {ok: true, json: async () => ({version: '0.5.10'})}; }, 'https://nojoplus.com/work/app/app-download.mjs?v=abc');
  assert.deepEqual(ok, {version: '0.5.10'});
  assert.equal(seen[0][0], 'https://nojoplus.com/work/app/phone-app.json');
  assert.equal(seen[0][1].credentials, 'omit');
  assert.equal(await loadPhoneAppInfo(async () => ({ok: false}), 'https://a.test/app/x.mjs'), null);
  assert.equal(await loadPhoneAppInfo(async () => { throw new Error('off'); }, 'https://a.test/app/x.mjs'), null);
});

test('로그인 화면: 버튼 자리는 처음에 숨김, 받는 길은 같은 모듈 하나(GitHub API를 화면이 부르지 않음)', () => {
  const html = readFileSync(new URL('../app/login/index.html', import.meta.url), 'utf8');
  assert.match(html, /<div class="login-app" data-login-app hidden>/);
  assert.match(html, /<script type="module" src="\.\/app-download\.js"><\/script>/);
  for (const file of ['../app/login/app-download.js', '../app/app-download.mjs', '../app/topbar-actions.js'])
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), 'utf8'), /api\.github\.com/, file);
});

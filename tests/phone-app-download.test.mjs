import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pickPhoneApp, apkUrl, APK_MAX_BYTES, pickPcApp, setupUrl, SETUP_MAX_BYTES} from '../scripts/phone-app-latest.mjs';
import {downloadPlan, apkFromInfo, loadPhoneAppInfo, RELEASES_PAGE, INSTALL_HINT, OTHER_HINT, pcPlan, setupFromInfo, loadPcAppInfo, PC_RELEASES_PAGE, PC_SETUP_NAME, PC_DESC, PC_WARN, PC_OTHER_HINT, PC_BROWSER_LINE, PC_BUTTON, PC_HELPER_NAME} from '../app/app-download.mjs';
import {installPlan, runInstall, canPrompt, INSTALL_BUTTON, INSTALL_FALLBACK} from '../app/pwa-install.mjs';

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

// BASKET-노조플러스업로드: 윈도우 PC 프로그램 '노조+ 업로드' 설치 파일 고르기(배포 때)와 화면 계획.
test('PC 프로그램 고르기: basket-pc-v*의 BasketDropApp-win-Setup.exe 중 판 번호가 가장 큰 것, 폰 앱 릴리스와 섞이지 않는다', () => {
  const setup = (size = 90_000_000) => ({name: PC_SETUP_NAME, size, browser_download_url: 'https://example.invalid/evil.exe'});
  const list = [
    rel('phone-app-v9.9.9', [apk('9.9.9'), {name: PC_SETUP_NAME, size: 5}]),
    rel('basket-pc-v0.5.2', [setup()]),
    rel('basket-pc-v0.5.10', [setup()]),
    rel('basket-pc-v0.6.0', [setup()], {draft: true}),
    rel('basket-pc-v0.7.0', [setup()], {prerelease: true}),
    rel('basket-pc-v0.8.0', [{name: 'BasketDropApp-0.8.0-full.nupkg', size: 9}]),
    rel('basket-pc-v0.9.0', [setup(0)]),
    rel('basket-pc-v1.0.0', [setup(SETUP_MAX_BYTES + 1)]),
    rel('basket-pc-v0.05.11', [setup()]),
    rel('basket-pc-v0.5.11-beta', [setup()])
  ];
  const got = pickPcApp(list);
  assert.deepEqual(got, {version: '0.5.10', url: setupUrl('0.5.10'), size: 90_000_000});
  assert.equal(got.url, 'https://github.com/mj880616/work/releases/download/basket-pc-v0.5.10/BasketDropApp-win-Setup.exe', '주소는 저장소·태그·파일 이름으로 만든다');
  for (const bad of [null, {}, 'x', [], [rel('phone-app-v0.5.1', [setup()])]]) assert.equal(pickPcApp(bad), null);
  assert.equal(pickPhoneApp(list).version, '9.9.9', '폰 앱 고르기는 PC 릴리스를 보지 않는다');
});

test('PC 화면 계획: 윈도우 PC 브라우저만 최신 설치 파일 + 설명·경고, 폰 앱 안은 없음, 그 밖은 안내 한 줄', () => {
  const info = {version: '0.5.10', url: setupUrl('0.5.10'), size: 1};
  const win = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130';
  assert.deepEqual(pcPlan({ua: win, info}), {kind: 'pc', url: info.url, version: '0.5.10', browser: PC_BROWSER_LINE, hint: PC_DESC, warn: PC_WARN});
  assert.deepEqual(pcPlan({ua: win}), {kind: 'pc', url: PC_RELEASES_PAGE, version: '', browser: PC_BROWSER_LINE, hint: PC_DESC, warn: PC_WARN});
  assert.deepEqual(pcPlan({ua: 'Mozilla/5.0 (Linux; Android 14) Chrome/130 KPTUAndroid/0.5.10', info}), {kind: 'app'});
  for (const ua of ['Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari'])
    assert.deepEqual(pcPlan({ua, info}), {kind: 'other', hint: PC_OTHER_HINT}, ua);
  for (const bad of [{version: '0.5.10', url: 'https://evil.example/BasketDropApp-win-Setup.exe'}, {version: '0.5.10', url: apkUrl('0.5.10')}, {version: '0.5'}, null])
    assert.equal(setupFromInfo(bad), null, JSON.stringify(bad));
  assert.match(PC_WARN, /추가 정보 → 실행/);
  assert.match(PC_DESC, /\[파일\]에서 이 PC/);
});

// S63-09 PC도우미구분(사용자 11/16): PC 프로그램은 WORK ON+ 자체가 아닌 도우미 — 이름·버튼·안내 글이 그것을 드러내고, WORK ON+는 브라우저(앱 설치)에서 쓴다고 먼저 말한다.
test('PC 도우미 이름·안내: 보조 프로그램임이 드러나고 WORK ON+는 브라우저에서 쓴다는 한 줄', () => {
  assert.equal(PC_HELPER_NAME, 'WORK ON+ 파일 올리기');
  assert.equal(PC_BUTTON, 'PC 파일 올리기 도우미 내려받기');
  assert.equal(PC_BROWSER_LINE, "WORK ON+는 크롬·엣지 같은 인터넷 브라우저에서 씁니다. PC에서는 브라우저로 열거나 크롬 '앱 설치'로 바탕화면에 두세요.");
  assert.match(PC_DESC, /WORK ON\+ 자체가 아니에요/);
  assert.match(PC_OTHER_HINT, /도우미/);
  for (const file of ['../app/login/index.html', '../app/login/app-download.js', '../app/topbar-actions.js', '../app/app-download.mjs', '../app/pc-files-model.mjs', '../app/files.js'])
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), 'utf8'), /윈도우 PC 프로그램 내려받기|노조\+ 업로드 프로그램/, file);
});

test('PC 앱 설치 단추: PC 브라우저에서만, 폰·폰 앱·설치한 창 안에서는 없음, 설치 창이 없으면 안내 한 줄', async () => {
  const pc = {kind: 'pc', label: INSTALL_BUTTON, fallback: INSTALL_FALLBACK};
  for (const ua of ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Chrome/130', 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130'])
    assert.deepEqual(installPlan({ua}), pc, ua);
  assert.deepEqual(installPlan({ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', standalone: true}), {kind: 'none'}, '이미 설치한 창 안');
  for (const ua of ['Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile', 'Mozilla/5.0 (Linux; Android 14) Chrome/130 KPTUAndroid/0.5.10', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari', 'Mozilla/5.0 (Linux; Android 14; SM-X710) Chrome/130'])
    assert.deepEqual(installPlan({ua}), {kind: 'none'}, ua);
  assert.equal(INSTALL_BUTTON, 'PC에 앱 설치');
  assert.match(INSTALL_FALLBACK, /주소창 오른쪽의 설치 아이콘/);
  assert.equal(canPrompt(), false);
  assert.equal(await runInstall(), 'fallback', '붙잡은 설치 창이 없으면 안내');
});

test('로그인 화면: 앱 화면과 같은 manifest(PC 앱 설치), 브라우저 안내·설치 단추 자리는 처음에 숨김', () => {
  const html = readFileSync(new URL('../app/login/index.html', import.meta.url), 'utf8');
  assert.match(html, /<link rel="manifest" href="\.\.\/windows-manifest\.json">/);
  assert.match(html, /<div class="login-app" data-login-pwa hidden>/);
  assert.ok(html.indexOf('data-login-pwa') < html.indexOf('data-login-pc '), '브라우저 안내가 도우미 위');
});

test('pc-app.json 읽기: 같은 주소 한 파일, 쿠키 없이, 못 읽으면 null', async () => {
  const seen = [];
  assert.deepEqual(await loadPcAppInfo(async (url, init) => { seen.push([url, init]); return {ok: true, json: async () => ({version: '0.5.10'})}; }, 'https://nojoplus.com/work/app/app-download.mjs?v=abc'), {version: '0.5.10'});
  assert.equal(seen[0][0], 'https://nojoplus.com/work/app/pc-app.json');
  assert.equal(seen[0][1].credentials, 'omit');
  assert.equal(await loadPcAppInfo(async () => ({ok: false}), 'https://a.test/app/x.mjs'), null);
  assert.equal(await loadPcAppInfo(async () => { throw new Error('off'); }, 'https://a.test/app/x.mjs'), null);
});

test('배포: 같은 단계가 pc-app.json을 빌드 결과 폴더에 쓰고, 실패해도 배포를 막지 않는다', () => {
  const wf = readFileSync(new URL('../.github/workflows/pages-deploy.yml', import.meta.url), 'utf8');
  assert.match(wf, /phone-app-latest\.mjs "\$RUNNER_TEMP\/releases\.json" "\$RUNNER_TEMP\/pages-out\/app\/phone-app\.json" "\$RUNNER_TEMP\/pages-out\/app\/pc-app\.json" \|\| echo/);
  assert.doesNotMatch(wf, /_site\/app\/pc-app\.json/);
  const html = readFileSync(new URL('../app/login/index.html', import.meta.url), 'utf8');
  assert.match(html, /<div class="login-app" data-login-pc hidden>/);
});

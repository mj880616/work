// S62-34 APP-플레이스토어비공개테스트: 폰 앱 두 판(github·play)의 정적 확인.
// - build.gradle: github 판은 kr.or.kptu.work 그대로, play 판은 com.workonplus.app. namespace(코드 패키지)는 그대로.
// - play 판 매니페스트: 스스로 업데이트·설치 요청·'모든 파일 접근' 권한을 뺀다. github 판(main 매니페스트)은 그대로.
// - 웹 로그인 복귀: native=android → kr.or.kptu.work, native=android-play → com.workonplus.app(주소에서 패키지를 받지 않음).
// - play-bundle.yml: main에서 손으로만, 공개 릴리스·태그 없음, artifact 7일, 새 비밀값 없음.
// 빌드된 APK의 병합 매니페스트는 build-android-app.yml의 check-flavor-manifests.py가 따로 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const gradle = read('android-app/app/build.gradle');
const mainManifest = read('android-app/app/src/main/AndroidManifest.xml');
const playManifest = read('android-app/app/src/play/AndroidManifest.xml');
const bundle = read('.github/workflows/play-bundle.yml');
const release = read('.github/workflows/phone-app-release.yml');

const flavorBlock = name => {
  const start = gradle.indexOf(`        ${name} {`);
  assert.ok(start > 0, `${name} flavor`);
  return gradle.slice(start, gradle.indexOf('\n        }', start));
};

test('github 판은 지금 앱 ID 그대로, play 판은 com.workonplus.app, namespace는 그대로', () => {
  assert.match(gradle, /namespace 'kr\.or\.kptu\.work'/);
  assert.match(gradle, /flavorDimensions\.add\('channel'\)/);
  const github = flavorBlock('github');
  const play = flavorBlock('play');
  assert.match(github, /applicationId = 'kr\.or\.kptu\.work'/);
  assert.match(play, /applicationId = 'com\.workonplus\.app'/);
  assert.match(github, /'SELF_UPDATE', 'true'/);
  assert.match(play, /'SELF_UPDATE', 'false'/);
  assert.match(play, /'ALL_FILES', 'false'/);
  assert.match(play, /'LOGIN_RETURN', '"android-play"'/);
  assert.match(github, /'UA_MARK', '""'/);
  // versionCode·versionName은 한 곳(defaultConfig)에서 두 판이 같이 쓴다.
  assert.equal((gradle.match(/versionCode \d+/g) || []).length, 1);
  assert.equal((gradle.match(/versionName '/g) || []).length, 1);
});

test('play 판 매니페스트는 세 권한만 빼고, github 판(main)은 그대로 둔다', () => {
  const removed = [...playManifest.matchAll(/<uses-permission android:name="([^"]+)" tools:node="remove" \/>/g)].map(m => m[1]).sort();
  assert.deepEqual(removed, [
    'android.permission.MANAGE_EXTERNAL_STORAGE',
    'android.permission.REQUEST_INSTALL_PACKAGES',
    'android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION',
  ]);
  for (const p of removed) assert.match(mainManifest, new RegExp(`android:name="${p.replaceAll('.', '\\.')}"`));
  // 판마다 앱 ID를 따르는 FileProvider 이름(두 판을 한 폰에 깔아도 부딪히지 않음).
  assert.match(mainManifest, /android:authorities="\$\{applicationId\}\.shareout"/);
  assert.doesNotMatch(mainManifest, /android:authorities="kr\.or\.kptu\.work/);
  // 플레이 제한 권한은 어느 판에도 없다.
  for (const bad of ['READ_CALL_LOG', 'READ_SMS', 'SEND_SMS', 'ACCESS_BACKGROUND_LOCATION', 'QUERY_ALL_PACKAGES', 'BIND_ACCESSIBILITY_SERVICE']) {
    assert.doesNotMatch(mainManifest, new RegExp(`permission\\.${bad}"`));
  }
});

function runBridge(native) {
  const bridge = read('app/native-auth-bridge.js');
  const location = new URL(`https://desk.bokdoong.com/work/app/native-callback.html?native=${native}#access_token=synthetic-access&refresh_token=synthetic-refresh`);
  const link = { style: {}, removeAttribute(name) { delete this[name]; } };
  const status = { textContent: '' };
  const ctx = vm.createContext({
    location, URL, URLSearchParams, Object,
    history: { replaceState: (_, __, path) => { location.href = new URL(path, location).href; } },
    document: { documentElement: { innerHTML: '' }, querySelector: q => (q === '#backToApp' ? link : q === '#handoffStatus' ? status : null) },
    fetch: async () => ({ ok: true, json: async () => ({ token: 'opaque-sealed-handoff' }) }),
    setTimeout: () => {}, window: {}, console,
  });
  vm.runInContext(bridge, ctx);
  return { link, ctx };
}

test('로그인 복귀: android는 지금 앱, android-play는 플레이 판, 다른 값은 앱을 열지 않는다', async () => {
  const a = runBridge('android');
  const p = runBridge('android-play');
  const x = runBridge('com.evil.app');
  await new Promise(resolve => setImmediate(resolve));
  assert.match(a.link.href, /;package=kr\.or\.kptu\.work;end$/);
  assert.match(p.link.href, /;package=com\.workonplus\.app;end$/);
  assert.match(p.link.href, /^intent:\/\/auth\?handoff=opaque-sealed-handoff#Intent;scheme=kptuwork;/);
  assert.equal(x.link.href, undefined);
  assert.notEqual(x.ctx.window.__KPTU_NATIVE_BRIDGE__, true);
});

test('로그인 시작: 플레이 판 사용자 에이전트(WorkOnPlay)는 android-play로 돌아온다', () => {
  const src = read('app/login/native-google-return.js');
  const run = ua => {
    const auth = { APP_ROOT: 'https://desk.bokdoong.com/work/app/', googleUrl: () => 'https://example.supabase.co/auth/v1/authorize?provider=google' };
    vm.runInContext(src, vm.createContext({ window: { KPTUAuth: auth }, navigator: { userAgent: ua }, URL }));
    return new URL(auth.googleUrl()).searchParams.get('redirect_to');
  };
  assert.match(run('Mozilla/5.0 (Linux; Android 15; wv) KPTUAndroid/0.5.11 WorkOnPlay'), /native-callback\.html\?native=android-play$/);
  assert.match(run('Mozilla/5.0 (Linux; Android 15; wv) KPTUAndroid/0.5.11'), /native-callback\.html\?native=android$/);
});

test('S69-10: 플레이 판은 새 앱 com.workonplus.app — 옛 초안 앱 ID는 코드·workflow·시험 어디에도 남지 않는다', () => {
  const old = ['com', 'nojoplus', 'app'].join('.');
  const files = [
    'android-app/app/build.gradle', 'android-app/app/src/main/AndroidManifest.xml', 'android-app/app/src/play/AndroidManifest.xml',
    'android-app/scripts/check-flavor-manifests.py', 'app/native-auth-bridge.js', 'app/login/native-google-return.js',
    '.github/workflows/play-bundle.yml', '.github/workflows/build-android-app.yml',
    'android-app/app/src/test/java/kr/or/kptu/work/FlavorTest.kt', 'android-app/app/src/test/java/kr/or/kptu/work/WidgetAuthTest.kt',
  ];
  for (const f of files) assert.ok(!read(f).includes(old), `${f}에 옛 앱 ID`);
  // 앱 이름은 두 판 모두 main 매니페스트 하나(WORK ON+). play 판이 이름을 덮어쓰지 않는다.
  assert.match(mainManifest, /android:label="WORK ON\+"/);
  assert.doesNotMatch(playManifest, /android:label=/);
  assert.match(flavorBlock('play'), /'UA_MARK', '" WorkOnPlay"'/);
  assert.match(bundle, /workonplus-play-\$VERSION\.aab/);
});

test('play-bundle.yml: main 손 실행만, 공개 릴리스·태그 없음, artifact 7일, 비밀값은 기존 넷만', () => {
  assert.match(bundle, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(bundle, /^\s+(push|pull_request|schedule):/m);
  assert.match(bundle, /refs\/heads\/main/);
  assert.match(bundle, /environment: phone-app-release/);
  assert.match(bundle, /:app:bundlePlayRelease/);
  assert.match(bundle, /retention-days: 7/);
  assert.doesNotMatch(bundle, /gh release|git\/refs|contents: write/);
  const secrets = [...new Set([...bundle.matchAll(/secrets\.([A-Z0-9_]+)/g)].map(m => m[1]))].sort();
  assert.deepEqual(secrets, ['PHONE_APP_KEYSTORE_B64', 'PHONE_APP_KEYSTORE_PASSWORD', 'PHONE_APP_KEY_ALIAS', 'PHONE_APP_KEY_PASSWORD']);
  // 비밀번호는 환경 변수 이름으로만(:env), 값을 echo하지 않는다.
  assert.match(bundle, /-storepass:env PHONE_APP_KEYSTORE_PASSWORD -keypass:env PHONE_APP_KEY_PASSWORD/);
  assert.doesNotMatch(bundle, /echo[^\n]*\$\{?PHONE_APP_(KEYSTORE|KEY)_PASSWORD/);
  assert.doesNotMatch(bundle, /echo[^\n]*\$\{?PHONE_APP_KEYSTORE_B64/);
});

test('phone-app-release.yml은 github 판만 만들고 APK 이름·태그 모양은 그대로', () => {
  assert.match(release, /:app:assembleGithubRelease/);
  assert.match(release, /:app:testGithubReleaseUnitTest/);
  assert.match(release, /apk\/github\/release\/app-github-release-unsigned\.apk/);
  assert.match(release, /out\/web2-phone-\$VERSION\.apk/);
  assert.match(release, /TITLE="웹2 폰 앱 \$VERSION"/);
  assert.doesNotMatch(release, /[Pp]lay(Release|Debug)/);
});

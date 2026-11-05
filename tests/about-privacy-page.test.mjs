// S50-6 MULTI D4: 구글 앱 브랜딩·인증에 넣을 공개 개인정보 처리방침(about/privacy/)이
// 실제 코드가 요청하는 Google 권한과 맞는지, 로그인 화면 링크·페이지 안 링크가 깨지지 않았는지 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, existsSync, statSync} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const PRIVACY_URL = 'https://work.bokdoong.com/work/about/privacy/';
const page = read('about/privacy/index.html');

function walk(dir) {
  return readdirSync(join(root, dir)).flatMap(name => {
    const rel = join(dir, name);
    return statSync(join(root, rel)).isDirectory() ? walk(rel) : [rel];
  });
}

// 사용자 동의로 받는 Google 권한만 모은다. FCM은 서버 서비스 계정 권한이라 사용자 데이터가 아니다.
function requestedUserScopes() {
  const found = new Set();
  for (const file of walk('supabase/functions').filter(f => /\.(ts|mjs|js)$/.test(f) && !f.includes('_shared/fcm-send'))) {
    for (const m of read(file).matchAll(/https:\/\/www\.googleapis\.com\/auth\/[a-z.]+/g)) found.add(m[0]);
  }
  return [...found].sort();
}

test('코드가 요청하는 Google 사용자 권한이 모두 처리방침 표에 있다', () => {
  const scopes = requestedUserScopes();
  assert.ok(scopes.length >= 4, `권한을 찾지 못함: ${scopes}`);
  const table = page.slice(page.indexOf('<table>'), page.indexOf('</table>'));
  for (const scope of scopes) assert.ok(table.includes(`<code>${scope}</code>`), `처리방침 표에 없음: ${scope}`);
  const listed = [...table.matchAll(/<code>(https:\/\/www\.googleapis\.com\/auth\/[a-z.]+)<\/code>/g)].map(m => m[1]).sort();
  assert.deepEqual(listed, scopes, '코드가 요청하지 않는 권한이 표에 있음');
});

test('처리방침 필수 문장: Limited Use, 시행일, 삭제 방법, 검색 허용', () => {
  assert.match(page, /including the Limited Use requirements/);
  assert.match(page, /https:\/\/developers\.google\.com\/terms\/api-services-user-data-policy/);
  assert.match(page, /시행일: \d{4}년 \d{1,2}월 \d{1,2}일/);
  assert.match(page, /myaccount\.google\.com\/connections/);
  assert.match(page, /저장하지 않는 정보/);
  assert.doesNotMatch(page, /<meta name="robots" content="[^"]*noindex/);
  assert.match(page, new RegExp(`<link rel="canonical" href="${PRIVACY_URL}">`));
});

test('로그인 화면 아래에 공개 처리방침 링크가 있다', () => {
  const login = read('app/login/index.html');
  assert.ok(login.includes(`href="${PRIVACY_URL}"`), '로그인 화면에 처리방침 링크 없음');
});

// 2026-11-05 명진 결정(MULTI D4): Google 앱 인증용 공개 연락처 메일 한 주소만 싣는다.
// 어떤 주소를 허용하는지는 scripts/personal-data-allowlist.json(about/ email hash 1건)이 정하고 check-personal-data가 검사한다.
test('공개 소개 페이지들의 상대 링크가 저장소 안 파일로 이어지고, 메일은 공개 연락처 한 주소를 mailto 링크로만 싣는다', () => {
  const mails = new Set();
  for (const file of walk('about').filter(f => f.endsWith('.html'))) {
    const html = read(file);
    for (const [m] of html.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
      mails.add(m.toLowerCase());
      assert.ok(html.includes(`href="mailto:${m}"`), `${file}: 메일은 mailto 링크로만`);
    }
    for (const [, href] of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
      if (/^(https?:|mailto:)/.test(href)) continue;
      let target = join(root, dirname(file), href);
      if (href.endsWith('/')) target = join(target, 'index.html');
      assert.ok(existsSync(target), `${file}: 깨진 링크 ${href}`);
    }
  }
  assert.ok(mails.size <= 1, `공개 연락처 메일은 한 주소만: ${mails.size}개`);
});

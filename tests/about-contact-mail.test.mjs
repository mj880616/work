// S62-26 ABOUT-문의메일안내문고침(사용자 11/15): 공개 소개·처리방침·약관의 문의 메일은 서비스 문의 메일 한 주소뿐이고,
// 공개 저장소의 어떤 추적 파일에도 개인 메일이 다시 들어오지 못하게 막는다(값 원문 대신 hash로 비교).
// 처리방침·소개에는 사용자가 확정한 '운영자가 보는 정보' 문장이 그대로 있어야 한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadAllowlist, scanText, trackedFiles, valueHash} from '../scripts/check-personal-data.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const CONTACT = 'nojoplus.com@gmail.com';
const CONTACT_HASH = valueHash('email', CONTACT);
const ABOUT_PAGES = ['about/index.html', 'about/privacy/index.html', 'about/terms/index.html'];

function walk(dir) {
  return readdirSync(join(root, dir)).flatMap(name => {
    const rel = join(dir, name);
    return statSync(join(root, rel)).isDirectory() ? walk(rel) : [rel];
  });
}

test('소개·처리방침·약관의 문의 메일은 모두 서비스 문의 메일이다', () => {
  for (const file of ABOUT_PAGES) {
    const html = read(file);
    assert.ok(html.includes(`href="mailto:${CONTACT}">${CONTACT}</a>`), `${file}: 문의 메일 없음`);
  }
  for (const file of walk('about').filter(f => f.endsWith('.html'))) {
    const mails = [...read(file).matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map(m => m[0].toLowerCase());
    for (const m of mails) assert.equal(m, CONTACT, `${file}: 문의 메일 외 메일 주소`);
  }
});

test('개인 메일 예외는 외부 라이브러리 LICENSE와 서비스 문의 메일뿐이다', () => {
  const emailEntries = loadAllowlist().filter(e => e.kinds.includes('email'));
  for (const e of emailEntries) {
    if (e.hashes) assert.deepEqual(e.hashes, [CONTACT_HASH], `메일 예외 hash는 문의 메일 하나만: ${e.paths}`);
    else assert.deepEqual(e.paths, ['app/editor-lib/'], `경로 전체 메일 허용은 외부 라이브러리만: ${e.paths}`);
  }
});

test('저장소 추적 파일에 문의 메일·외부 라이브러리 저작자 외 개인 메일이 없다', () => {
  const bad = [];
  for (const file of trackedFiles(root)) {
    if (file.startsWith('app/editor-lib/')) continue;
    let text;
    try { text = read(file); } catch { continue; }
    if (text.includes('\0')) continue;
    for (const f of scanText(text)) {
      if (f.kind === 'email' && f.hash !== CONTACT_HASH) bad.push(`${file}:${f.line} ${f.hash}`);
    }
  }
  assert.deepEqual(bad, [], `개인 메일 모양 주소(원문 대신 hash): ${bad.join(', ')}`);
});

// S68-58(사용자 11/23 15:53): 운영자에게 가는 정보는 이메일주소·가입일·마지막 사용 시각 셋뿐(서버 함수도 같이 줄임).
test('처리방침·소개에 사용자 확정 문장: 내 기록은 운영자가 볼 수 없고, 운영자에게는 이메일·가입일·마지막 사용 시각만', () => {
  for (const file of ['about/index.html', 'about/privacy/index.html']) {
    const html = read(file);
    assert.ok(html.includes('내가 기록한 내용은 운영자가 볼 수 없습니다.'), `${file}: 확정 문장 없음`);
    assert.ok(html.includes('<b>운영자에게 제공되는 정보</b>: 이메일주소, 가입일, 마지막 사용 시각</li>'), `${file}: 제공되는 정보 없음`);
    assert.doesNotMatch(html, /운영자는 누가 가입했는지만|제공되는 정보<\/b>: 조직/, `${file}: 옛 문장`);
    assert.ok(html.includes('<b>제공되지 않는 정보</b>: 유저가 기록·업로드 한 정보'), `${file}: 제공되지 않는 정보 없음`);
  }
  const privacy = read('about/privacy/index.html');
  assert.match(privacy, /AI 처리 업체\(OpenAI\) API로 보내 결과를 받습니다/, 'AI 처리 문장은 지우지 않는다');
  assert.doesNotMatch(privacy, /이메일 주소와 작업공간의 기록은 보지 않습니다/, '확정 문장과 어긋나는 옛 가입자 목록 문장');
});

// S62-31 ABOUT-현재맞춤(사용자 11/16): 소개·처리방침·약관이 지금 운영 상태와 맞아야 한다.
// 누구나 가입(막은 계정 제외)·광고 없음·베타 기간 모두 무료·나중에 기능 제한이나 소정의 비용 가능성 안내(11/16 08:42 사용자: 유료화 최종 결정 전, 금액 쓰지 않음). 인원 숫자·'비영리'·'운영자가 준비한 사람만' 같은 옛 문장은 다시 들어오지 않는다.
test('소개 페이지들은 지금 가입·요금 상태와 맞는 문장만 쓴다', () => {
  for (const file of ABOUT_PAGES) {
    const html = read(file);
    assert.doesNotMatch(html, /10명|비영리|준비한 사람만|새로 가입할 수 없/, `${file}: 지금과 맞지 않는 옛 문장`);
    assert.doesNotMatch(html, /\d[\d,]*\s*원/, `${file}: 유료화 결정 전이라 금액을 쓰지 않는다`);
  }
  const about = read('about/index.html');
  assert.match(about, /누구나 가입할 수 있습니다\(운영자가 막은 계정 제외\)/);
  assert.match(about, /베타 테스트 기간이라 모든 기능을 무료로/);
  assert.match(about, /소정의 비용이 생길 수 있으며, 바뀌기 전에 미리 알립니다/);
});

// S62-39 PRODUCT-운영자열람안함약속(사용자 11/16): 약관·처리방침에 운영자 열람 안 함·영장 통지 약속이 있어야 한다.
test('약관·처리방침에 운영자 열람 안 함과 영장 즉시 통지 약속이 있다', () => {
  const terms = read('about/terms/index.html');
  assert.ok(terms.includes('운영자는 사용자가 기록한 내용을 열어 보지 않습니다.'), '약관: 열람 안 함 약속 없음');
  assert.ok(terms.includes('법관이 발부한 영장이 있을 때만 응하고, 영장에 적힌 범위만 제공합니다.'), '약관: 영장 범위 약속 없음');
  assert.ok(terms.includes('압수·수색 과정에 참여할 권리를 쓸 수 있게 합니다.'), '약관: 참여권 통지 약속 없음');
  assert.ok(terms.includes('영장이 오면 제공해야 할 수 있습니다.'), '약관: 정직한 한계 문장 없음');
  const privacy = read('about/privacy/index.html');
  assert.ok(privacy.includes('법관이 발부한 영장이 있을 때만'), '처리방침: 영장 약속 없음');
  assert.ok(privacy.includes('내가 기록한 내용은 운영자가 볼 수 없습니다.'), '처리방침: 확정 문장 없음');
  assert.ok(privacy.includes('보낸 사람(이메일주소)'), '처리방침: 의견 보낸 사람은 이메일주소');
});

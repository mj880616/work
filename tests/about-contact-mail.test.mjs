// S62-26 ABOUT-문의메일안내문고침(명진 11/15): 공개 소개·처리방침·약관의 문의 메일은 서비스 문의 메일 한 주소뿐이고,
// 공개 저장소의 어떤 추적 파일에도 개인 메일이 다시 들어오지 못하게 막는다(값 원문 대신 hash로 비교).
// 처리방침·소개에는 명진이 확정한 '운영자가 보는 정보' 문장이 그대로 있어야 한다.
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

test('처리방침·소개에 명진 확정 문장: 운영자는 가입만 보고 기록은 보지 않는다', () => {
  for (const file of ['about/index.html', 'about/privacy/index.html']) {
    const html = read(file);
    assert.ok(html.includes('운영자는 누가 가입했는지만 보고, 기록한 내용은 보지 않습니다.'), `${file}: 확정 문장 없음`);
    assert.ok(html.includes('<b>운영자에게 제공되는 정보</b>: 조직, 부서, 이름, 직책, 이메일주소, 가입일, 마지막 사용 시각'), `${file}: 제공되는 정보 없음`);
    assert.ok(html.includes('<b>제공되지 않는 정보</b>: 유저가 기록·업로드 한 정보'), `${file}: 제공되지 않는 정보 없음`);
  }
  const privacy = read('about/privacy/index.html');
  assert.match(privacy, /AI 처리 업체\(OpenAI\) API로 보내 결과를 받습니다/, 'AI 처리 문장은 지우지 않는다');
  assert.doesNotMatch(privacy, /이메일 주소와 작업공간의 기록은 보지 않습니다/, '확정 문장과 어긋나는 옛 가입자 목록 문장');
});

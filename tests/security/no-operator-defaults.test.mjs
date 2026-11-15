import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
// SEC-자주가는링크기본값유출(11/15 ★급★): 새 가입자에게 운영자(한 사람)의 업무용 내부 시스템·단체 홈페이지 주소가 기본값으로 보이면 안 된다.
// ① 자주 가는 링크 코드 기본값은 비어 있다(새 계정 = 빈 목록, 기본 분류 '업무' 하나).
// ② 화면 코드(app/)·공유 페이지(share/)·안내(about/)에 막힌 주소가 다시 들어오지 않는다. 공개 저장소라 막을 주소는 원문 대신
//    호스트 이름의 sha256(앞 16자)으로만 둔다 — 'www.' 등 하위 이름을 붙여도 뒤쪽 이름 단위로 잘라 모두 비교한다.
const BLOCKED = new Set([
  '980d39a52a7cadb5', '185adcc2eb19db9b', 'ffac2a4046006746', 'be14109d2c6d680b',
  '28f7d56e59047179', '9322cc9c09775323', 'c4933f242eb979dd',
]);
const hash = host => createHash('sha256').update(host).digest('hex').slice(0, 16);
// 호스트 이름의 뒤쪽 단위들: a.b.example.kr → a.b.example.kr, b.example.kr, example.kr
const suffixes = host => host.split('.').map((_, i, parts) => parts.slice(i).join('.')).filter(s => s.includes('.'));

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { if (!/^(node_modules|vendor|release-notes)$/.test(name) && !/-\d+\.\d+\.\d+$/.test(name)) yield* files(path); }
    else if (/\.(m?js|html|css|json|webmanifest)$/.test(name)) yield path;
  }
}

test('자주 가는 링크: 코드 기본 링크 0개, 기본 분류는 업무 하나', async () => {
  const {DEFAULT_LINKS, DEFAULT_GROUPS, parseLinks, parseGroups} = await import('../../app/quick-links.js');
  assert.equal(DEFAULT_LINKS.length, 0);
  assert.deepEqual(DEFAULT_GROUPS.map(g => ({...g})), [{id: 'work', name: '업무'}]);
  assert.deepEqual(parseLinks(null), []);
  assert.deepEqual(parseGroups(null), [{id: 'work', name: '업무'}]);
});

test('화면 코드에 막힌 주소(운영자 업무용 내부 시스템·단체 홈페이지)가 없다', () => {
  const found = [];
  for (const root of ['app', 'share', 'about']) for (const path of files(root)) {
    const text = readFileSync(path, 'utf8');
    for (const m of text.matchAll(/\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?=[:/'"`\s)]|$)/gi)) {
      for (const s of suffixes(m[1].toLowerCase())) if (BLOCKED.has(hash(s))) found.push(`${path}: ${hash(s)}`);
    }
  }
  assert.deepEqual(found, []);
});

test('검사 도구가 헛돌지 않는다: 하위 이름까지 잘라 비교하고 해시는 16자', () => {
  assert.deepEqual(suffixes('www.a.example.kr'), ['www.a.example.kr', 'a.example.kr', 'example.kr']);
  assert.equal(BLOCKED.size, 7);
  for (const value of BLOCKED) assert.match(value, /^[0-9a-f]{16}$/);
  // 옛 기본값을 되살린 글(해시만 같은지 보는 가짜 줄)이 걸리는지: 목록 첫 해시와 같은 이름을 만들 수 없으니 함수 모양만 본다.
  assert.equal(hash('example.org'), createHash('sha256').update('example.org').digest('hex').slice(0, 16));
});

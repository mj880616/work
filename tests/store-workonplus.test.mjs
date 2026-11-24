// S69-11 STORE-플레이등록자료: 플레이 스토어 'WORK ON+' 등록 자료(docs/store/workonplus/)가 콘솔 규격에 맞는지 본다.
// 글자 수(앱 이름 30·짧은 설명 80·자세한 설명 4000), 그림 크기·종류(PNG 머리만 읽음), 계정 삭제 안내 페이지 연결과 주소.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import router from '../cloudflare/bokdoong-router.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const DIR = 'docs/store/workonplus';
const listing = read(`${DIR}/listing-ko.md`);
const block = heading => {
  const at = listing.indexOf(`## ${heading}\n`);
  assert.ok(at >= 0, `절 없음: ${heading}`);
  const m = listing.slice(at).match(/```\n([\s\S]*?)\n```/);
  assert.ok(m, `글 칸 없음: ${heading}`);
  return m[1];
};
// PNG 머리(IHDR): 가로·세로·비트 깊이·색 종류(6 = RGBA, 2 = RGB).
const png = f => {
  const b = readFileSync(join(root, f));
  assert.equal(b.toString('hex', 0, 8), '89504e470d0a1a0a', `${f}: PNG 아님`);
  return {w: b.readUInt32BE(16), h: b.readUInt32BE(20), depth: b[24], color: b[25]};
};

test('스토어 글 길이: 앱 이름 30자·짧은 설명 80자·자세한 설명 4000자 안', () => {
  const name = block('앱 이름'), short = block('짧은 설명'), long = block('자세한 설명');
  assert.equal(name, 'WORK ON+');
  assert.ok([...short].length <= 80, `짧은 설명 ${[...short].length}자`);
  assert.ok([...long].length <= 4000, `자세한 설명 ${[...long].length}자`);
  // 플레이 메타데이터 정책: 꾸밈말·순위·가격 홍보 금지. 운영자 전용 기능 이름도 넣지 않는다.
  for (const word of ['최고', '1위', '최초', '무료', 'No.1', '#1', '텔레그램', '통화', '브리핑', 'News', '노조', '노동조합'])
    assert.ok(!(short + long).includes(word), `쓰지 않는 말: ${word}`);
});

test('그림 규격: 아이콘 512 RGBA, 그래픽 1024×500, 폰 스크린샷 4~8장 9:16', () => {
  assert.deepEqual(png(`${DIR}/graphics/icon-512.png`), {w: 512, h: 512, depth: 8, color: 6});
  const feature = png(`${DIR}/graphics/feature-graphic-1024x500.png`);
  assert.deepEqual([feature.w, feature.h], [1024, 500]);
  assert.notEqual(feature.color, 6, '그래픽 이미지는 투명 없이');
  const shots = readdirSync(join(root, DIR, 'screenshots')).filter(f => f.endsWith('.png')).sort();
  assert.ok(shots.length >= 4 && shots.length <= 8, `스크린샷 ${shots.length}장`);
  for (const f of shots) {
    const {w, h} = png(`${DIR}/screenshots/${f}`);
    assert.ok(Math.min(w, h) >= 320 && Math.max(w, h) <= 3840, `${f}: ${w}×${h}`);
    assert.equal(w * 16, h * 9, `${f}: 9:16 아님`);
    assert.ok(listing.includes(f), `스토어 글 표에 없음: ${f}`);
  }
});

test('계정 삭제 안내: 처리방침·답안에서 이어지고, 요청 방법·지워지는 것·남는 것·기간이 있다', () => {
  const page = read('about/delete-account/index.html');
  for (const h of ['요청하는 방법', '지워지는 것', '남는 것', '걸리는 기간']) assert.match(page, new RegExp(`<h2>\\d\\. ${h}</h2>`));
  assert.doesNotMatch(page, /<meta name="robots" content="[^"]*noindex/);
  assert.match(read('about/privacy/index.html'), /href="\.\.\/delete-account\/"/);
  assert.ok(read(`${DIR}/console-answers.md`).includes('https://workonplus.com/work/about/delete-account/'));
  assert.ok(listing.includes('https://workonplus.com/work/about/delete-account/'));
});

test('workonplus.com에서 삭제 안내·처리방침 주소가 Pages의 about/로 열린다', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const path of ['/work/about/delete-account/', '/work/about/privacy/']) {
      const calls = [];
      globalThis.fetch = async input => { calls.push(input); return new Response('ok'); };
      const response = await router.fetch(new Request(`https://workonplus.com${path}`));
      assert.equal(response.status, 200, path);
      assert.equal(calls[0].url, `https://mj880616.github.io${path}`, path);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

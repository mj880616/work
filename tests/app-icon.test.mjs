import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

// 노동조합+ 아이콘(J10: 올리브 둥근 네모 + 흰 '노조' + 노랑 각진 '+'): PNG 크기·바탕색·maskable 안전 영역·SVG·같은 그림을 쓰는 자리를 확인한다.
const icon = name => readFileSync(new URL(`../app/${name}`, import.meta.url));
const OLIVE = [0x4D, 0x5A, 0x2E], WHITE = [0xFF, 0xFE, 0xFA], YELLOW = [0xE7, 0xC2, 0x5A];
const repo = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

function decode(buf) {
  assert.equal(buf.subarray(1, 4).toString(), 'PNG');
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), depth = buf[24], type = buf[25], interlace = buf[28];
  assert.equal(depth, 8); assert.ok(type === 2 || type === 6, 'RGB 또는 RGBA'); assert.equal(interlace, 0);
  const bpp = type === 6 ? 4 : 3;
  const chunks = [];
  for (let p = 8; p < buf.length;) {
    const len = buf.readUInt32BE(p), name = buf.subarray(p + 4, p + 8).toString();
    if (name === 'IDAT') chunks.push(buf.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = w * bpp, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[y * stride + i - bpp] : 0, b = y ? out[(y - 1) * stride + i] : 0, c = i >= bpp && y ? out[(y - 1) * stride + i - bpp] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      out[y * stride + i] = (row[i] + pred) & 255;
    }
  }
  return { w, h, alpha: type === 6, px: (x, y) => [...out.subarray(y * stride + x * bpp, y * stride + x * bpp + bpp)] };
}
const near = (p, c, tol = 6) => c.every((v, i) => Math.abs(p[i] - v) <= tol);

test('PNG 크기와 종류: 16·32·48·180·192·512·maskable 192·512', () => {
  for (const [name, size] of [['16', 16], ['32', 32], ['48', 48], ['180', 180], ['192', 192], ['512', 512], ['maskable-192', 192], ['maskable-512', 512]]) {
    const img = decode(icon(`icons/app-icon-${name}.png`));
    assert.deepEqual([img.w, img.h], [size, size], name);
  }
});
test('둥근 모양은 모서리가 비어 있고, 180과 maskable은 모서리까지 올리브로 꽉 찬다', () => {
  for (const s of [16, 32, 48, 192, 512]) {
    const img = decode(icon(`icons/app-icon-${s}.png`));
    assert.equal(img.px(0, 0)[3], 0, `${s} 모서리 투명`);
    assert.ok(near(img.px(Math.floor(s * 0.08), Math.floor(s * 0.5)).slice(0, 3), OLIVE) || s <= 16, `${s} 가장자리 안쪽 올리브`);
  }
  for (const n of ['180', 'maskable-192', 'maskable-512']) {
    const img = decode(icon(`icons/app-icon-${n}.png`));
    for (const [x, y] of [[0, 0], [img.w - 1, 0], [0, img.h - 1], [img.w - 1, img.h - 1]]) assert.ok(near(img.px(x, y), OLIVE, 1), `${n} 모서리 올리브`);
  }
});
test('maskable: 흰 글자·노랑 + 가 전부 가운데 80% 원(반지름 0.4) 안에 있다', () => {
  for (const n of ['192', '512']) {
    const img = decode(icon(`icons/app-icon-maskable-${n}.png`)), c = (img.w - 1) / 2, limit = img.w * 0.4;
    let white = 0, yellow = 0;
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      const p = img.px(x, y), ink = near(p, WHITE, 40) ? 'w' : near(p, YELLOW, 40) ? 'y' : '';
      if (!ink) continue;
      if (ink === 'w') white++; else yellow++;
      assert.ok(Math.hypot(x - c, y - c) <= limit + 1, `${n} (${x},${y}) 안전 영역 밖`);
    }
    assert.ok(white > img.w * 2 && yellow > img.w, '글자(흰색)와 +(노랑)가 그려져 있다');
  }
});
test('J10 자리: 큰 아이콘은 + 가운데(49,32)가 노랑, 노 받침 획(15,38.6)이 흰색, 탭 크기에서도 노랑은 오른쪽', () => {
  const big = decode(icon('icons/app-icon-512.png')), k = 512 / 64;
  assert.ok(near(big.px(Math.round(49 * k), Math.round(32 * k)).slice(0, 3), YELLOW), '+ 가운데 노랑');
  assert.ok(near(big.px(Math.round(53 * k), Math.round(32 * k)).slice(0, 3), YELLOW), '+ 가로 획 노랑');
  assert.ok(near(big.px(Math.round(15 * k), Math.round(38.6 * k)).slice(0, 3), WHITE), '노 아래 획 흰색');
  assert.ok(near(big.px(Math.round(32 * k), Math.round(12 * k)).slice(0, 3), OLIVE), '글자 위는 바탕');
  for (const s of [16, 32]) {
    const img = decode(icon(`icons/app-icon-${s}.png`));
    let y = 0, w = 0;
    for (let py = 0; py < s; py++) for (let px = 0; px < s; px++) {
      const p = img.px(px, py).slice(0, 3);
      if (near(p, YELLOW, 50)) { y++; assert.ok(px >= s * 0.6, `${s} 노랑은 오른쪽`); }
      if (near(p, WHITE, 60)) w++;
    }
    assert.ok(y >= 1 && w >= 2, `${s} 글자와 + 가 보임`);
  }
});
test('SVG: 고정 색 3개, 글자는 선(path)이라 글꼴과 상관없고, 32px 이하에서 굵은 글자로 바뀌며 외부 자원이 없다', () => {
  const svg = icon('app-icon.svg').toString('utf8');
  for (const c of ['#4D5A2E', '#FFFEFA', '#E7C25A']) assert.ok(svg.includes(c), c);
  assert.ok(svg.includes('aria-label="노동조합+"'));
  assert.ok(!/웹2|<text|font-family/.test(svg), '옛 이름·글꼴 글자 없음');
  assert.ok(svg.includes('d="M49 26V38M43 32H55" fill="none" stroke="#E7C25A" stroke-width="2.4" stroke-linecap="butt"'), '+ 는 시안 J10 수치 그대로');
  assert.ok(svg.includes('@media (max-width:32px){.full{display:none}'));
  assert.equal((svg.match(/class="full"/g) || []).length, 1); assert.equal((svg.match(/class="tab"/g) || []).length, 1);
  assert.ok(!/prefers-color-scheme|currentColor|<image|href=|data:/.test(svg), '색은 화면 테마를 따르지 않고 외부 자원 없음');
});
test('같은 그림: 공유 페이지 파비콘·바구니 PC·안드로이드 적응형 아이콘', () => {
  const svg = icon('app-icon.svg').toString('utf8');
  assert.equal(repo('favicon.svg'), svg, '저장소 맨 위 favicon.svg(공유 페이지)는 앱 아이콘과 같다');
  const glyph = svg.match(/class="full" d="([^"]+)"/)[1];
  const basket = repo('basket-pc/icon/basket-icon.svg');
  assert.ok(basket.includes(glyph) && basket.includes('#4D5A2E') && basket.includes('M49 26V38M43 32H55'), '바구니 PC도 같은 글자·+');
  const adaptive = repo('android-app/app/src/main/res/drawable-anydpi/app_icon.xml');
  assert.ok(adaptive.includes('<adaptive-icon') && adaptive.includes('@color/app_icon_bg') && adaptive.includes('<monochrome>'));
  assert.ok(adaptive.includes(glyph), '안드로이드도 같은 글자 윤곽');
  assert.match(repo('android-app/app/src/main/res/values/colors.xml'), /<color name="app_icon_bg">#4D5A2E<\/color>/);
  assert.match(repo('android-app/app/src/main/AndroidManifest.xml'), /android:icon="@drawable\/app_icon"/);
});
test('manifest 이름은 노동조합+이고 아이콘 주소에 새 판 번호가 붙는다', () => {
  const m = JSON.parse(icon('windows-manifest.json').toString('utf8'));
  assert.equal(m.name, '노동조합+'); assert.equal(m.short_name, '노동조합+');
  for (const i of m.icons) assert.ok(i.src.includes('?v=20261115-nojoplus'), i.src);
});

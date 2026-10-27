import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

// Web2 앱 아이콘(메모 줄 + 체크): PNG 크기·바탕색·maskable 안전 영역·SVG 색·manifest 이름을 확인한다.
const icon = name => readFileSync(new URL(`../app/${name}`, import.meta.url));
const PAPER = [0xF2, 0xEF, 0xE6], NAVY = [0x3B, 0x4A, 0x6B], GREEN = [0x2F, 0x9E, 0x7A];

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
test('둥근 모양은 모서리가 비어 있고, 180과 maskable은 모서리까지 종이색으로 꽉 찬다', () => {
  for (const s of [16, 32, 48, 192, 512]) {
    const img = decode(icon(`icons/app-icon-${s}.png`));
    assert.equal(img.px(0, 0)[3], 0, `${s} 모서리 투명`);
    assert.ok(near(img.px(Math.floor(s * 0.08), Math.floor(s * 0.5)).slice(0, 3), PAPER) || s <= 16, `${s} 가장자리 안쪽 종이색`);
  }
  for (const n of ['180', 'maskable-192', 'maskable-512']) {
    const img = decode(icon(`icons/app-icon-${n}.png`));
    for (const [x, y] of [[0, 0], [img.w - 1, 0], [0, img.h - 1], [img.w - 1, img.h - 1]]) assert.ok(near(img.px(x, y), PAPER, 1), `${n} 모서리 종이색`);
  }
});
test('maskable: 남색·초록 그림이 전부 가운데 80% 원(반지름 0.4) 안에 있다', () => {
  for (const n of ['192', '512']) {
    const img = decode(icon(`icons/app-icon-maskable-${n}.png`)), c = (img.w - 1) / 2, limit = img.w * 0.4;
    let green = 0, navy = 0;
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      const p = img.px(x, y), ink = near(p, GREEN, 40) ? 'g' : near(p, NAVY, 40) ? 'n' : '';
      if (!ink) continue;
      if (ink === 'g') green++; else navy++;
      assert.ok(Math.hypot(x - c, y - c) <= limit + 1, `${n} (${x},${y}) 안전 영역 밖`);
    }
    assert.ok(green > img.w * 2 && navy > img.w * 2, '체크(초록)와 줄(남색)이 그려져 있다');
  }
});
test('큰 아이콘에는 줄 3개(남색)와 체크(초록)가 모두 있고, 탭 크기에는 초록이 오른쪽 아래에 있다', () => {
  const big = decode(icon('icons/app-icon-512.png'));
  const rowsWithNavy = new Set();
  for (let y = 0; y < 512; y++) if (near(big.px(100, y).slice(0, 3), NAVY)) rowsWithNavy.add(Math.floor(y / 64));
  assert.ok(rowsWithNavy.size >= 3, '왼쪽 세로 단면에서 남색 줄 3개');
  assert.ok(near(big.px(Math.round(512 * 42 / 64), Math.round(512 * 53 / 64)).slice(0, 3), GREEN), '체크 꺾이는 점이 초록');
  for (const s of [16, 32]) {
    const img = decode(icon(`icons/app-icon-${s}.png`));
    let g = 0;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) if (near(img.px(x, y).slice(0, 3), GREEN, 40)) { g++; assert.ok(x >= s / 3 && y >= s / 3, `${s} 초록은 오른쪽 아래`); }
    assert.ok(g >= s / 2, `${s} 초록 체크가 보임`);
  }
});
test('SVG: 고정 색 3개, 32px 이하에서 작은 모양으로 바뀌고 외부 자원이 없다', () => {
  const svg = icon('app-icon.svg').toString('utf8');
  for (const c of ['#F2EFE6', '#3B4A6B', '#2F9E7A']) assert.ok(svg.includes(c), c);
  assert.ok(svg.includes('@media (max-width:32px){.full{display:none}'));
  assert.equal((svg.match(/class="full"/g) || []).length, 1); assert.equal((svg.match(/class="tab"/g) || []).length, 1);
  assert.ok(!/prefers-color-scheme|currentColor|<image|href=|data:/.test(svg), '색은 화면 테마를 따르지 않고 외부 자원 없음');
});
test('manifest 이름은 웹2이고 아이콘 주소에 새 판 번호가 붙는다', () => {
  const m = JSON.parse(icon('windows-manifest.json').toString('utf8'));
  assert.equal(m.name, '웹2'); assert.equal(m.short_name, '웹2');
  for (const i of m.icons) assert.ok(i.src.includes('?v=20261027-memocheck'), i.src);
});

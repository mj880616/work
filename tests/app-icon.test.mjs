import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

// WORK ON 아이콘(2026-11-20 명진 확정 표장 A 'W를 품은 원': 어두운 둥근 네모 + 밝은 원 + 원 안 W 선, S67-49):
// PNG 크기·바탕색·maskable 안전 영역·SVG·같은 그림을 쓰는 자리를 확인한다. 그림은 scripts/app-icon/build-app-icons.py가 만든다.
const icon = name => readFileSync(new URL(`../app/${name}`, import.meta.url));
const DARK = [0x22, 0x26, 0x2B], LIGHT = [0xF3, 0xF1, 0xEA];
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
test('둥근 모양은 모서리가 비어 있고, 180과 maskable은 모서리까지 어두운 바탕으로 꽉 찬다', () => {
  for (const s of [16, 32, 48, 192, 512]) {
    const img = decode(icon(`icons/app-icon-${s}.png`));
    assert.equal(img.px(0, 0)[3], 0, `${s} 모서리 투명`);
    assert.ok(near(img.px(Math.floor(s * 0.08), Math.floor(s * 0.5)).slice(0, 3), DARK) || s <= 16, `${s} 가장자리 안쪽 어두운 바탕`);
  }
  for (const n of ['180', 'maskable-192', 'maskable-512']) {
    const img = decode(icon(`icons/app-icon-${n}.png`));
    for (const [x, y] of [[0, 0], [img.w - 1, 0], [0, img.h - 1], [img.w - 1, img.h - 1]]) assert.ok(near(img.px(x, y), DARK, 1), `${n} 모서리 어두운 바탕`);
  }
});
test('maskable: 밝은 원이 전부 가운데 80% 원(반지름 0.4) 안에 있다', () => {
  for (const n of ['192', '512']) {
    const img = decode(icon(`icons/app-icon-maskable-${n}.png`)), c = (img.w - 1) / 2, limit = img.w * 0.4;
    let light = 0;
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      if (!near(img.px(x, y), LIGHT, 40)) continue;
      light++;
      assert.ok(Math.hypot(x - c, y - c) <= limit + 1, `${n} (${x},${y}) 안전 영역 밖`);
    }
    assert.ok(light > img.w * img.w * 0.2, '밝은 원이 그려져 있다');
  }
});
test('표장 A 자리: 원 안은 밝고, W 선(꼭짓점·가운데 봉우리)은 어둡고, 원 밖은 바탕. 탭 크기에서도 원과 W가 보인다', () => {
  const big = decode(icon('icons/app-icon-512.png')), k = 512 / 64, at = (x, y) => big.px(Math.round(x * k), Math.round(y * k)).slice(0, 3);
  assert.ok(near(at(32, 16), LIGHT), '원 위쪽 안은 밝음');
  assert.ok(near(at(32, 48), LIGHT), '원 아래쪽 안은 밝음');
  for (const [x, y] of [[19, 25], [25, 40], [32, 28], [39, 40], [45, 25], [22, 32.5]]) assert.ok(near(at(x, y), DARK), `W 선 (${x},${y}) 어두움`);
  assert.ok(near(at(32, 6), DARK) && near(at(6, 32), DARK), '원 밖은 바탕');
  for (const s of [16, 32]) {
    const img = decode(icon(`icons/app-icon-${s}.png`));
    let light = 0, dark = 0;
    for (let py = 0; py < s; py++) for (let px = 0; px < s; px++) {
      const p = img.px(px, py);
      if (p[3] < 200) continue;
      if (near(p.slice(0, 3), LIGHT, 60)) light++;
      if (near(p.slice(0, 3), DARK, 40)) dark++;
    }
    assert.ok(light >= s * s * 0.25 && dark >= s, `${s} 원과 W가 보임`);
  }
});
test('SVG: 고정 색 2개, 글자 없이 원·W 선만, 32px 이하에서 굵은 판으로 바뀌며 외부 자원이 없다', () => {
  const svg = icon('app-icon.svg').toString('utf8');
  for (const c of ['#22262B', '#F3F1EA']) assert.ok(svg.includes(c), c);
  assert.ok(svg.includes('aria-label="WORK ON"'));
  assert.ok(!/노동조합|노조|웹2|<text|font-family/.test(svg), '옛 이름·글꼴 글자 없음');
  assert.ok(svg.includes('<rect width="64" height="64" rx="14" fill="#22262B"/>'), '바탕은 시안 그대로');
  assert.ok(svg.includes('<circle cx="32" cy="32" r="22" fill="#F3F1EA"/><path d="M19 25l6 15 7-12 7 12 6-15" fill="none" stroke="#22262B" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'), '원·W는 시안 수치 그대로');
  assert.ok(svg.includes('@media (max-width:32px){.full{display:none}'));
  assert.equal((svg.match(/class="full"/g) || []).length, 1); assert.equal((svg.match(/class="tab"/g) || []).length, 1);
  assert.ok(!/prefers-color-scheme|currentColor|<image|href=|data:/.test(svg), '색은 화면 테마를 따르지 않고 외부 자원 없음');
  const light = readFileSync(new URL('../app/brand/mark-light.svg', import.meta.url), 'utf8');
  assert.ok(light.includes('<rect width="64" height="64" rx="14" fill="#F3F1EA"/>') && light.includes('r="22" fill="#22262B"') && light.includes('stroke="#F3F1EA" stroke-width="5"'), '밝은 판: 바탕 #F3F1EA, 원 #22262B, W #F3F1EA');
});
test('같은 그림: 공유 페이지 파비콘·공개 소개 로고·안드로이드 적응형 아이콘·알림 작은 그림', () => {
  const svg = icon('app-icon.svg').toString('utf8');
  assert.equal(repo('favicon.svg'), svg, '저장소 맨 위 favicon.svg(공유 페이지)는 앱 아이콘과 같다');
  const logo = decode(readFileSync(new URL('../about/nojoplus-logo-120.png', import.meta.url)));
  assert.deepEqual([logo.w, logo.h], [120, 120]);
  assert.ok(near(logo.px(60, 30).slice(0, 3), LIGHT) && near(logo.px(60, 4).slice(0, 3), DARK), '공개 페이지 로고도 표장 A');
  const adaptive = repo('android-app/app/src/main/res/drawable-anydpi/app_icon.xml');
  assert.ok(adaptive.includes('<adaptive-icon') && adaptive.includes('@color/app_icon_bg') && adaptive.includes('<monochrome>'));
  assert.ok(adaptive.includes('android:pathData="M19 25l6 15 7-12 7 12 6-15"') && adaptive.includes('android:fillColor="#F3F1EA"'), '안드로이드 앞 그림: 밝은 원 + W 선');
  assert.ok(adaptive.includes('android:fillType="evenOdd"'), '테마 아이콘(한 색)은 원에서 W를 비움');
  assert.match(repo('android-app/app/src/main/res/values/colors.xml'), /<color name="app_icon_bg">#22262B<\/color>/);
  assert.match(repo('android-app/app/src/main/AndroidManifest.xml'), /android:icon="@drawable\/app_icon"/);
  const push = repo('android-app/app/src/main/res/drawable/ic_push.xml');
  assert.ok(push.includes('android:fillType="evenOdd"') && push.includes('#FFFFFFFF') && !/fillColor="#(?!FFFFFFFF)/.test(push), '알림 작은 그림: 흰 한 색 원 + W 비움');
  assert.ok(existsSync(new URL('../scripts/app-icon/nojoplus-j10.svg', import.meta.url)), '옛 노동조합+ 아이콘(J10)은 나중 노조+ 앱을 위해 남김');
});
test('manifest 이름은 WORK ON이고 아이콘 주소에 새 판 번호가 붙는다', () => {
  const m = JSON.parse(icon('windows-manifest.json').toString('utf8'));
  assert.equal(m.name, 'WORK ON'); assert.equal(m.short_name, 'WORK ON');
  for (const i of m.icons) assert.ok(i.src.includes('?v=20261120-workon'), i.src);
});

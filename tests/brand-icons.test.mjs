import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// PHOTO-실제아이콘(2026-11-03 00:28): 원드라이브·구글 드라이브는 공식 제품 아이콘을 원래 모양·색으로, 저장소 안 한 파일(brand-icons.js)에서만.
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const {brandIconSvg, BRAND_KINDS} = await import('../app/brand-icons.js');

test('공식 아이콘: 원래 색 그대로, 외부 주소·그림 파일 없음, 크기 비율 유지', () => {
  assert.deepEqual(BRAND_KINDS, ['onedrive', 'gdrive']);
  const od = brandIconSvg('onedrive', {size:20}), gd = brandIconSvg('gdrive', {size:16, cls:'x'});
  for (const c of ['#0364b8', '#0078d4', '#1490df', '#28a8ea']) assert.ok(od.includes(`fill="${c}"`), c);
  for (const c of ['#0066da', '#00ac47', '#ea4335', '#00832d', '#2684fc', '#ffba00']) assert.ok(gd.includes(`fill="${c}"`), c);
  for (const svg of [od, gd]) {
    assert.match(svg, /^<svg class="brand-ic [^"]*" viewBox="[\d. ]+" width="[\d.]+" height="[\d.]+" aria-hidden="true" focusable="false">/);
    assert.doesNotMatch(svg, /href|url\(|<image|currentColor|opacity|transform/i);
  }
  assert.match(od, /width="20" height="12.8"/);
  assert.match(gd, /class="brand-ic brand-ic-gdrive x" viewBox="0 0 87.3 78" width="16" height="14.3"/);
  assert.equal(brandIconSvg('dropbox'), '');
});

test('웹2 안 원드라이브·구글 드라이브 아이콘 자리는 모두 이 부품: 직접 그린 옛 모양이 남지 않음', () => {
  const photos = read('app/photos.js'), od = read('app/od-link.js');
  assert.match(od, /import \{brandIconSvg\} from '\.\/brand-icons\.js';/);
  assert.match(od, /export const OD_CLOUD_SVG = brandIconSvg\('onedrive', \{size:20, cls:'od-link-cloud'\}\);/);
  assert.match(photos, /import \{brandIconSvg\} from '\.\/brand-icons\.js';/);
  assert.match(photos, /const GDRIVE_SVG = brandIconSvg\('gdrive', \{size:16, cls:'photos-src-ic'\}\);/);
  assert.match(photos, /const MARK_SVG = \{onedrive:brandIconSvg\('onedrive', \{size:11\}\),/);
  assert.match(photos, /gdrive:brandIconSvg\('gdrive', \{size:10\}\)\};/);
  // 옛 단색 구름·삼각 모양 path가 남지 않음.
  assert.doesNotMatch(photos + od, /M9\.6 2\.2a5 5 0 0 1 4\.6|M8\.6 3\.5h6\.8l6\.1 10\.6|M5\.6 2\.5h4\.8l4\.1 7\.1|M4\.5 12\.5h7\.2a2\.8/);
  // 꺼짐은 같은 아이콘을 회색조로 엷게, 켜짐을 공식 색 바탕으로 칠하지 않음. CSS에 새 색값 없음.
  const css = read('app/photos.css');
  assert.match(css, /\[data-photos-src\]\[aria-pressed="false"\] svg\{ filter:grayscale\(1\); opacity:\.45; \}/);
  assert.match(css, /\[data-photos-src\]\[aria-pressed="true"\]\{ background:transparent; color:var\(--kptu-ink\); \}/);
  assert.match(css, /\.photos-src-mark:is\(\[data-src="onedrive"\],\[data-src="gdrive"\]\)\{ background:var\(--kptu-surface\); \}/);
});

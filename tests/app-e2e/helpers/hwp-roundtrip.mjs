// PRODUCT-판매준비범용화한글양식 작업 1(S62-10): 브라우저 엔진(앱의 칸막이 rhwp, app/hwp-frame.js) 왕복.
// HWP → HWPX → 칸 하나 고침(Node) → HWP → 다시 읽기. 시험(tests/app-e2e/hwp-roundtrip.spec.mjs)과
// 로컬 실행 도구(scripts/hwp-roundtrip/run.mjs)가 같이 쓴다. 파일은 브라우저 창과 이 프로세스 사이에서만 오간다.
import {shapeOf, diffShapes, editCell} from '../../../scripts/hwp-roundtrip/compare.mjs';

export const FIXTURE_PATH = '/tests/app-e2e/hwp-roundtrip-fixture.html';

// 정적 서버는 CORS 머리를 주지 않으므로, 칸막이 편집기 파일에만 GitHub Pages와 같은 머리를 붙인다(helpers/hwp-editor.mjs와 같은 이유).
export async function openEngine(page, origin) {
  await page.route(url => url.pathname.includes('/app/hwp-lab/'), async route => {
    try {
      const response = await route.fetch();
      await route.fulfill({response, headers: {...response.headers(), 'access-control-allow-origin': '*'}});
    } catch { await route.abort().catch(() => {}); }
  });
  await page.goto(origin + FIXTURE_PATH);
  await page.waitForFunction(() => window.fixtureReady === true);
}

export async function convert(page, bytes, name, out) {
  const r = await page.evaluate(({list, name, out}) => window.convert(list, name, out), {list: [...bytes], name, out});
  return {bytes: new Uint8Array(r.bytes), pages: r.pages};
}

// 원본 HWP 바이트 → 각 단계 바이트·쪽 수·뼈대·바뀐 것 목록.
// edit: {table, row, col, text} 또는 null(고치지 않은 순수 왕복).
export async function roundTrip(page, hwp, zlib, {edit = null} = {}) {
  const first = await convert(page, hwp, 'source.hwp', 'hwpx');          // HWP → HWPX
  const edited = edit ? editCell(first.bytes, zlib, edit) : first.bytes; // 칸 하나 고침
  const back = await convert(page, edited, 'edited.hwpx', 'hwp');        // HWPX → HWP
  const reread = await convert(page, back.bytes, 'result.hwp', 'hwpx');  // 결과 HWP를 다시 읽기
  const before = shapeOf(first.bytes, zlib, {pages: first.pages});
  const after = shapeOf(reread.bytes, zlib, {pages: reread.pages});
  return {hwpx: first.bytes, edited, hwp: back.bytes, rereadHwpx: reread.bytes, before, after, changes: diffShapes(before, after)};
}

// 파일의 쪽 그림(SVG 글) 전부. 비교 화면 사진용.
export async function pageSvgs(page, bytes, name) {
  const {pages} = await convert(page, bytes, name, 'hwpx');
  const svgs = [];
  for (let i = 0; i < pages; i++) svgs.push(await page.evaluate(n => window.pageSvg(n), i));
  return {pages, svgs};
}
// SVG에서 글자만 뽑아 쪽마다 비교할 열쇠로 쓴다(Node에서 DOM 없이: 태그를 걷어 낸다).
export const svgText = svg => String(svg).replace(/<[^>]*>/g, '').replace(/\s+/g, '');

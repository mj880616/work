import {test, expect} from '@playwright/test';
import {testOrigin} from './helpers/test-origin.mjs';
import {makeRoundtripHwpx, EDIT_TARGET, LONG_ROWS, zlib} from '../../scripts/hwp-roundtrip/fixture.mjs';
import {openEngine, convert, roundTrip} from '../../scripts/hwp-roundtrip/browser.mjs';
import {shapeOf, shapeCounts, diffShapes} from '../../scripts/hwp-roundtrip/compare.mjs';
// PRODUCT-판매준비범용화한글양식 작업 1(S62-10): 한글 양식 왕복(HWP → HWPX → 칸 하나 고침 → HWP)을 앱의 브라우저 엔진
// (칸막이 rhwp, app/hwp-frame.js)으로만 돌려, 서식 뼈대(쪽·문단·표 칸·합친 칸·글자 모양·머리말)가 그대로인지 본다.
// 합성 파일만 쓴다(실명·업무 내용 없음). 실제 파일 왕복은 scripts/hwp-roundtrip/run.mjs로 로컬에서만 한다.
test.setTimeout(180000);
const HWP_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];

async function sourceHwp(page) {
  const fixture = makeRoundtripHwpx();
  const made = await convert(page, fixture, 'fixture.hwpx', 'hwp');
  expect([...made.bytes.slice(0, 4)]).toEqual(HWP_MAGIC);
  return {fixture, hwp: made.bytes};
}

test('합성 한글 파일: 칸 하나 고친 왕복은 그 칸 글만 바뀐다', async ({page}) => {
  await openEngine(page, testOrigin);
  const {fixture, hwp} = await sourceHwp(page);
  const result = await roundTrip(page, hwp, zlib, {edit: {table: 0, ...EDIT_TARGET}});
  expect([...result.hwp.slice(0, 4)]).toEqual(HWP_MAGIC);

  // 엔진이 HWP에서 읽은 뼈대가 합성 원본(.hwpx)과 같은지 먼저 본다(쪽 수는 원본 .hwpx에 없으므로 빼고).
  const own = shapeOf(fixture, zlib);
  const counts = shapeCounts(result.before);
  expect({...counts, pages: null}).toEqual(shapeCounts(own));
  expect(counts.headers).toBe(1);
  expect(counts.footers).toBe(1);
  expect(counts.merged).toBeGreaterThanOrEqual(LONG_ROWS / 5);
  expect(counts.charLooks).toBeGreaterThan(3);
  expect(result.before.pages).toBeGreaterThan(1);

  // 왕복 뒤 바뀐 것은 고친 칸 하나(= 그 칸의 문단 하나)뿐이다.
  expect(result.changes).toEqual([
    {kind: '문단 글', detail: '1개 문단의 글이 다름'},
    {kind: '칸 글', detail: `표 1 ${EDIT_TARGET.row + 1}행 ${EDIT_TARGET.col + 1}열`},
  ]);
  const cell = result.after.tables[0].texts.find(c => c.row === EDIT_TARGET.row && c.col === EDIT_TARGET.col);
  expect(cell.text).toBe(EDIT_TARGET.text);
});

test('합성 한글 파일: 고치지 않은 왕복은 바뀐 것이 없다', async ({page}) => {
  await openEngine(page, testOrigin);
  const {hwp} = await sourceHwp(page);
  const result = await roundTrip(page, hwp, zlib);
  expect(result.changes).toEqual([]);
  // 두 번 돌려도 같다(왕복이 쌓여도 조금씩 어긋나지 않음).
  const again = await roundTrip(page, result.hwp, zlib);
  expect(diffShapes(result.before, again.after)).toEqual([]);
});

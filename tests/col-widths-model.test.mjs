// S51-33 UI-칸너비끌기: 표 칸 너비 저장 규칙(col-widths-model.mjs). 폰·폴드 펼침·PC 따로, 서버 칸 이름 규칙(DB 검사와 같은 모양) 안에서.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { colDevice, colKey, colsFor, withCol, isDoubleTap, DOUBLE_TAP_MS } from '../app/col-widths-model.mjs';
import { COL_NAME_RE } from '../app/view-prefs.js';

test('화면 종류: 600px 미만 폰(_p), 600~1199 폴드 펼침(_f), 1200 이상 PC(꼬리 없음 = 옛 값 그대로)', () => {
  assert.equal(colDevice(412), 'p'); assert.equal(colDevice(599), 'p');
  assert.equal(colDevice(600), 'f'); assert.equal(colDevice(690), 'f'); assert.equal(colDevice(884), 'f'); assert.equal(colDevice(1199), 'f');
  assert.equal(colDevice(1200), ''); assert.equal(colDevice(1440), '');
  for (const d of ['', 'f', 'p']) for (const k of ['name', 'path', 'day', 'size', 'kind', 'org']) assert.match(colKey(k, d), COL_NAME_RE);
});

test('저장 값: 한 종류의 한 칸만 바꾸고 다른 종류·칸은 그대로, 지우면 기본 너비, 다 지우면 null', () => {
  const pc = { day: 100 };
  const fold = withCol(pc, 'name', 'f', 320);
  assert.deepEqual(fold, { day: 100, name_f: 320 });
  assert.deepEqual(pc, { day: 100 }); // 원본은 그대로
  assert.deepEqual(colsFor(fold, ['name', 'day'], 'f'), { name: 320 });
  assert.deepEqual(colsFor(fold, ['name', 'day'], ''), { day: 100 });
  assert.deepEqual(colsFor(fold, ['name', 'day'], 'p'), {});
  assert.deepEqual(withCol(fold, 'name', 'f', null), { day: 100 });
  assert.equal(withCol({ name_p: 50 }, 'name', 'p', null), null);
  assert.deepEqual(colsFor(null, ['name'], ''), {});
});

test('두 번 누르기: 같은 금을 350ms 안에 두 번', () => {
  assert.equal(isDoubleTap(null, { key: 'name', at: 10 }), false);
  assert.equal(isDoubleTap({ key: 'name', at: 10 }, { key: 'name', at: 10 + DOUBLE_TAP_MS }), true);
  assert.equal(isDoubleTap({ key: 'name', at: 10 }, { key: 'name', at: 11 + DOUBLE_TAP_MS }), false);
  assert.equal(isDoubleTap({ key: 'name', at: 10 }, { key: 'day', at: 20 }), false);
});

test('공용 부품: 기기 저장 없음, 금은 늘 보이고 잡는 범위 24px, 폰에서도 숨기지 않음, 끄는 동안 안내선', () => {
  const src = fs.readFileSync(new URL('../app/col-resize.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB/);
  assert.match(src, /\.col-grip\{position:absolute;top:0;bottom:0;width:24px/);
  assert.doesNotMatch(src, /@media\(max-width:760px\)\{\.col-grip\{display:none/);
  assert.match(src, /\.col-guide\{position:fixed/);
  assert.match(src, /viewPrefs\.setCols\(name, withCol\(/);
});

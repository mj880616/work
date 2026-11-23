// S68-33 READ-글자크기: 글 보기 본문 글자 크기 다섯 단계(읽을 거리 글 보기·News 글 상세 공용, 서버 view_prefs.news_font).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {TEXT_SIZES, DEFAULT_TEXT_SIZE, TEXT_SCALES, keepTextSize, stepTextSize, canStep, textScale} from '../app/text-size-model.mjs';

test('단계 다섯: 기본 아래 하나, 위 셋 — 서버 허용 값(view-prefs NEWS_FONTS)과 같다', async () => {
  assert.deepEqual([...TEXT_SIZES], ['s', 'm', 'l', 'xl', 'xxl']);
  assert.equal(DEFAULT_TEXT_SIZE, 'm');
  assert.equal(TEXT_SIZES.indexOf(DEFAULT_TEXT_SIZE), 1);
  const {NEWS_FONTS, validValue} = await import('../app/view-prefs.js');
  assert.deepEqual([...NEWS_FONTS], [...TEXT_SIZES]);
  for (const v of TEXT_SIZES) assert.equal(validValue('news_font', v), true, v);
  for (const v of ['xs', 'S', '', 2, null]) assert.equal(validValue('news_font', v), false, String(v));
  // 앞 판 [가 가 가]의 s·m·l 크기(16px 기준 14·16·19px)는 그대로.
  assert.deepEqual([16 * TEXT_SCALES.s, 16 * TEXT_SCALES.m, 16 * TEXT_SCALES.l], [14, 16, 19]);
  for (let i = 1; i < TEXT_SIZES.length; i++) assert.ok(TEXT_SCALES[TEXT_SIZES[i]] > TEXT_SCALES[TEXT_SIZES[i - 1]]);
});

test('한 단계씩, 끝에서는 그대로(단추 꺼짐)', () => {
  assert.equal(stepTextSize('m', 1), 'l');
  assert.equal(stepTextSize('m', -1), 's');
  assert.equal(stepTextSize('xl', 1), 'xxl');
  assert.equal(stepTextSize('xxl', 1), 'xxl');
  assert.equal(stepTextSize('s', -1), 's');
  assert.equal(canStep('s', -1), false);
  assert.equal(canStep('s', 1), true);
  assert.equal(canStep('xxl', 1), false);
  assert.equal(canStep('xxl', -1), true);
  for (const v of [undefined, null, '', 'huge']) { assert.equal(keepTextSize(v), 'm'); assert.equal(textScale(v), 1); }
  assert.equal(stepTextSize('huge', 1), 'l');
});

test('두 화면이 공용 부품 하나를 쓰고(서버 화면 기억에만 저장 — 기기 저장 금지는 browser-storage-audit가 본다), 옛 [가 가 가]가 없다', async () => {
  const read = p => readFile(new URL('../app/' + p, import.meta.url), 'utf8');
  const [reading, detail, part, readingCss, nowCss] = await Promise.all(['reading.js', 'now-detail.js', 'text-size.js', 'reading.css', 'now.css'].map(read));
  for (const src of [reading, detail]) assert.match(src, /from '\.\/text-size\.js'/);
  assert.match(reading, /textSizeHtml\(\)/);
  assert.match(detail, /textSizeHtml\(\)/);
  assert.doesNotMatch(detail, /data-nd-font|nd-size-btn|NEWS_FONT_STEPS/);
  assert.doesNotMatch(nowCss, /nd-size|data-font=/);
  assert.match(part, /viewPrefs\.set\(KEY/);
  assert.match(part, /const KEY = 'news_font'/);
  assert.match(part, /aria-label="\$\{label\}"/);
  assert.match(part, /'글자 작게'/);
  assert.match(part, /'글자 크게'/);
  assert.match(part, /class="txs ds-seg"/);
  // 본문 글자만 배율을 곱한다(머리·단추는 그대로).
  assert.match(readingCss, /\.rd-prose\{[^}]*font-size:calc\(var\(--ds-text-row\) \* var\(--txs,1\)\)/);
  assert.match(nowCss, /\.nd-prose\{ --nd-fs:calc\(16px \* var\(--txs,1\)\)/);
});

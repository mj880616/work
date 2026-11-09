// BIZ-주간칸밀림: index.html의 #bizWeekBox 본문(모듈이 오기 전 첫 그림)이 biz-week-skeleton.mjs와 같은 글인지 검사한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {weekBodyHtml} from '../app/biz-week-skeleton.mjs';

test('index.html의 주간보고 칸 본문 = 표 모양 자리 부품이 그리는 본문', () => {
  const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  const m = html.match(/<section id="bizWeekBox"[^>]*>.*?<div data-bw-body>(.*?)<\/div><\/section>/s);
  assert.ok(m, '#bizWeekBox 본문을 찾지 못함');
  assert.equal(m[1].replace(/\s+/g, ' '), weekBodyHtml().replace(/\s+/g, ' '));
});

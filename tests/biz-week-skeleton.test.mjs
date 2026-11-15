// BIZ-빈표잠깐보임다시(BIZ-주간칸밀림 이어서): 표 모양 자리는 사업영역이 있다고 확인된 칸에만 부품(weekly-summary-table.js)이 그린다.
// index.html의 #bizWeekBox 본문은 비어 있어야 한다(표 모양을 글로 박아 두면 사업영역 0개 계정에서 잠깐 보일 수 있음).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {weekBodyHtml} from '../app/biz-week-skeleton.mjs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');

test('index.html의 주간보고 칸 본문은 비어 있다(표 모양 없음)', () => {
  const html = read('../app/index.html');
  const m = html.match(/<section id="bizWeekBox"[^>]*>(.*?)<\/section>/s);
  assert.ok(m, '#bizWeekBox를 찾지 못함');
  assert.match(m[0], /<section id="bizWeekBox"[^>]*\bhidden\b/, '칸은 처음에 숨겨져 있어야 함');
  const body = m[1].match(/<div data-bw-body>(.*?)<\/div>$/s);
  assert.ok(body, '#bizWeekBox 본문 자리를 찾지 못함');
  assert.equal(body[1].trim(), '');
  assert.doesNotMatch(m[1], /biz-skel|사업요약표|<table/);
});

test('표 모양 자리 부품은 머리글 4칸·두 제목을 그린다', () => {
  const h = weekBodyHtml('<button>x</button>');
  assert.match(h, /biz-skel-table/);
  assert.equal((h.match(/<th scope="col">/g) || []).length, 4);
  assert.match(h, /1\) 사업요약표/);
  assert.match(h, /2\) 주요 사업·회의결과/);
});

test('표 모양 자리를 그리는 곳은 주간보고 부품 하나이고, 사업영역 수를 모르면 그리지 않는다', () => {
  const src = read('../app/weekly-summary-table.js');
  assert.equal((src.match(/weekBodyHtml\(/g) || []).length, 1, 'weekBodyHtml은 drawPaper 한 곳에서만');
  assert.match(src, /function drawPaper\(\)\{\s*if\(box\.dataset\.bpBody==='paper'\)return;\s*box\.querySelector\('\[data-bw-body\]'\)\.innerHTML=weekBodyHtml/);
  assert.match(src, /if\(!compact&&typeof areas==='function'&&areas\(\)==null\)return;\s*ensureBox\(el\);/);
  const team = read('../app/team.js');
  assert.doesNotMatch(team, /weekBodyHtml|paperSkeletonHtml|biz-skel/, '화면(team.js)은 칸 안을 그리지 않는다');
  assert.match(team, /el\.hidden=reportView!=='list'\|\|n===null\|\|!weekBoxKit/);
});

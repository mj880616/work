import assert from 'node:assert/strict';
import test from 'node:test';
import { scanScript, scanHtml, FORBIDDEN } from './check-girok-words.mjs';
import { FACES, wordIn } from '../app/brand/faces.mjs';

// APP-올인원다이어리 단계 3(단어, S67-43): 기록+ 금지어 검사기 자체 시험. 실제 검사는 pages-build-check.yml이 기록+ 빌드 출력에 돌린다.
const why = list => list.map(p => `${p.line}:${p.why}:${p.text}`);

test('금지어가 든 고정 글자는 word()를 거쳐야 한다', () => {
  const src = [
    "import {word} from './brand/brand.mjs';",
    "const a = '담당조직을 고르세요';",
    "const b = word('담당조직을 고르세요');",
    "const c = word`${name} 사업영역`;",
    "const d = {'담당조직': 1};",
    "const e = /투쟁/.test(x);",
    "// 노조 주석",
    "const f = word('조직 관리', 'title');",
    "const g = brandWord('사업 보고');",
    "const h = `${name} 조합원`;"
  ].join('\n');
  assert.deepEqual(why(scanScript('app/x.js', src)), ['2:word()를 거치지 않음:담당조직을 고르세요', '10:word()를 거치지 않음: 조합원']);
});

test('word()를 거쳐도 기록+ 단어표에 없어 남으면 잡는다', () => {
  const left = scanScript('app/x.js', "word('임금 교섭단 파업')");
  assert.equal(wordIn(FACES.girok, '임금 교섭단 파업').includes('파업'), true, '표에 없는 말이 남는 예');
  assert.equal(left.length, 1);
  assert.match(left[0].why, /단어표를 거쳐도 남음/);
});

test('HTML은 눈에 보이는 글자와 인라인 script를 본다', () => {
  const html = '<p data-x="담당조직">자료</p><span title="사업 관리">x</span><!-- 노조 --><script>const a="투쟁";</script><style>.a{}</style>';
  assert.deepEqual(scanHtml('app/x.html', html).map(p => p.text), ['사업 관리', '투쟁']);
});

test('금지어 목록은 노조 색 낱말을 잡고 일반어는 그냥 둔다', () => {
  for (const w of ['노동조합', '노조', '조합원', '투쟁', '교섭', '상집', '담당조직', '사업영역', '사업 보고', '조직', '국회', '쟁의', '파업']) assert.match(w, FORBIDDEN, w);
  for (const w of ['활동 기록', '프로젝트', '거래처·부서·직원', '관리 대상', '주요 거래처', '회의', '기획', '협의', '홍보', '외근', '행사']) assert.doesNotMatch(w, FORBIDDEN, w);
});

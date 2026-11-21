import assert from 'node:assert/strict';
import test from 'node:test';
import { scanScript, scanHtml, FORBIDDEN, GUIDE_FORBIDDEN } from './check-girok-words.mjs';
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

// S67-63: 사용 안내 글(쓰는 법·빈 화면 안내)은 금지어에 더해 노조 업무 예시 낱말·'주간 보고'까지 예외 없이 본다.
test('사용 안내 글 파일은 더 엄한 낱말 목록으로 본다', () => {
  const src = "import {word} from './brand/brand.mjs';\nconst a = word('회의·면담·집회처럼 날짜 있는 활동');\nconst b = '[하루 | 주간 보고]';\nconst c = word('예: 11/18 사측 실무 교섭 — 인력 충원안 회신 요구');";
  const guide = why(scanScript('app/help-content.mjs', src));
  // 2: 표에 없는 조각('…집회처럼 날짜 있는 활동')은 거쳐도 남음, 3: word()를 안 거친 '주간 보고'. 4는 표 문장이라 통과.
  assert.deepEqual(guide.map(line => line.split(':')[0] + ':' + line.split(':')[1]), ['2:단어표를 거쳐도 남음', '3:word()를 거치지 않음']);
  assert.deepEqual(scanScript('app/other.js', "const b = '[하루 | 주간 보고]';"), [], '안내 글 밖은 지금 목록 그대로');
  for (const w of ['주간 보고', '집회', '사측', '분회', '임금', '사무장', '단체협약', '조직 확대', '운영위원회', '사업별', '이번 주 사업', '사업 만들기']) assert.match(w, GUIDE_FORBIDDEN, w);
  for (const w of ['주간 정리', '외근', '상대측', '견적', '거래처 늘리기', '팀 회의', '프로젝트별', '이번 주 활동', '프로젝트 만들기']) assert.doesNotMatch(w, GUIDE_FORBIDDEN, w);
});

test('실제 사용 안내 글: 기록+ 글자에 노조 색 0, 노동조합+ 얼굴은 글자 그대로', async () => {
  const { readFileSync } = await import('node:fs');
  const { GUIDE_FILES } = await import('./girok-words-allow.mjs');
  for (const file of GUIDE_FILES) assert.deepEqual(why(scanScript(file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'))), [], file);
  // 캡처에 보인 빈 화면 안내(사업 관리·조직 관리)·홈 탭 이름
  const shown = [
    ['회의·면담·집회처럼 날짜 있는 활동을 남기는 곳이에요', '회의·면담·외근처럼 날짜 있는 활동을 남기는 곳이에요'],
    ["'사업영역'(큰 주제)별로 활동을 모아 두면, 주간 보고와 '이번 주 사업' 표가 저절로 채워져요.", "'프로젝트'(큰 주제)별로 활동을 모아 두면, 주간 정리와 '이번 주 활동' 표가 저절로 채워져요."],
    ['예: 임금 교섭, 안전 인력 확충, 조직 확대', '예: 신제품 출시, 사무실 이전, 거래처 늘리기'],
    ['예: 11/18 사측 실무 교섭 — 인력 충원안 회신 요구', '예: 11/18 거래처 실무 협의 — 견적 회신 요청'],
    ["주간 보고 '사업' 칸과 사업영역별 진행 상황에 모여요", "주간 정리 '활동' 칸과 프로젝트별 진행 상황에 모여요"],
    ['+ 사업 만들기', '+ 프로젝트 만들기'],
    ['맡은 조직별 상황을 쌓아 두는 곳이에요', '거래처·부서·직원별 상황을 쌓아 두는 곳이에요'],
    ["지부·지회·분회처럼 내가 챙기는 조직마다 '요즘 무슨 일이 있는지'를 한 줄씩 남겨요.", "거래처·부서·직원처럼 내가 챙기는 대상마다 '요즘 무슨 일이 있는지'를 한 줄씩 남겨요."],
    ['예: 바다지회, 들판분회', '예: 바다상사, 들판팀'],
    ['예: 임금 교섭 3차, 사측 기본급 2% 제시', '예: 납품 단가 협의 3차, 상대측 2% 인상 제시'],
    ["[전체 표]에서 모든 조직의 이번 주를 한눈에 보고, 주간 보고 '조직' 칸으로 모여요", "[전체 표]에서 모든 관리 대상의 이번 주를 한눈에 보고, 주간 정리 '관리 대상' 칸으로 모여요"],
    ['주간 보고', '주간 정리'],
    ['사업(예: 임단협, 조직 확대)을 만들면 회의·결과가 사업별로 모여요', '프로젝트(예: 신제품 출시, 거래처 늘리기)를 만들면 회의·결과가 프로젝트별로 모여요']
  ];
  for (const [from, to] of shown) {
    assert.equal(wordIn(FACES.girok, from), to, from);
    assert.equal(wordIn(FACES.nojo, from), from, `노동조합+ 얼굴은 그대로: ${from}`);
  }
});

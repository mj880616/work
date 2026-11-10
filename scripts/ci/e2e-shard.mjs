#!/usr/bin/env node
// 화면 시험(App browser E2E) 갈래 나누기와 빠짐 확인 (OPS-작업속도, S56-29).
//
// 왜: Playwright 1.55의 --shard는 시험 목록을 파일 이름 순서대로 이어 자른다. 그래서 무거운 시험이 많은 파일
// (journal.spec.mjs 시험 145개)이 한두 갈래에 몰려, 그 갈래만 10분 넘게 걸렸다. 여기서는 같은 목록을
// 시험 하나씩 갈래마다 차례로 나눠, 한 파일의 시험이 모든 갈래에 퍼지게 한다.
// 시험 개수·내용은 바꾸지 않는다. 빼기·건너뛰기·재시도 없음.
// 고르는 방법: 파일:줄 인자는 파일 수백 개를 한꺼번에 읽을 때 줄 번호가 어긋나는 시험이 있어(목록 109줄, 실제 62줄) 쓰지 않는다.
// 대신 시험마다 '파일 경로 + 묶음 제목 + 시험 제목' 전체가 정확히 같은 것만 고르는 --grep 하나를 만든다
// (Playwright는 한 파일 안에 같은 제목 시험을 허락하지 않으므로 이 전체 제목은 시험 하나를 가리킨다).
// 그리고 실행 뒤 json 보고서의 시험 id로 맡은 시험이 빠짐·덧붙음 없이 돌았는지 확인한다.
//
//   node scripts/ci/e2e-shard.mjs plan   <list.json> <index> <total> <out.json> <grep.txt>
//       list.json = `npx playwright test tests/app-e2e --browser=chromium --list --reporter=json` 결과.
//       out.json  = {specIds:[…], tests:n}, grep.txt = playwright test --grep 에 넘길 정규식(/…/ 꼴, 대소문자 구분).
//   node scripts/ci/e2e-shard.mjs verify <out.json> <result.json>
//       result.json = 이 갈래 실행의 json reporter 결과. 맡은 시험이 정확히 그대로(빠짐·덧붙음 없이) 돌았는지 본다.
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// Playwright json 보고서(목록·실행 모두 같은 모양)에서 spec을 모두 꺼낸다.
export function collectSpecs(report) {
  const out = [];
  const walk = (suite, titles) => {
    for (const spec of suite.specs || []) out.push({id: spec.id, file: spec.file, titles: [...titles, spec.title], tests: (spec.tests || []).length});
    for (const child of suite.suites || []) walk(child, [...titles, child.title]);
  };
  for (const suite of report.suites || []) walk(suite, [suite.title]);
  return out;
}

const escape = text => text.replace(/[\\^$.*+?()[\]{}|\/]/g, '\\$&');
// Playwright --grep이 맞춰 보는 글: '(빈 뿌리) 프로젝트 이름 파일 경로 묶음… 시험 제목'을 빈칸으로 이은 것.
// 파일 경로(맨 위 묶음 제목) 앞은 빈칸, 시험 제목 뒤는 글 끝이어야 한다.
export function titlePattern(spec) {
  return `(?:^| )${escape(spec.titles.join(' '))}$`;
}
export function grepFor(specs) {
  return `/${specs.map(titlePattern).join('|')}/`;
}

// 파일 순서대로 시험을 하나씩, 지금까지 맡은 시험 수가 가장 적은 갈래(같으면 앞 갈래)에 준다 = 차례로 돌려 주기.
// 이어진 시험이 서로 다른 갈래로 가므로 한 파일의 시험이 갈래마다 퍼진다. 모든 시험은 정확히 한 갈래에만 간다.
export function partition(specs, total) {
  if (!Number.isInteger(total) || total < 1) throw new Error(`bad shard total: ${total}`);
  const sorted = [...specs].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const shards = Array.from({length: total}, () => ({specs: [], tests: 0}));
  for (const spec of sorted) {
    let best = 0;
    for (let i = 1; i < total; i++) if (shards[i].tests < shards[best].tests) best = i;
    shards[best].specs.push(spec);
    shards[best].tests += spec.tests;
  }
  return shards;
}

export function plan(report, index, total) {
  if (report.errors?.length) throw new Error(`playwright list errors: ${report.errors.length}`);
  if (!Number.isInteger(index) || index < 1 || index > total) throw new Error(`bad shard index: ${index}/${total}`);
  const specs = collectSpecs(report);
  if (!specs.length) throw new Error('playwright list has no tests');
  const keys = specs.map(spec => spec.titles.join(' '));
  if (new Set(keys).size !== keys.length) throw new Error('같은 전체 제목의 시험이 둘 이상 있어 하나씩 고를 수 없음');
  const shard = partition(specs, total)[index - 1];
  return {
    shard: `${index}/${total}`,
    grep: grepFor(shard.specs),
    specIds: shard.specs.map(s => s.id).sort(),
    tests: shard.tests,
  };
}

// 실행 결과의 spec 목록·시험 수가 계획과 정확히 같아야 한다.
export function verify(planned, result) {
  const ran = collectSpecs(result);
  const ranIds = ran.map(s => s.id).sort();
  const ranTests = ran.reduce((sum, s) => sum + s.tests, 0);
  const want = new Set(planned.specIds), got = new Set(ranIds);
  const missing = planned.specIds.filter(id => !got.has(id));
  const extra = ranIds.filter(id => !want.has(id));
  const problems = [];
  if (missing.length) problems.push(`맡은 시험 중 돌지 않은 spec ${missing.length}개`);
  if (extra.length) problems.push(`맡지 않은 spec ${extra.length}개가 돎`);
  if (ranIds.length !== new Set(ranIds).size) problems.push('같은 spec이 두 번 나옴');
  if (ranTests !== planned.tests) problems.push(`시험 수 계획 ${planned.tests}개, 실행 ${ranTests}개`);
  return {ok: problems.length === 0, problems, tests: ranTests, missing, extra};
}

function main(argv) {
  const [mode, ...rest] = argv;
  if (mode === 'plan') {
    const [listPath, index, total, outPath, grepPath] = rest;
    const {grep, ...result} = plan(JSON.parse(readFileSync(listPath, 'utf8')), Number(index), Number(total));
    writeFileSync(outPath, JSON.stringify(result));
    writeFileSync(grepPath, grep);
    console.log(`shard ${result.shard}: 시험 ${result.tests}개`);
    return;
  }
  if (mode === 'verify') {
    const [planPath, resultPath] = rest;
    const outcome = verify(JSON.parse(readFileSync(planPath, 'utf8')), JSON.parse(readFileSync(resultPath, 'utf8')));
    if (!outcome.ok) {
      console.error(`갈래 시험 확인 실패: ${outcome.problems.join(', ')}`);
      for (const id of [...outcome.missing, ...outcome.extra].slice(0, 20)) console.error(`  ${id}`);
      process.exit(1);
    }
    console.log(`갈래 시험 확인: 맡은 시험 ${outcome.tests}개가 빠짐·덧붙음 없이 돌았음`);
    return;
  }
  console.error('usage: e2e-shard.mjs plan <list.json> <index> <total> <out.json> <grep.txt> | verify <plan.json> <result.json>');
  process.exit(2);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));

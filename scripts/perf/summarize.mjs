// PERF-첫로딩 P1: 측정 기록(PERF … / PERF_SHELL … / PERF_SWITCH … 한 줄 JSON)을 모아 회차별 값·가운데 값·흩어짐 표(마크다운)로 만든다.
// 흩어짐 = (가장 큰 값 − 가장 작은 값) ÷ 가운데 값. 10% 넘는 칸에 ⚠를 붙인다(실패로 끝내지 않는다).
// 사용법: node scripts/perf/summarize.mjs <기록 파일>... > summary.md
//   PERF_SPREAD_LIMIT=0.1(기본) · 기록 파일은 playwright --reporter=line 출력 그대로 넣으면 된다.
import { readFileSync } from 'node:fs';

const limit = Number(process.env.PERF_SPREAD_LIMIT || 0.1);
// 시간 칸(…Ms, ready)은 브라우저 시계·검사 간격 때문에 수십 ms가 늘 흔들린다. 차이가 이 값(ms) 안이면 10%를 넘어도 한도 안으로 본다.
const msFloor = Number(process.env.PERF_MS_FLOOR || 50);
const isTime = metric => /Ms$/.test(metric) || metric === 'ready';
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

export function parse(text) {
  const out = { load: [], shell: [], switch: [] };
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/\b(PERF|PERF_SHELL|PERF_SWITCH) (\{.*\})\s*$/);
    if (!m) continue;
    try {
      const row = JSON.parse(m[2]);
      out[{ PERF: 'load', PERF_SHELL: 'shell', PERF_SWITCH: 'switch' }[m[1]]].push(row);
    } catch { /* 깨진 줄은 건너뛴다 */ }
  }
  return out;
}

// 같은 열쇠(조건·화면·단계)끼리 묶어 숫자 칸마다 회차 값·가운데 값·흩어짐을 낸다.
export function group(rows, keyOf, metrics) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups].map(([key, list]) => ({
    key,
    rounds: list.length,
    metrics: Object.fromEntries(metrics.map(m => {
      const values = list.map(r => r[m]).filter(Number.isFinite);
      const mid = values.length ? median(values) : NaN;
      const spread = values.length > 1 ? (Math.max(...values) - Math.min(...values)) / (mid || 1) : 0;
      const range = values.length ? Math.max(...values) - Math.min(...values) : 0;
      const over = values.length > 1 && spread > limit && !(isTime(m) && range <= msFloor);
      return [m, { values, median: mid, spread, over }];
    })),
  }));
}

const cell = ({ values, median: mid, spread, over }, unit = '') => {
  if (!values.length) return '—';
  const warn = over ? ' ⚠' : '';
  return `${mid}${unit} (${values.join('/')}, ±${Math.round(spread * 100)}%)${warn}`;
};

export function render({ load, shell, switch: sw }) {
  const lines = [];
  const all = [];
  const table = (title, head, groups, cols) => {
    if (!groups.length) return;
    lines.push(`### ${title}`, '', `| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`);
    for (const g of groups) {
      lines.push(`| ${g.key.split('\u0000').join(' | ')} | ${g.rounds} | ${cols.map(([m, unit]) => cell(g.metrics[m], unit)).join(' | ')} |`);
      for (const [m] of cols) all.push({ where: `${title} ${g.key.split('\u0000').join('/')} ${m}`, ...g.metrics[m] });
    }
    lines.push('');
  };
  table('첫 화면 껍데기(로그인 안 함 → 로그인 화면)', ['조건', '화면', '회차', '보임(ms)', 'JS 파일', 'JS KB'],
    group(shell, r => [r.profile, r.view].join('\u0000'), ['shownMs', 'jsFiles', 'jsKB']),
    [['shownMs'], ['jsFiles'], ['jsKB']]);
  table('로그인 뒤 화면 새로 열기', ['조건', '화면', '회차', '보임(ms)', '보이기 전 JS 파일', '보이기 전 JS KB', '쉬는 틈까지 JS 파일', '쉬는 틈까지 JS KB'],
    group(load, r => [r.profile, r.view].join('\u0000'), ['ready', 'jsBeforeReady', 'jsKBBeforeReady', 'jsTotal', 'jsKBTotal']),
    [['ready'], ['jsBeforeReady'], ['jsKBBeforeReady'], ['jsTotal'], ['jsKBTotal']]);
  table('메뉴 눌러 화면 바꾸기', ['조건', '단계·화면', '회차', '바뀜(ms)', '기다림 끝(ms)', '보일 때까지 새 JS 파일', '다음 클릭 전까지 새 JS 파일', '다음 클릭 전까지 새 JS KB'],
    group(sw, r => [r.profile, `${r.step} ${r.view}`].join('\u0000'), ['shownMs', 'settledMs', 'newJsFiles', 'newJsFilesIdle', 'newJsKBIdle']),
    // 보이는 순간의 KB는 받는 중인 파일이 반쯤 잡혀 흔들린다 → 크기는 다음 클릭 전(받기 끝난 뒤) 값만 쓴다.
    [['shownMs'], ['settledMs'], ['newJsFiles'], ['newJsFilesIdle'], ['newJsKBIdle']]);
  const over = all.filter(x => x.over);
  const head = [`## PERF 측정 요약`, '', `칸 읽는 법: 가운데 값 (회차별 값, ±흩어짐). 흩어짐 한도 ${Math.round(limit * 100)}%(시간 칸은 차이 ${msFloor}ms 안이면 한도 안).`, '',
    over.length ? `⚠ 한도를 넘은 칸 ${over.length}개 / 전체 ${all.length}개` : `✅ 모든 칸(${all.length}개)이 한도 안`, ''];
  return { markdown: [...head, ...lines].join('\n'), over, total: all.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.slice(2);
  const text = files.map(f => readFileSync(f, 'utf8')).join('\n');
  process.stdout.write(render(parse(text)).markdown + '\n');
}

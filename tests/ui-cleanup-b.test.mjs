import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// UI-화면정리 B(2026-10-28 명진 요청 20:03): 공용 부품 통일의 재발 방지. 기록은 docs/design-decisions.md "UI-화면정리 B".
const app = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
const SKIP = new Set(['hwp-lab', 'markdown-lib', 'pdf-lib', 'editor-lib', 'node_modules', 'legacy']);
function walk(dir, base = '', out = []) {
  for (const e of readdirSync(dir, {withFileTypes: true})) {
    if (e.isDirectory()) { if (!SKIP.has(e.name) && !/-\d+\.\d+/.test(e.name)) walk(join(dir, e.name), base + e.name + '/', out); }
    else out.push(base + e.name);
  }
  return out;
}
const files = walk(app);
const read = f => readFileSync(join(app, f), 'utf8');
const code = text => text.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const scripts = files.filter(f => /\.(m?js|html)$/.test(f));

test('⑤ 시각은 24시간 HH:MM: 12시간(오전/오후) 형식을 만드는 날짜 서식이 없다', () => {
  const bad = [];
  for (const f of scripts) {
    const t = code(read(f));
    if (/timeStyle\s*:/.test(t)) bad.push(`${f}: timeStyle(기기·언어에 따라 '오후 5:00')`);
    if (/hour12\s*:\s*true/.test(t)) bad.push(`${f}: hour12:true`);
    // 직접 만든 Intl 서식·toLocale*String에 시(hour)를 넣으면 hourCycle:'h23'을 같이 준다(공용 formatSeoulTime은 스스로 맞춘다).
    for (const m of t.matchAll(/(?:DateTimeFormat|toLocaleString|toLocaleTimeString)\(([^;]{0,240})/g)) {
      if (/\bhour\s*:/.test(m[1]) && !/hourCycle\s*:\s*['"]h23['"]/.test(m[1])) bad.push(`${f}: ${m[0].slice(0, 80)}`);
    }
    if (/toLocaleTimeString\(/.test(t)) bad.push(`${f}: toLocaleTimeString`);
  }
  assert.deepEqual(bad, [], '시각은 app/meeting-time.js formatSeoulTime(시·분 → 17:00)으로 쓰세요');
});

test('⑤ 공용 formatSeoulTime은 시·분을 받으면 초 없이 24시간 두 자리로 쓴다', async () => {
  const time = await import(join(app, 'meeting-time.js'));
  assert.equal(time.formatSeoulTime('2026-10-28T08:00:00Z', {hour: 'numeric', minute: 'numeric', second: 'numeric'}), '17:00');
  assert.equal(time.formatSeoulTime('2026-10-28T01:00:00Z', {hour: '2-digit', minute: '2-digit'}), '10:00');
  assert.equal(time.formatSeoulTime('2026-10-28T05:00:00Z', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'}), '10. 28. 14:00');
  assert.doesNotMatch(time.formatSeoulTime('2026-10-28T08:00:00Z', {year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric'}), /오전|오후/);
});

// '오전'·'오후' 글자를 쓰는 곳은 글 속 시각을 읽는 해석기·흔한 낱말 목록·반나절 표시뿐이다(시각 표기 아님).
const MERIDIEM_OK = new Set(['meeting-when.js', 'weekly-hwpx/schedule.mjs', 'library-ai-fill.js', 'weekly-exec-requests.js', 'collection-status.js', 'meeting-time.js', 'calendar-create-slot.js']);
test('⑤ 오전/오후 글자를 새로 화면 시각에 붙이지 않는다', () => {
  const found = scripts.filter(f => /['"`]오[전후]|오[전후]['"`]/.test(code(read(f)))).filter(f => !MERIDIEM_OK.has(f));
  assert.deepEqual(found, []);
});

test('③ ⋯ 버튼의 점은 공용 <span class="more-dots">⋯</span> 하나로 그린다', () => {
  const bad = [];
  for (const f of scripts) {
    const t = code(read(f));
    for (const m of t.matchAll(/>\s*⋯\s*</g)) {
      const before = t.slice(Math.max(0, m.index - 40), m.index);
      if (!/class=\\?["']more-dots\\?["'] aria-hidden=\\?["']true\\?["']$/.test(before)) bad.push(`${f}: …${before.slice(-30)}⋯`);
    }
    for (const m of t.matchAll(/(?:text:|textContent\s*=)\s*'⋯'/g)) {
      const before = t.slice(Math.max(0, m.index - 60), m.index);
      if (!/more-dots/.test(before)) bad.push(`${f}: ${m[0]}`);
    }
    for (const m of t.matchAll(/el\([^)]*,\s*'⋯'\)/g)) if (!/more-dots/.test(m[0])) bad.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(bad, []);
  const css = read('ui-standard.css');
  assert.match(css, /\.more-dots\{[^}]*font-size:var\(--ds-text-read\)[^}]*color:var\(--kptu-muted\)/);
  for (const f of files.filter(x => x.endsWith('.css') && x !== 'ui-standard.css')) assert.doesNotMatch(read(f), /\.more-dots/, `${f}: ⋯ 점 모양은 ui-standard.css 한 곳`);
});

test('① 화면 큰 제목은 공용 .screen-title(폰 머리줄·PC 위쪽 줄이 이름을 보이는 폭에서는 읽기 프로그램용)', () => {
  const css = read('ui-standard.css');
  assert.match(css, /@media \(max-width:760px\),\(min-width:1024px\)\{\s*\.screen-title\{[^}]*clip:rect\(0 0 0 0\)/);
  assert.match(read('index.html'), /<h2 class="screen-title">자료실<\/h2>/);
  assert.match(read('suborganizations.js'), /class="so-team-title screen-title">담당조직</);
  assert.match(read('telegram-feed.js'), /feed-head-title screen-title" aria-hidden="true">텔레그램 소식</);
  assert.match(read('basket.js'), /matchMedia\('\(max-width:760px\),\(min-width:1024px\)'\)/);
  assert.match(read('topbar-actions.js'), /tasks:'할 일',journal:'업무일지',diary:'일기'/);
});

test('② 고르지 않은 칩은 칠하지 않고, 글자 링크는 점선 밑줄을 쓰지 않는다', () => {
  for (const f of files.filter(x => x.endsWith('.css'))) assert.doesNotMatch(read(f), /underline dotted/, `${f}: 글자 링크는 실선 밑줄(공용 모양)`);
  const home = read('home-read.css').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of home.matchAll(/\.home-chip(?:\.urgent)?(?:::before)?\s*\{([^}]*)\}/g)) assert.doesNotMatch(m[1], /background:\s*var\(--kptu-(?:primary|danger)-soft\)/);
  assert.doesNotMatch(read('feed.css'), /\.feed-chip\{[^}]*background:var\(--kptu-surface-subtle\)/);
});

test('⑦ 폰 홈 할 일 동그라미도 할 일 색(회색 테두리 규칙 없음)', () => {
  assert.doesNotMatch(read('home-read.css'), /\.home-task \.gt-check::before \{[^}]*border-color:\s*var\(--kptu-border\)/);
});

test('⑧ 담당조직 단계 줄 [저장]은 바꾼 것이 있을 때만(한 화면 [저장] 하나)', () => {
  const t = read('org-dispute-stage-ui.js');
  assert.match(t, /data-stage-save disabled hidden>저장</);
  assert.match(t, /btn\.hidden = !changed && !line\.busy;/);
});

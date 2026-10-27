import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';

// AI-말투통일 (docs/design/ai-tone.md): Web2 서버 AI가 새로 쓰는 요약은 문장 끝을 '~함.'·'~임.' 식으로 맺는다.
// 말투 규칙은 _shared/ai-model.ts의 AI_TONE_RULE 한 줄이 유일한 출처이고, 요약을 쓰는 지시문이 그 한 줄을 그대로 넣는다.
// 바깥에 내보내는 글(주간보고 한글·성명·보도자료)의 재료를 만드는 지시문은 주간보고 문체(명사형, '~함' 금지)를 따로 가지므로 이 규칙을 넣지 않는다.
const FUNCTIONS = new URL('../supabase/functions/', import.meta.url);
const model = await import('../supabase/functions/_shared/ai-model.ts');
const telegram = await import('../supabase/functions/collector-feed/telegram.ts');
const auto = await import('../supabase/functions/ai-assist/ledger-auto.ts');
const candidates = await import('../supabase/functions/ai-assist/ledger-candidates.ts');
const fix = await import('../supabase/functions/ai-assist/ledger-fix.ts');
const handler = await import('../supabase/functions/ai-assist/handler.ts');
const library = await import('../supabase/functions/ai-assist/library-fill.ts');
const org = await import('../supabase/functions/ai-assist/org-summary.ts');
const schedule = await import('../supabase/functions/ai-assist/schedule-titles.ts');
const read = file => readFileSync(new URL(file, FUNCTIONS), 'utf8');

const RULE = model.AI_TONE_RULE;

test('the tone rule names the ending style, the forbidden endings and the three examples from the request', () => {
  assert.equal(typeof RULE, 'string');
  for (const word of ["'~함.'", "'~임.'", "'~필요함.'", "'~했다'", "'~합니다'", "'~입니다'"]) assert.ok(RULE.includes(word), word);
  for (const pair of ["'제작하기로 했다' → '제작하기로 함'", "'확인해야 한다' → '확인 필요함'", "'목표이다' → '목표임'"]) assert.ok(RULE.includes(pair), pair);
  assert.ok(!RULE.includes('\n'), 'one line so every instruction list can hold it as one entry');
});

test('summary-writing instructions carry the one shared rule: telegram news, ledger auto/candidates/fix, meeting draft', () => {
  for (const [name, text] of [['telegram', telegram.TELEGRAM_INSTRUCTIONS], ['ledger_auto', auto.LEDGER_AUTO_INSTRUCTIONS], ['ledger_candidates', candidates.LEDGER_CANDIDATES_INSTRUCTIONS], ['ledger_fix', fix.LEDGER_FIX_INSTRUCTIONS]]) {
    assert.equal(text.split(RULE).length - 1, 1, `${name}: rule appears exactly once, as the shared text`);
  }
  assert.ok(read('meeting-ai-draft/index.ts').includes('${AI_TONE_RULE}'), 'meeting draft puts the shared rule into its developer text');
  assert.match(read('meeting-ai-draft/index.ts'), /import \{[^}]*AI_TONE_RULE[^}]*\} from '\.\.\/_shared\/ai-model\.ts'/);
});

test('no instruction still asks for the old noun ending on a summary it now tells to use the tone rule', () => {
  for (const [name, text] of [['ledger_auto', auto.LEDGER_AUTO_INSTRUCTIONS], ['ledger_candidates', candidates.LEDGER_CANDIDATES_INSTRUCTIONS], ['ledger_fix', fix.LEDGER_FIX_INSTRUCTIONS]]) {
    assert.ok(!/summary는[^\n]*명사형/.test(text), `${name}: summary line must not ask for the old ending`);
    assert.match(text, /title은[^\n]*명사형으로 맺는다/, `${name}: titles stay noun phrases`);
  }
  // 텔레그램: 예시가 새 말투와 같은 꼴이고 옛 '~했다' 예시가 남지 않는다.
  assert.ok(!telegram.TELEGRAM_INSTRUCTIONS.includes("'가기로 했다'"));
  assert.ok(telegram.TELEGRAM_INSTRUCTIONS.includes("'가기로 함'"));
});

test('instructions that feed the outward weekly report keep their own style and do not get the rule', () => {
  const weekly = [['link_summary', handler.LINK_SUMMARY_INSTRUCTIONS], ['org_summary', org.ORG_SUMMARY_INSTRUCTIONS], ['library_fill', library.LIBRARY_FILL_INSTRUCTIONS], ['schedule_titles', schedule.SCHEDULE_TITLES_INSTRUCTIONS]];
  for (const [name, text] of weekly) {
    assert.ok(!text.includes(RULE), `${name}: weekly-report style stays`);
    assert.match(text, /명사형/, `${name}: still asks for the noun ending`);
  }
  assert.match(handler.LINK_SUMMARY_INSTRUCTIONS, /"~함"으로 끝내지 않는다/);
  assert.match(org.ORG_SUMMARY_INSTRUCTIONS, /"~함", "~임"으로 끝내지 않는다/);
  assert.match(library.LIBRARY_FILL_INSTRUCTIONS, /"~함", "~임"으로 끝내지 않는다/);
});

// 새 AI 지시문이 생기면 아래 목록에 '적용' 또는 '제외(이유)'로 올려야 한다. 말투를 빠뜨린 채 새 요약이 생기는 일을 막는다.
const APPLIED = new Set(['collector-feed/telegram.ts', 'ai-assist/ledger-auto.ts', 'ai-assist/ledger-candidates.ts', 'ai-assist/ledger-fix.ts', 'meeting-ai-draft/index.ts']);
const EXCLUDED = new Map([
  ['collector-feed/handler.ts', '부르기만 한다. 텔레그램 지시문은 telegram.ts(적용)에 있다'],
  ['ai-assist/handler.ts', '연결 요약(주간보고 업무보고형)·챙길 것·겹침 판정이 한 파일에 있다. 연결 요약은 주간보고 문체라 제외'],
  ['ai-assist/org-summary.ts', '주간보고 산하 조직 현황 요약 칸의 재료(주간보고 문체)'],
  ['ai-assist/library-fill.ts', '자료 한두 줄 요약은 주간보고 줄의 재료(주간보고 문체), 나머지 칸은 제목·값'],
  ['ai-assist/schedule-titles.ts', '주간보고 일정 제목(제목, 문장 아님)'],
  ['ai-assist/todo-radar.ts', '챙길 것 한 줄은 할 일 이름(명사형)이고 요약이 아님'],
  ['ai-assist/overlap.ts', '두 기록이 같은 활동인지 가리는 판정 이유 한 문장(요약이 아님)'],
  ['ai-assist/call-refill.ts', '통화 제목·조직·상대 칸 채우기(핵심내용 요약은 쓰지 않음)'],
  ['library-files/index.ts', '자료 제목 찾기(제목, 문장 아님)'],
  ['document-ai-index/index.ts', '검색용 색인 요약: 화면에 보이지 않고 AI 재료로만 쓰임. 화면에 보이게 되면 적용으로 옮길 것'],
  ['meeting-ai-ingest/index.ts', '문서에서 사실을 추출해 두는 재료 글(회의 요약 아님)'],
  ['page-ai-draft/index.ts', '현장 공유 페이지 초안(바깥에 내보내는 글)'],
  ['team-ai/index.ts', '대화 답변(요약 아님). 공식 보고 문안은 요청 시 -함/-임을 이미 우선함'],
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out); else if (/\.(ts|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

test('every server file that sends a developer/system instruction to the model is listed as applied or excluded', () => {
  const root = FUNCTIONS.pathname;
  const found = [];
  for (const file of walk(root)) {
    const rel = relative(root, file).split('\\').join('/');
    if (rel.startsWith('_shared/')) continue;
    const text = readFileSync(file, 'utf8');
    if (/role\s*:\s*['"](developer|system)['"]/.test(text) || /export const [A-Z_]+_INSTRUCTIONS\s*=/.test(text)) found.push(rel);
  }
  assert.ok(found.length >= 10, 'the scan finds the AI call sites');
  for (const rel of found) assert.ok(APPLIED.has(rel) || EXCLUDED.has(rel), `${rel} is a new AI instruction site: add it to APPLIED or EXCLUDED with a reason`);
  for (const rel of APPLIED) assert.ok(readFileSync(join(root, rel), 'utf8').includes('AI_TONE_RULE'), `${rel} uses the shared rule`);
  for (const rel of EXCLUDED.keys()) assert.ok(!readFileSync(join(root, rel), 'utf8').includes('AI_TONE_RULE'), `${rel} is excluded and must not use the rule`);
});

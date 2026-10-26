import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// UI-우클릭전수: app/context-menu.js가 우클릭으로 눌러 주는 ⋯ 버튼이 있는 파일의 목록. 새 파일이 ⋯ 버튼을 넣으면 이 시험이
// 실패해서, 그 화면을 tests/app-e2e/context-menu-all.spec.mjs(공통 검사)에서 확인하고 아래 목록에 더하도록 한다.
const KNOWN = [
  'basket-link-records.js', 'basket-notes.js', 'basket.js', 'calendar-day-overflow.js', 'call-feed.js', 'google-tasks.js',
  'journal-weekly.js', 'journal.js', 'ledger-browse.js', 'legacy/meeting-detail-patches.js', 'library-tree.js', 'library-upload.js',
  'meeting-columns.js', 'meeting-round-detail.js', 'org-dispute-stage-ui.js', 'photo-view.js', 'project-system-v3.js', 'reference-bundles.js',
  'share-pages.js', 'suborganizations.js', 'task-inline.js', 'task-row-view.js', 'task-workflow.js', 'telegram-feed.js', 'workplace-detail.js'
];
const app = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
const SKIP = new Set(['hwp-lab', 'markdown-lib', 'pdf-lib', 'editor-lib', 'node_modules']);
function walk(dir, base = '', out = []) {
  for (const e of readdirSync(dir, {withFileTypes: true})) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(join(dir, e.name), base + e.name + '/', out); }
    else if (e.name.endsWith('.js') || e.name.endsWith('.mjs')) out.push(base + e.name);
  }
  return out;
}
const code = text => text.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
// A ⋯ that is a button / summary label (">⋯<", "'⋯'", ">⋯</", a MORE constant), not a sentence that mentions ⋯.
const TRIGGER = />\s*[⋯⋮]\s*</;
const TRIGGER_JS = /(?:text:|textContent\s*=|,|=)\s*'[⋯⋮]'|MORE(?:_ICON)?\s*=\s*'<span[^']*>⋯/;

test('⋯ trigger files are all known (new ⋯ screens must join the right-click check)', () => {
  const found = walk(app).filter(f => { const t = code(readFileSync(join(app, f), 'utf8')); return TRIGGER.test(t) || TRIGGER_JS.test(t); }).sort();
  const unknown = found.filter(f => f !== 'context-menu.js' && !KNOWN.includes(f));
  assert.deepEqual(unknown, [], `새 ⋯ 버튼 파일: ${unknown.join(', ')} — tests/app-e2e/context-menu-all.spec.mjs에서 우클릭을 확인하고 KNOWN에 더하세요`);
});

test('data-ctx values are only area or off', () => {
  for (const f of walk(app)) {
    const t = code(readFileSync(join(app, f), 'utf8'));
    for (const m of t.matchAll(/data-ctx['"]?\s*[=:]\s*\\?["']([^"'\\]*)/g)) assert.ok(['area', 'off'].includes(m[1]), `${f}: data-ctx="${m[1]}"`);
  }
});

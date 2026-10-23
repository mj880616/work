import test from 'node:test';
import assert from 'node:assert/strict';
import {TOOLS, GROUPS, GROUP_KEYS, PHONE_ORDER, PHONE_LABELS} from '../app/md-toolbar-layout.mjs';
import {applyAction, PLAIN_ACTIONS} from '../app/md-editor-ops.mjs';
import {createGrouping} from '../app/toolbar-pop.js';

// MD-서식줄묶음: the phone's grouped row keeps every wide-screen button, once, in the agreed order.
test('phone row order is 제목 · 굵게 · 글자 · 문단 · 넣기 · 되돌리기 · 다시하기', () => {
  assert.deepEqual(PHONE_ORDER, ['heading-menu', 'bold', 'g-text', 'g-para', 'g-insert', 'undo', 'redo']);
  assert.deepEqual(GROUPS.map(g => g[1]), ['글자 ▾', '문단 ▾', '넣기 ▾']);
});
test('every wide-screen button is on the phone row or in exactly one group (none lost, none doubled)', () => {
  const all = TOOLS.map(t => t[1]);
  const onRow = PHONE_ORDER.filter(k => !GROUP_KEYS.includes(k));
  const inGroups = GROUPS.flatMap(g => g[3]);
  const phone = [...onRow, ...inGroups];
  assert.equal(new Set(phone).size, phone.length);
  assert.deepEqual([...phone].sort(), [...all].sort());
  for (const key of Object.keys(PHONE_LABELS)) assert.ok(all.includes(key), key);
});
test('a grouped button runs the same command the wide-screen button runs', () => {
  // The same nodes move between the row and the lists, so the action name is the command; each plain action is a known edit.
  for (const [, action] of TOOLS) {
    if (action.endsWith('-menu') || action === 'undo' || action === 'redo') continue;
    const r = applyAction('가나', 0, 2, action, null);
    assert.equal(typeof r.insert, 'string', action);
  }
  for (const a of PLAIN_ACTIONS) assert.ok(GROUPS.some(g => g[3].includes(a)), a);
});

// createGrouping moves the very same nodes (a fake row and lists stand in for the page).
const fakeParent = () => ({children: [], replaceChildren(...n) { this.children = n; }});
test('grouping moves the same nodes into the row and the lists, and back', () => {
  const tools = fakeParent(), panels = Object.fromEntries(GROUP_KEYS.map(k => [k, fakeParent()]));
  const buttons = Object.fromEntries([...TOOLS.map(t => t[1]), ...GROUP_KEYS].map(k => [k, {k}]));
  const home = TOOLS.map(t => buttons[t[1]]);
  const g = createGrouping({tools, home, order: PHONE_ORDER, groups: GROUPS, buttons, panels});
  g.group();
  assert.deepEqual(tools.children.map(b => b.k), PHONE_ORDER);
  assert.deepEqual(panels['g-para'].children.map(b => b.k), ['bullet', 'number', 'task', 'quote', 'rule']);
  assert.equal(panels['g-insert'].children[1], buttons['callout-menu']);
  g.ungroup();
  assert.deepEqual(tools.children, home);
  assert.deepEqual(panels['g-text'].children, []);
});

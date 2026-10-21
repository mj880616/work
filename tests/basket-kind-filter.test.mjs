import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { readBasket } from '../app/basket-data.js';
import { readTaskSourceNotes } from '../app/basket-note-tasks.js';
import { readClassificationSnapshot } from '../app/basket-classification.js';
import { readLinkRecords } from '../app/basket-link-records.js';
import { createBasketReader } from '../supabase/functions/drive-summary/basket-read.mjs';

// MEMO-노트 PR 2 filter-omission check: app_notes also holds note/work/diary rows after
// 20261017052234_journal_memo_notes_kind. Every basket-side read must ask for kind=basket.
const NOTE = {id:'note-row', workspace_id:'w', kind:'note', title:'합성 노트', raw_text:'NOTE_ROW', occurred_at:'2026-10-17T00:00:00Z', created_at:'2026-10-17T00:00:00Z', updated_at:'2026-10-17T00:00:00Z', archived_at:null, ai_export_allowed:true, attachments:[], metadata:{tasks:[{task_id:'t-note', task_list_id:'list', title:'노트 할 일', created_at:'2026-10-17T00:00:00Z'}]}};
const BASKET = {...NOTE, id:'basket-row', kind:'basket', title:null, raw_text:'BASKET_ROW', metadata:{tasks:[{task_id:'t-basket', task_list_id:'list', title:'바구니 할 일', created_at:'2026-10-17T00:00:00Z'}]}};
const DIARY = {...NOTE, id:'diary-row', kind:'diary', title:null, journal_day:'2026-10-17', raw_text:'DIARY_ROW', ai_export_allowed:false, metadata:{}};
const ROWS = [NOTE, BASKET, DIARY];

// Minimal PostgREST semantics for the filters these readers send. An omitted kind filter returns every kind.
function matches(row, params, prefix = '') {
  for (const [key, value] of params) {
    if (prefix ? !key.startsWith(prefix) : key.includes('.')) continue;
    const field = key.slice(prefix.length);
    if (!['kind', 'workspace_id', 'id'].includes(field)) continue;
    if (value.startsWith('eq.') && String(row[field]) !== value.slice(3)) return false;
    if (value.startsWith('in.(') && !value.slice(4, -1).split(',').includes(String(row[field]))) return false;
  }
  return true;
}
const rt = api => ({context:{read:()=>({workspace:{id:'w'}, user:{id:'u'}})}, session:{read:()=>({user:{id:'u'}})}, api});

test('basket list returns only kind=basket rows', async () => {
  const paths = [];
  const result = await readBasket(rt(async path => {
    paths.push(path); const u = new URL(path, 'http://x');
    if (u.pathname.endsWith('/app_record_links')) return [];
    return Number(u.searchParams.get('offset')) ? [] : ROWS.filter(r => matches(r, u.searchParams));
  }));
  assert.deepEqual(result.notes.map(n => n.id), ['basket-row']);
  assert.equal(new URL(paths[0], 'http://x').searchParams.get('kind'), 'eq.basket');
});

test('task source notes come from basket rows only', async () => {
  const map = await readTaskSourceNotes({rt:rt(async path => {
    const u = new URL(path, 'http://x');
    return ROWS.filter(r => matches(r, u.searchParams) && r.metadata.tasks).map(r => ({id:r.id, tasks:r.metadata.tasks}));
  })});
  assert.deepEqual([...map.entries()], [['t-basket', 'basket-row']]);
});

test('AI classification snapshot treats a note id as missing', async () => {
  const snapshot = await readClassificationSnapshot({items:[{note_id:'note-row'}, {note_id:'basket-row'}]}, rt(async path => {
    const u = new URL(path, 'http://x');
    return u.pathname.endsWith('/app_notes') ? ROWS.filter(r => matches(r, u.searchParams)) : [];
  }));
  assert.deepEqual(snapshot.notes.map(n => n.id), ['basket-row']);
});

test('linked records (project/organization screens) skip links whose source row is a note', async () => {
  const link = (id, note) => ({id, workspace_id:'w', summary:null, note_id:note.id, organization_id:'org', project_id:null, status:'confirmed', note:{id:note.id, workspace_id:'w', occurred_at:note.occurred_at, raw_text:note.raw_text}});
  const links = [[link('l-note', NOTE), NOTE], [link('l-basket', BASKET), BASKET]];
  const records = await readLinkRecords({kind:'organization', targetIds:['org']}, rt(async path => {
    const u = new URL(path, 'http://x');
    return links.filter(([, note]) => matches(note, u.searchParams, 'note.')).map(([l]) => l);
  }));
  assert.deepEqual(records.map(r => r.id), ['l-basket']);
});

test('drive-summary basket reader asks for kind=basket in header and recheck scans and never reads bodies', async () => {
  const calls = [];
  const fetcher = async url => {
    const u = new URL(url); calls.push(u);
    if (u.pathname.endsWith('/app_record_links')) return new Response('[]', {headers:{'Content-Range':'*/0'}});
    const fields = u.searchParams.get('select').split(',');
    const rows = ROWS.filter(r => matches(r, u.searchParams) && r.ai_export_allowed).map(r => Object.fromEntries(fields.map(f => f.split(':')[0]).map(k => [k, r[k] ?? (k === 'journal_at' ? r.metadata?.journal_at : undefined) ?? null])));
    return new Response(JSON.stringify(rows), {headers:{'Content-Range':rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0'}});
  };
  const reader = createBasketReader({fetcher, baseUrl:'https://db.example', headers:{}, workspaceId:'w', at:new Date('2026-10-18T00:00:00Z')});
  const snapshot = await reader.snapshot();
  assert.deepEqual([...snapshot.notes.keys()], ['basket-row']);
  assert.equal(reader.content, undefined);
  await reader.recheck(snapshot);
  const noteCalls = calls.filter(u => u.pathname.endsWith('/app_notes'));
  assert.equal(noteCalls.length, 2);
  assert.ok(noteCalls.every(u => !u.searchParams.get('select').split(',').includes('raw_text')));
  assert.ok(noteCalls.every(u => u.searchParams.get('kind') === 'eq.basket'));
});

// Static guard: any new app_notes list read in app/ must carry the kind filter. Single-row reads/writes
// by id (edit, delete, task write-back) and the create POST are not lists and stay kind-agnostic.
test('every app_notes list read in app/ carries a kind filter', () => {
  const offenders = [];
  for (const file of readdirSync('app').filter(f => /\.(?:m?js)$/.test(f))) {
    const source = readFileSync(`app/${file}`, 'utf8');
    for (const match of source.matchAll(/`[^`]*app_notes[^`]*`/g)) {
      const literal = match[0];
      if (/app_notes!inner/.test(literal)) continue; // embed projection; the filter sits on the query base below
      if (/\/rest\/v1\/app_record_links\?/.test(literal) && /note\.workspace_id=/.test(literal)) {
        if (!/note\.kind=eq\./.test(literal)) offenders.push(`${file}: ${literal.slice(0, 80)}`);
        continue;
      }
      if (!/\/rest\/v1\/app_notes\?/.test(literal)) continue;
      if (/[?&]id=eq\./.test(literal)) continue;
      if (!/[?&]kind=eq\./.test(literal)) offenders.push(`${file}: ${literal.slice(0, 80)}`);
    }
  }
  assert.deepEqual(offenders, []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// PRESS-자료실편입 2단계: 옛 성명·보도자료 가져오기 계획(48줄)·필드 매핑·겹침 건너뜀·원본 변환 3가지.
import {buildPlan, repoPathOf, pageFileName, splitByExisting, transformPressHtml, rawUrl, needsLock, PRESS_CATEGORY, OFF_LIST, ATTACHMENTS} from '../app/press-import-model.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const archive = JSON.parse(read('press/archive.json'));

test('real archive → 44 pages + 4 attachments = 48 rows, no errors, statement-checklist excluded', () => {
  const {plan, errors} = buildPlan(archive);
  assert.deepEqual(errors, []);
  assert.equal(archive.items.length, 42);
  assert.equal(plan.filter(r => r.kind === 'page').length, 44);
  assert.equal(plan.filter(r => r.kind === 'attachment').length, 4);
  assert.equal(plan.length, 48);
  assert.equal(new Set(plan.map(r => r.fileName)).size, 48, 'file names are unique keys');
  assert.ok(!plan.some(r => r.path.includes('statement-checklist')));
  for (const extra of OFF_LIST) assert.ok(plan.some(r => r.path === extra.path + 'index.html'), extra.folder);
  // Every source file the plan names exists in the repository.
  for (const r of plan) assert.doesNotThrow(() => readFileSync(new URL(`../${r.path}`, import.meta.url)), r.path);
  // Detail tags: 16/13/13 from the list + 1 request + 1 release off the list.
  const pages = plan.filter(r => r.kind === 'page');
  const count = label => pages.filter(r => r.fields.tags[0] === label).length;
  assert.deepEqual([count('취재요청'), count('보도자료'), count('성명')], [17, 14, 13]);
});

test('field mapping: title, date, publisher, kind and one detail tag; attachments copy the page fields', () => {
  const {plan} = buildPlan(archive);
  const page = plan.find(r => r.fileName === '2026-10-02-two-person-team-forum-followup.html');
  assert.deepEqual(page.fields, {title: '혼자 일하다 숨진 노동자 10년간 3,884명', category: PRESS_CATEGORY, source: '민주노총 공공운수노조', document_date: '2026-10-02', tags: ['보도자료']});
  assert.equal(page.path, 'press/2026-10-02-two-person-team-forum-followup/index.html');
  assert.equal(page.mime, 'text/html');
  const att = plan.find(r => r.fileName === ATTACHMENTS['2026-10-02-two-person-team-forum-followup']);
  assert.equal(att.kind, 'attachment');
  assert.equal(att.mime, 'application/pdf');
  assert.deepEqual(att.fields, page.fields);
  assert.equal(plan.find(r => r.fileName.endsWith('.hwp')).mime, 'application/x-hwp');
  // The one post outside press/: file only (Web1 page untouched), named <date>-<path>.html.
  const outside = plan.find(r => r.path.startsWith('workforce/'));
  assert.equal(outside.fileName, '2026-09-14-workforce-press-conference-0914-press-release.html');
  assert.equal(outside.fields.document_date, '2026-09-14');
});

test('href → repo path refuses anything that could leave the repository', () => {
  assert.equal(repoPathOf('./2026-10-02-x/'), 'press/2026-10-02-x/');
  assert.equal(repoPathOf('../workforce/a/b/'), 'workforce/a/b/');
  for (const bad of ['https://evil.example/x/', '/press/x/', './../../x/', './a b/', '', null, '../x/']) assert.equal(repoPathOf(bad), null, String(bad));
  assert.equal(pageFileName('press/2024-07-03-a/', '2024-07-03'), '2024-07-03-a.html');
  const {plan, errors} = buildPlan({items: [{href: 'https://evil.example/', date: '2026-01-01', title: 'x'}, {href: './2026-01-02-ok/', date: '2026-1-2', title: 'y'}]});
  assert.equal(errors.length, 2);
  assert.equal(plan.length, 2, 'only the two off-list posts');
});

test('overlap: an existing file_name is skipped, a second run uploads only what is missing', () => {
  const {plan} = buildPlan(archive);
  const docs = [{file_name: '2026-10-02-two-person-team-forum-followup.html'}, {file_name: ATTACHMENTS['2026-09-28-private-rail-forum-request']}, {file_name: '다른 자료.pdf'}];
  const first = splitByExisting(plan, docs);
  assert.equal(first.skipped.length, 2);
  assert.equal(first.todo.length, 46);
  const all = splitByExisting(plan, plan.map(r => ({file_name: r.fileName})));
  assert.deepEqual([all.todo.length, all.skipped.length], [0, 48]);
});

test('needsLock: only rows with the field_origin column whose four fields are not all user', () => {
  assert.equal(needsLock({}), false, 'column missing → never patch it');
  assert.equal(needsLock({field_origin: null}), true);
  assert.equal(needsLock({field_origin: {title: 'user', category: 'user', source: 'user', document_date: 'user', project_id: 'ai'}}), false);
  assert.equal(needsLock({field_origin: {title: 'user', category: 'ai'}}), true);
});

test('transform: exactly three changes — CSS link → <style>, logo → data: image, rich-copy script kept', () => {
  const css = read('press/press-archive.css'), logoSvg = read('assets/kptu-logo.svg');
  const original = read('press/2025-01-22-subway-fare/index.html');
  const {html, changes} = transformPressHtml(original, {css, logoSvg});
  assert.deepEqual(changes, {cssLinks: 1, logos: 1});
  assert.ok(!html.includes('press-archive.css'));
  assert.ok(html.includes(`<style>${css}</style>`));
  assert.ok(!html.includes('assets/kptu-logo.svg'));
  assert.match(html, /<img src="data:image\/svg\+xml,[^"]+" alt="민주노총 공공운수노조">/);
  assert.ok(html.includes('<script src="/work/assets/rich-copy.js"></script>'), 'rich-copy kept as is');
  // Nothing else changed: undo the two replacements and get the original back.
  const back = html.replace(`<style>${css}</style>`, '<link rel="stylesheet" href="/work/press/press-archive.css">').replace(/src="data:image\/svg\+xml,[^"]+"/, 'src="../../assets/kptu-logo.svg"');
  assert.equal(back, original);
  // A page without logo: only the stylesheet.
  assert.deepEqual(transformPressHtml(read('press/2024-09-04-public-rail-policy-conference/index.html'), {css, logoSvg}).changes, {cssLinks: 1, logos: 0});
  // A stylesheet cannot close the <style> early.
  assert.ok(!transformPressHtml('<link rel="stylesheet" href="/work/press/press-archive.css">', {css: 'a{}</style><script>x</script>'}).html.includes('</style><script>'));
});

test('every real page: at most one stylesheet replaced (43 of 44), logo in 2 pages, no external stylesheet left', () => {
  const css = read('press/press-archive.css'), logoSvg = read('assets/kptu-logo.svg');
  const {plan} = buildPlan(archive);
  let logos = 0, links = 0;
  for (const r of plan.filter(x => x.kind === 'page')) {
    const {html, changes} = transformPressHtml(read(r.path), {css, logoSvg});
    assert.ok(changes.cssLinks <= 1, r.path);
    links += changes.cssLinks;
    logos += changes.logos;
    assert.doesNotMatch(html, /<link[^>]+rel="stylesheet"/i, r.path);
    assert.ok(html.length <= 2 * 1024 * 1024, r.path);
  }
  assert.equal(links, 43, 'one page (2026-09-22) has its own styles only');
  assert.equal(logos, 2, 'two pages carry the logo image');
});

test('raw URLs encode Korean file names per segment', () => {
  assert.equal(rawUrl('press/a/한글.hwp'), 'https://raw.githubusercontent.com/mj880616/work/main/press/a/%ED%95%9C%EA%B8%80.hwp');
});

test('the import is wired once: owner-only button, library-files upload path, no AI fill, no browser storage', () => {
  const lib = read('app/library-upload.js'), run = read('app/press-import.js');
  assert.match(lib, /if\(luRole!=='owner'\)\{b\?\.remove\(\)/);
  assert.match(lib, /runPressImport\(\{api:luApi,upload:luUploadRequest,/);
  // Device storage names are built from parts so this test itself does not trip the browser-storage audit.
  const deviceStorage = new RegExp(['local', 'session'].map(x => x + 'Storage').concat('indexed' + 'DB').join('|'));
  assert.doesNotMatch(run, /fillLibraryDocument|ai-assist/);
  for (const source of [run, read('app/press-import-model.mjs'), read('app/library-html-view.js')]) assert.doesNotMatch(source, deviceStorage);
  assert.match(run, /documentCategories\(\)\.includes\(PRESS_CATEGORY\)/);
});

// ---- runPressImport with a fake server (no network, no real Supabase) ----
import {runPressImport, progressText, resultText} from '../app/press-import.js';
import {resetDocumentCategories} from '../app/document-categories.js';

function fakeWorld({categories = ['교섭', '성명·보도자료', '기타'], existing = [], uploadFail = null, withOrigin = true} = {}) {
  resetDocumentCategories();
  const calls = {uploads: [], patches: [], fetched: []};
  const docs = existing.map((d, i) => ({id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, ...d}));
  const rt = {context: {read: () => ({user: {id: 'u1'}})}, api: async () => [{document_categories: categories}]};
  const api = async (path, opts = {}) => {
    if (path.startsWith('/rest/v1/app_documents?workspace_id=')) return docs.map(d => ({...d}));
    if (opts.method === 'PATCH') { calls.patches.push({path, body: opts.body}); return null; }
    throw new Error('unexpected ' + path);
  };
  let n = 100;
  const upload = async (fd, file) => {
    const fields = Object.fromEntries([...fd.entries()].filter(([k]) => k !== 'file'));
    calls.uploads.push({name: file.name, type: file.type, fields, text: file.type === 'text/html' ? await file.text() : null});
    if (uploadFail && uploadFail(file.name)) throw Object.assign(new Error('boom'), {status: 500});
    const doc = {id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, file_name: file.name, category: fields.category};
    if (withOrigin) doc.field_origin = {};
    return {ok: true, document: doc};
  };
  const fetcher = async url => {
    calls.fetched.push(url);
    if (url === 'archive') return new Response(JSON.stringify(archive));
    const path = decodeURIComponent(url.replace('https://raw.githubusercontent.com/mj880616/work/main/', ''));
    return new Response(readFileSync(new URL(`../${path}`, import.meta.url)));
  };
  return {calls, deps: {rt, api, upload, fetcher, archiveUrl: 'archive', workspace: () => 'ws1', failure: e => ({stop: e?.status === 401, message: 'x'})}};
}

test('refuses to start when 성명·보도자료 is not in my kind list: nothing fetched or uploaded', async () => {
  const {calls, deps} = fakeWorld({categories: ['교섭', '기타']});
  const r = await runPressImport(deps);
  assert.equal(r.status, 'refused');
  assert.match(r.message, /성명·보도자료/);
  assert.deepEqual([calls.fetched.length, calls.uploads.length, calls.patches.length], [0, 0, 0]);
});

test('full run: 48 uploads with mapped fields (no AI), converted pages, 4 fields locked as user', async () => {
  const {calls, deps} = fakeWorld();
  const seen = [];
  const r = await runPressImport({...deps, onProgress: s => seen.push(progressText(s))});
  assert.equal(r.status, 'done');
  assert.deepEqual([r.done, r.skipped, r.locked, r.failed.length, r.total], [48, 0, 48, 0, 48]);
  const page = calls.uploads.find(u => u.name === '2025-01-22-subway-fare.html');
  assert.equal(page.type, 'text/html');
  assert.deepEqual(page.fields, {title: '교통불평등 심화하고, 기후정의 역행하는 수도권 지하철 요금인상 즉각 철회하라', category: '성명·보도자료', source: '전국공공운수사회서비스노조', document_date: '2025-01-22', tags: '성명'});
  assert.ok(!page.text.includes('press-archive.css') && page.text.includes('data:image/svg+xml,') && page.text.includes('rich-copy.js'));
  const hwp = calls.uploads.find(u => u.name.endsWith('.hwp'));
  assert.equal(hwp.type, 'application/x-hwp');
  assert.equal(calls.patches.length, 48);
  for (const p of calls.patches) {
    assert.deepEqual(p.body.field_origin, {title: 'user', source: 'user', category: 'user', document_date: 'user'});
    assert.equal(p.body.auto_classified, false);
    assert.deepEqual(Object.keys(p.body).sort(), ['auto_classified', 'field_origin', 'updated_at'], 'only the lock, never links');
    assert.match(p.path, /workspace_id=eq\.ws1$/);
  }
  assert.match(seen.at(-1), /^가져옴 48 · 건너뜀 0 · 실패 0 \(전체 48\)$/);
  assert.match(seen[1], /^가져오는 중 1\/48/);
  assert.match(resultText(r), /가져옴 48/);
});

test('second press: existing file names are skipped, only missing ones go up; a skipped import missing its lock is locked again', async () => {
  const {plan} = buildPlan(archive);
  const existing = plan.slice(0, 45).map((row, i) => ({file_name: row.fileName, category: PRESS_CATEGORY, field_origin: i === 0 ? {} : {title: 'user', category: 'user', source: 'user', document_date: 'user'}}));
  existing.push({file_name: plan[45].fileName, category: '교섭', field_origin: {}}); // same name, someone else's kind: skipped, not locked
  const {calls, deps} = fakeWorld({existing});
  const r = await runPressImport(deps);
  assert.deepEqual([r.done, r.skipped, r.locked], [2, 46, 3]);
  assert.deepEqual(calls.uploads.map(u => u.name), plan.slice(46).map(x => x.fileName));
});

test('a failed upload is listed and the rest continue; a stop failure (session) halts', async () => {
  const one = fakeWorld({uploadFail: name => name === '2024-07-03-seoulmetro-ilo-forum.html'});
  const r = await runPressImport(one.deps);
  assert.deepEqual([r.status, r.done, r.failed.length], ['done', 47, 1]);
  assert.equal(r.failed[0].name, '2024-07-03-seoulmetro-ilo-forum.html');
  const halt = fakeWorld({uploadFail: () => true});
  const deps = {...halt.deps, upload: async () => { throw Object.assign(new Error('401'), {status: 401}); }};
  const s = await runPressImport(deps);
  assert.deepEqual([s.status, s.done, s.failed.length], ['stopped', 0, 1]);
});

test('no field_origin column (DB before LIB-AI): uploads but sends no lock patch', async () => {
  const {calls, deps} = fakeWorld({withOrigin: false});
  const r = await runPressImport(deps);
  assert.deepEqual([r.done, r.locked, calls.patches.length], [48, 0, 0]);
});

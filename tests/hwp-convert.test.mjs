import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {
  DOC_TYPES,CONVERT_MAX_CHARS,levelLabel,numberBlocks,convertAnswer,buildPlan,convertedFileName,planDate,dropProblem,textState,cleanPasted,
} from '../app/hwp-convert-model.mjs';
import {pickConvertTemplate,saveConvertedCopy,UNION_TEMPLATE_CATEGORY} from '../app/hwp-drive.js';
import {requestEngineBuild} from '../app/hwp-convert.js';
import {exposeEngine,ENGINE_MARK} from '../scripts/hwp-lab/expose-engine.mjs';
// HWP-서식변환: 번호 기호·스타일 대응, 문서 종류별 양식 고르기, 만든 문서 저장, 편집기 안 채우기(가짜 엔진), 엔진 노출 한 줄.

test('numbers follow 1. → 1) → (1) → ① → 가. → 가) → (가) and restart under a higher level', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((level) => levelLabel(level, 1)), ['1.', '1)', '(1)', '①', '가.', '가)', '(가)']);
  assert.equal(levelLabel(5, 15), '15.');
  assert.equal(levelLabel(6, 15), '15)');
  assert.equal(levelLabel(4, 51), '51.');
  const out = numberBlocks([
    {kind: 'l1', text: '추진 배경'}, {kind: 'l2', text: '현황'}, {kind: 'l3', text: '세부'}, {kind: 'l4', text: '내용'}, {kind: 'l5', text: '가'}, {kind: 'l5', text: '나'},
    {kind: 'body', text: '설명 문단'}, {kind: 'note', text: '※ 참고'}, {kind: 'l2', text: '추진 계획'}, {kind: 'l1', text: '결과'}, {kind: 'l2', text: '정리'},
  ]);
  assert.deepEqual(out.map((row) => row.text), ['1. 추진 배경', '1) 현황', '(1) 세부', '① 내용', '가. 가', '나. 나', '설명 문단', '* 참고', '2) 추진 계획', '2. 결과', '1) 정리']);
  assert.deepEqual(out.map((row) => row.style), ['큰 제목', '중간 제목', '작은 제목', '최하위 제목[강조]', '바탕글', '바탕글', '바탕글', '세부 참고사항', '중간 제목', '큰 제목', '중간 제목']);
});

test('the server answer is checked again; wrong paragraphs are dropped and counted', () => {
  const good = {ok: true, kind: 'hwp_convert', doc_type: 'report', title: ' 가상  제목 ', dropped: 1, blocks: [{kind: 'l1', text: '대주제'}, {kind: 'l9', text: '버림'}, {kind: 'body', text: ''}, {kind: 'l2', text: '<b>'}, {kind: 'body', text: '본문'}]};
  assert.deepEqual(convertAnswer(good), {title: '가상 제목', blocks: [{kind: 'l1', text: '대주제'}, {kind: 'body', text: '본문'}], dropped: 4});
  assert.equal(convertAnswer({...good, ok: false}), null);
  assert.equal(convertAnswer({...good, kind: 'x'}), null);
  assert.equal(convertAnswer({...good, title: ''}), null);
  assert.equal(convertAnswer({...good, blocks: []}), null);
  assert.equal(convertAnswer({...good, blocks: [{kind: 'l1', text: '가'.repeat(601)}]}), null);
  assert.equal(convertAnswer(null), null);
});

test('plan, date and file name: 보고서_1027.hwp, title kept apart from the paragraphs', () => {
  const now = new Date(2026, 9, 27, 17, 3);
  assert.equal(planDate(now), '2026. 10. 27.');
  assert.equal(convertedFileName('report', now), '보고서_1027.hwp');
  assert.equal(convertedFileName('letter', new Date(2026, 0, 5)), '공문_0105.hwp');
  assert.equal(convertedFileName('meeting', now), '회의자료_1027.hwp');
  assert.deepEqual(DOC_TYPES.map((row) => row.id), ['report', 'letter', 'meeting']);
  const plan = buildPlan({title: '가상 보고', blocks: [{kind: 'l1', text: '배경'}]}, now);
  assert.deepEqual(plan, {title: '가상 보고', date: '2026. 10. 27.', paragraphs: [{text: '1. 배경', style: '큰 제목'}]});
});

test('pasted text and dropped files: only text files, size and length limits, BOM and line ends cleaned', () => {
  assert.equal(dropProblem({name: '회의.md', size: 10, type: ''}), '');
  assert.equal(dropProblem({name: 'a.txt', size: 10, type: 'text/plain'}), '');
  assert.match(dropProblem({name: 'a.hwp', size: 10, type: ''}), /글 파일/);
  assert.match(dropProblem({name: 'a.md', size: 2 * 1024 * 1024, type: ''}), /너무 커요/);
  assert.ok(dropProblem(null));
  assert.equal(cleanPasted('﻿a\r\nb\rc'), 'a\nb\nc');
  assert.equal(textState('  \n ').empty, true);
  assert.equal(textState('가'.repeat(CONVERT_MAX_CHARS)).tooLong, false);
  assert.equal(textState('가'.repeat(CONVERT_MAX_CHARS + 1)).tooLong, true);
});

test('the form for a document type is the library 양식 .hwp whose name has the type word; else a general one; never another type', () => {
  const row = (id, title, file_name = id + '.hwp', category = UNION_TEMPLATE_CATEGORY) => ({id, title, file_name, category});
  const rows = [row('r', '노조 보고서 양식'), row('l', '노조 공문 양식'), row('m', '회의자료 양식'), row('g', '노조 문서 양식'), row('x', '보고서 틀', 'x.pdf'), row('y', '회의 보고서', 'y.hwp', '회의')];
  assert.deepEqual([pickConvertTemplate(rows, 'report').chosen.id, pickConvertTemplate(rows, 'report').specific], ['r', true]);
  assert.equal(pickConvertTemplate(rows, 'letter').chosen.id, 'l');
  assert.equal(pickConvertTemplate(rows, 'meeting').chosen.id, 'm');
  // No form for the type: the general one, flagged as not specific.
  const only = [row('r', '노조 보고서 양식'), row('g', '노조 문서 양식')];
  assert.deepEqual([pickConvertTemplate(only, 'letter').chosen.id, pickConvertTemplate(only, 'letter').specific], ['g', false]);
  // Only other types' forms: nothing is picked (a 공문 never goes into a 보고서 form).
  assert.equal(pickConvertTemplate([row('r', '노조 보고서 양식')], 'letter').chosen, null);
  assert.equal(pickConvertTemplate([], 'report').chosen, null);
  assert.equal(pickConvertTemplate(null, 'report').chosen, null);
});

test('saving a made document sends the file and the title only, no category, one request', async () => {
  const sent = [];
  const fetcher = async (url, init) => { sent.push({url, form: init.body}); return {ok: true, status: 200, json: async () => ({ok: true, document: {id: 'new1', title: '가상 보고'}})}; };
  const rt = {config: {url: 'https://x.test', key: 'k'}, session: {ensure: async () => true, read: () => ({access_token: 't'})}};
  const out = await saveConvertedCopy(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]), {fileName: '보고서_1027.hwp', title: '가상 보고'}, {rt, fetcher});
  assert.equal(out.kind, 'created');
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /\/functions\/v1\/library-files$/);
  assert.deepEqual([...sent[0].form.keys()].sort(), ['file', 'title']);
  assert.equal(sent[0].form.get('file').name, '보고서_1027.hwp');
  assert.equal(sent[0].form.get('title'), '가상 보고');
  // A refusal or an unknown result is reported, never retried here.
  const refused = await saveConvertedCopy(new Uint8Array([1]), {fileName: 'a.hwp', title: 't'}, {rt, fetcher: async () => ({ok: false, status: 400, json: async () => ({error: 'x'})})});
  assert.equal(refused.kind, 'refused');
  const unknown = await saveConvertedCopy(new Uint8Array([1]), {fileName: 'a.hwp', title: 't'}, {rt, fetcher: async () => { throw new Error('net'); }});
  assert.equal(unknown.kind, 'unknown');
});

// ---- 편집기 안 보조 스크립트(studio-convert.js)를 가짜 엔진으로 돌린다 ----
const script = readFileSync(new URL('../app/hwp-lab/studio-convert.js', import.meta.url), 'utf8');
function load(Doc) {
  const listeners = [], posted = [];
  const parent = {postMessage: (msg) => posted.push(msg)};
  const win = {addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); }, parent, rhwpStudio: Doc ? {engine: {Document: Doc}} : {}};
  win.window = win;
  vm.runInContext(script, vm.createContext({window: win, Uint8Array, Error, Number, Array, String, Map, Set, JSON, Object, Math, Promise}));
  return {win, posted, parent, send: (data, source = parent) => listeners.forEach((fn) => fn({data, source}))};
}
// 문단 목록만 흉내 내는 가짜 문서: 엔진의 호출 순서와 값을 기록한다.
function fakeDocClass({styles, fields = [], paragraphs = [''], failAt = ''}) {
  const calls = [];
  class Doc {
    constructor(bytes) { this.p = paragraphs.map((text) => ({text, style: null})); this.fields = new Map(); calls.push(['new', bytes.length]); Doc.last = this; }
    convertToEditable() { calls.push(['convertToEditable']); }
    getStyleList() { return JSON.stringify(styles); }
    getFieldList() { return JSON.stringify(fields); }
    setFieldValueByName(name, value) { if (failAt === 'field') throw new Error('x'); this.fields.set(name, value); return '{"ok":true}'; }
    getSectionCount() { return 1; }
    getParagraphCount() { return this.p.length; }
    getParagraphLength(sec, para) { return this.p[para].text.length; }
    splitParagraph(sec, para, off) { calls.push(['split', para, off]); this.p.splice(para + 1, 0, {text: '', style: this.p[para].style}); return '{"ok":true}'; }
    insertText(sec, para, off, text) { if (failAt === 'insert') throw new Error('x'); this.p[para].text = this.p[para].text.slice(0, off) + text + this.p[para].text.slice(off); return '{"ok":true}'; }
    applyStyle(sec, para, id) { this.p[para].style = id; return '{"ok":true}'; }
    exportHwp() { return failAt === 'export' ? new Uint8Array(0) : new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]); }
    free() { calls.push(['free']); }
  }
  Doc.calls = calls;
  return Doc;
}
const STYLES = [{id: 0, name: '바탕글'}, {id: 3, name: '안건제목'}, {id: 4, name: '큰 제목'}, {id: 5, name: '중간 제목'}, {id: 9, name: '세부 참고사항'}];
const PLAN = {title: '가상 보고', date: '2026. 10. 27.', paragraphs: [{text: '1. 배경', style: '큰 제목'}, {text: '1) 현황', style: '중간 제목'}, {text: '* 참고', style: '세부 참고사항'}, {text: '가. 세부', style: '바탕글'}]};
const BASE = new Uint8Array([1, 2, 3]);
// 가상 실행 영역에서 만든 배열은 다른 영역의 것이라 값만 견준다.
const plain = (value) => JSON.parse(JSON.stringify(value));

test('the template is filled after its last paragraph: title first, styles by name, the empty first paragraph reused, then read back', () => {
  const Doc = fakeDocClass({styles: STYLES});
  const page = load(Doc);
  page.send({type: 'web2-hwp-convert', id: 'a1', base: BASE, plan: PLAN});
  assert.equal(page.posted.length, 1);
  const reply = page.posted[0];
  assert.equal(reply.type, 'web2-hwp-convert-result');
  assert.equal(reply.id, 'a1');
  assert.equal(reply.ok, true);
  assert.deepEqual([...reply.bytes], [0xd0, 0xcf, 0x11, 0xe0]);
  assert.deepEqual(plain(reply.filled), []);
  assert.deepEqual(plain(reply.missing), []);
  assert.equal(reply.inserted, 5);
  assert.deepEqual(plain(Doc.last.p.map((p) => [p.text, p.style])), [['가상 보고', 3], ['1. 배경', 4], ['1) 현황', 5], ['* 참고', 9], ['가. 세부', 0]]);
  // The first (empty) paragraph is used as it is: 4 splits for 5 paragraphs. The document is always freed.
  assert.equal(Doc.calls.filter((c) => c[0] === 'split').length, 4);
  assert.deepEqual(plain(Doc.calls.at(-1)), ['free']);
});

test('a template with text already in it keeps it; new paragraphs follow the last one', () => {
  const Doc = fakeDocClass({styles: STYLES, paragraphs: ['머리말 글', '마지막 문단']});
  const page = load(Doc);
  page.send({type: 'web2-hwp-convert', id: 'a2', base: BASE, plan: PLAN});
  assert.equal(page.posted[0].ok, true);
  assert.deepEqual(plain(Doc.last.p.slice(0, 2).map((p) => p.text)), ['머리말 글', '마지막 문단']);
  assert.equal(Doc.last.p[2].text, '가상 보고');
  assert.equal(Doc.last.p.length, 7);
});

test('title and date 누름틀 are filled when the template has them; the title paragraph is then not added', () => {
  const Doc = fakeDocClass({styles: STYLES, fields: [{name: '제목'}, {name: '날짜'}, {name: '담당'}, {name: '제목'}]});
  const page = load(Doc);
  page.send({type: 'web2-hwp-convert', id: 'a3', base: BASE, plan: PLAN});
  const reply = page.posted[0];
  assert.deepEqual(plain(reply.filled), ['제목', '날짜']);
  assert.deepEqual(plain([...Doc.last.fields]), [['제목', '가상 보고'], ['날짜', '2026. 10. 27.']]);
  assert.equal(reply.inserted, 4);
  assert.equal(Doc.last.p[0].text, '1. 배경');
});

test('a style the template lacks falls back to 바탕글 and is reported', () => {
  const Doc = fakeDocClass({styles: [{id: 0, name: '바탕글'}, {id: 4, name: '큰 제목'}]});
  const page = load(Doc);
  page.send({type: 'web2-hwp-convert', id: 'a4', base: BASE, plan: PLAN});
  const reply = page.posted[0];
  assert.equal(reply.ok, true);
  assert.deepEqual(plain(reply.missing).sort(), ['세부 참고사항', '안건제목', '중간 제목']);
  assert.deepEqual(plain(Doc.last.p.map((p) => p.style)), [0, 4, 0, 0, 0]);
});

test('failures answer with a code only (never the text), always free the document; strangers and bad requests are ignored or refused', () => {
  for (const failAt of ['insert', 'export']) {
    const Doc = fakeDocClass({styles: STYLES, failAt});
    const page = load(Doc);
    page.send({type: 'web2-hwp-convert', id: 'f', base: BASE, plan: PLAN});
    assert.equal(page.posted[0].ok, false);
    assert.ok(!JSON.stringify(page.posted[0]).includes('가상'));
    assert.deepEqual(plain(Doc.calls.at(-1)), ['free']);
  }
  {const page = load(null); page.send({type: 'web2-hwp-convert', id: 'n', base: BASE, plan: PLAN}); assert.equal(page.posted[0].code, 'no_engine');}
  {const page = load(fakeDocClass({styles: STYLES}));
   page.send({type: 'web2-hwp-convert', id: 'x', base: BASE, plan: PLAN}, {postMessage() {}});
   assert.equal(page.posted.length, 0, 'only the parent window is answered');
   page.send({type: 'other', id: 'x'});
   page.send({type: 'web2-hwp-convert', id: 'y', base: BASE, plan: {...PLAN, paragraphs: []}});
   page.send({type: 'web2-hwp-convert', id: 'z', base: new Uint8Array(0), plan: PLAN});
   page.send({type: 'web2-hwp-convert', id: 'w', base: BASE, plan: {...PLAN, paragraphs: [{text: '가'.repeat(2001), style: '바탕글'}]}});
   assert.deepEqual(plain(page.posted.map((m) => [m.id, m.code])), [['y', 'bad_request'], ['z', 'bad_request'], ['w', 'bad_request']]);}
});

test('the page side waits for the frame\'s answer only, once, and gives up after the time limit', async () => {
  const listeners = new Set();
  const host = {addEventListener: (t, fn) => listeners.add(fn), removeEventListener: (t, fn) => listeners.delete(fn)};
  const frame = {postMessage(msg) { this.sent = msg; }};
  const pending = requestEngineBuild(frame, BASE, PLAN, {host, timeoutMs: 1000});
  const id = frame.sent.id;
  assert.equal(frame.sent.type, 'web2-hwp-convert');
  for (const fn of listeners) fn({source: {}, data: {type: 'web2-hwp-convert-result', id, ok: true, bytes: new Uint8Array([9])}});
  assert.equal(listeners.size, 1, 'an answer from another window is ignored');
  for (const fn of listeners) fn({source: frame, data: {type: 'web2-hwp-convert-result', id, ok: true, bytes: new Uint8Array([9, 8]), filled: ['제목'], missing: [], inserted: 3}});
  const done = await pending;
  assert.deepEqual([...done.bytes], [9, 8]);
  assert.equal(done.inserted, 3);
  assert.equal(listeners.size, 0);
  const refused = requestEngineBuild(frame, BASE, PLAN, {host, timeoutMs: 1000});
  for (const fn of listeners) fn({source: frame, data: {type: 'web2-hwp-convert-result', id: frame.sent.id, ok: false, code: 'paragraph_count'}});
  await assert.rejects(refused, (err) => err.kind === 'engine' && err.code === 'paragraph_count');
  await assert.rejects(requestEngineBuild(frame, BASE, PLAN, {host, timeoutMs: 5}), (err) => err.code === 'timeout');
  assert.equal(listeners.size, 0);
});

// ---- 엔진 클래스 노출 한 줄 ----
test('exposeEngine adds one getter after the automation line and refuses a bundle it cannot place', () => {
  const js = 'var Pn=class{};class B{x(){this.doc||=Pn.createEmpty()}}window.rhwpStudio.automation=zN;async function BN(){}';
  const out = exposeEngine(js);
  assert.ok(out.includes(`window.rhwpStudio.automation=zN;${ENGINE_MARK}{get Document(){return Pn}};async function BN`));
  assert.equal(exposeEngine(out), out, 'adding twice changes nothing');
  assert.throws(() => exposeEngine('nothing to find'), /찾지 못했습니다/);
  assert.throws(() => exposeEngine('window.rhwpStudio.automation=zN;'), /찾지 못했습니다/);
});

test('the vendored editor has the engine line, loads studio-convert.js after the guard, and the build script puts both there', () => {
  const dir = 'app/hwp-lab/rhwp-0.8.7/studio/';
  const bundle = readFileSync(dir + 'assets/index-oVYSsgk_.js', 'utf8');
  assert.equal(bundle.split(ENGINE_MARK).length, 2);
  assert.match(bundle, /window\.rhwpStudio\.automation=[\w$]+;window\.rhwpStudio\.engine=\{get Document\(\)\{return [\w$]+\}\};/);
  const html = readFileSync(dir + 'index.html', 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(scripts.slice(0, 3), ['../../studio-guard.js', '../../studio-styles.js', '../../studio-convert.js']);
  const finalize = readFileSync('scripts/hwp-lab/finalize-rhwp-studio.mjs', 'utf8');
  assert.match(finalize, /expose-engine\.mjs/);
  assert.match(finalize, /studio-convert\.js/);
  // The helper script reads no network or device storage and does not touch the editor's own state.
  const helper = script.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(helper, /\bfetch\(|XMLHttpRequest|WebSocket|importScripts|eval\(|new Function|document\./);
});

test('the screen wires the button, the dialog and the top line', () => {
  const html = readFileSync('app/index.html', 'utf8');
  assert.match(html, /<button id="hwpLabConvert" class="secondary" type="button">노조 서식으로 만들기<\/button>/);
  const lab = readFileSync('app/hwp-lab.js', 'utf8');
  assert.match(lab, /'hwpLabConvert'/);
  assert.match(lab, /id="hwpConvDownload"[^>]*>내려받기</);
  assert.match(lab, /id="hwpConvLibrary"[^>]*>자료실에 저장</);
  const dialog = readFileSync('app/hwp-convert.js', 'utf8');
  // 오른쪽 아래 [취소][만들기] in that order, chips for the three types.
  assert.ok(dialog.indexOf('data-hwp-convert-cancel>취소') < dialog.indexOf('data-hwp-convert-make>만들기'));
  assert.deepEqual(DOC_TYPES.map((row) => row.label), ['보고서', '공문', '회의자료']);
  assert.doesNotMatch(dialog + lab, /\bfetch\(/, 'the dialog and lab reach the server only through callAiAssist and hwp-drive.js');
});

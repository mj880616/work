// RECORD-보고용글잘림(요청함 11/10 ★급★): 명진이 직접 쓴 보고용 글(report_body)은 60자 한 줄 규칙으로 자르지 않는다.
// 표 줄·[보고용으로 수정] 칸·복사·한글 파일·확정 사진이 모두 글 전체를 쓴다. 이름·글은 모두 가짜.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as M from '../app/record-window-model.mjs';
import * as D from '../app/biz-detail-model.mjs';
import {bizRecordItem} from '../app/business-now-model.mjs';
import {oneLine, ONE_LINE_MAX} from '../app/record-oneline.mjs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const W = '2026-11-09', ORG = 'aaaaaaaa-0000-4000-8000-000000000001';
const RAW = `${'가나다라마바사 아자차카타파하 '.repeat(8)}끝부분 원문.`;
const LONG = `보고용으로 길게 고친 글입니다. ${'지부 교섭 진행 상황과 다음 일정을 자세히 적습니다. '.repeat(4)}마지막 문장까지 그대로.`;
const item = M.recordItem({id: 'u1', organization_id: ORG, raw_text: RAW, occurred_at: `${W}T12:00:00+09:00`, created_at: '2026-11-09T00:00:00Z'});
const markRow = (report_body, x = {}) => ({id: 'm1', week_start: W, section: 'org', ref_kind: 'org_update', ref_key: 'u1', report_body, choice: null, detail: null, ...x});

test('보고용 글은 60자보다 길어도 표 줄에 끝까지(…로 자르지 않음)', () => {
  assert.ok([...LONG].length > ONE_LINE_MAX * 2);
  const line = M.orgCell({org: ORG, week: W, records: [item], marks: [markRow(LONG)]}).shown[0];
  assert.equal(line.text, LONG);
  assert.equal(line.edited, true);
  assert.ok(!line.text.endsWith('…'));
  assert.equal(M.lineText(line), `- 11.9. ${LONG}`);
  // 3. 2) 투쟁 사업장 칸도 같은 규칙
  const site = M.siteCell({org: ORG, week: W, records: [item], marks: [markRow(LONG, {section: 'site'})]}).shown[0];
  assert.equal(site.text, LONG);
});

test('보고용 글의 줄바꿈은 표·복사에서 한 칸 띄어쓰기, 고치기 칸에는 원래 모양 그대로', () => {
  const body = `첫 줄 보고용 글\n${'둘째 줄 이어지는 긴 글 '.repeat(6)}끝`;
  const line = M.orgCell({org: ORG, week: W, records: [item], marks: [markRow(body)]}).shown[0];
  assert.equal(line.text, M.cleanBody(body));
  assert.equal(M.editBase(line), body);
});

test('[보고용으로 수정] 칸: 보고용 글 전체, 없으면 원문 전체(…로 잘린 한 줄은 넣지 않음)', () => {
  const plain = M.orgCell({org: ORG, week: W, records: [item]}).shown[0];
  assert.ok(plain.text.endsWith('…'));          // 표에는 원문 한 줄
  assert.equal(M.editBase(plain), RAW.trim());   // 칸에는 원문 전체
  assert.ok(!M.editBase(plain).endsWith('…'));
  const edited = M.orgCell({org: ORG, week: W, records: [item], marks: [markRow(LONG)]}).shown[0];
  assert.equal(M.editBase(edited), LONG);
  // 원문이 없는 줄(일정)은 줄 글
  assert.equal(M.editBase({kind: 'event', text: '지부 대의원대회', orig: '지부 대의원대회'}), '지부 대의원대회');
});

test('[저장]: 고치지 않고 저장하면 표시 지움(null), 고친 글은 전체 그대로, 다시 열면 전체', () => {
  const plain = M.orgCell({org: ORG, week: W, records: [item]}).shown[0];
  assert.deepEqual(M.reportChange(plain, undefined), {ok: true, value: null});
  assert.deepEqual(M.reportChange(plain, `${RAW}\n`), {ok: true, value: null});
  assert.deepEqual(M.reportChange(plain, LONG), {ok: true, value: LONG});
  // 저장 → 다시 열기 → 그대로 저장해도 뒷부분이 사라지지 않는다
  const again = M.orgCell({org: ORG, week: W, records: [item], marks: [markRow(LONG)]}).shown[0];
  const draft = M.editBase(again);
  const v = M.reportChange(again, draft);
  assert.equal(v.ok, true);
  assert.ok(v.value === LONG || v.value === null);
  const next = M.nextMark([markRow(LONG)], {section: 'org', kind: 'org_update', key: 'u1', week: W}, {report_body: v.value ?? LONG});
  assert.deepEqual(next, {op: 'none'});
  // 원래 한 줄로 되돌린 글은 표시 지움
  assert.deepEqual(M.reportChange(again, again.orig), {ok: true, value: null});
  assert.equal(M.reportChange(again, '').ok, false);
});

test('예전에 원문을 통째로 저장한 보고용 글(원문과 같은 글)은 원문 한 줄 규칙 그대로', () => {
  const line = M.orgCell({org: ORG, week: W, records: [item], marks: [markRow(RAW.trim())]}).shown[0];
  assert.equal(line.text, oneLine(RAW));
  assert.equal(M.editBase(line), RAW.trim());
});

test('확정 사진: 그 줄 보고용 글이 있으면 사진 글(예전에 잘려 저장된 한 줄 포함)을 글 전체로', () => {
  const snap = t => ({confirmed_at: '2026-11-12T00:00:00Z', rows: [{section: 'org', ref_kind: 'organization', ref_key: ORG, lines: [{ref_kind: 'org_update', ref_key: 'u1', day: W, end_day: null, text: t}], seen_events: []}]});
  const marks = [markRow(LONG)];
  for (const t of [LONG, oneLine(LONG)]) {
    const v = M.snapshotView({org: ORG, week: W, snapshot: snap(t), records: [item], marks});
    assert.equal(v.lines[0].text, LONG);
  }
  // 보고용 글이 없는 줄은 원문 한 줄 그대로
  assert.equal(M.snapshotView({org: ORG, week: W, snapshot: snap(RAW), records: [item], marks: []}).lines[0].text, oneLine(RAW));
  // 확정 사진에 넣는 글도 전체
  const line = M.orgCell({org: ORG, week: W, records: [item], marks}).shown[0];
  assert.equal(M.snapshotRow({org: ORG, lines: [line]}).lines[0].text, LONG);
});

test('주요 사업(2. 2) 창도 보고용 글 전체 — 표·복사·한글 파일·확정 사진', () => {
  const rec = bizRecordItem({id: 'b1', space_id: 'sp1', day: W, body: RAW, source_kind: 'user'});
  const mk = {id: 'k1', week_start: W, section: 'biz_detail', ref_kind: 'biz_record', ref_key: 'b1', report_body: LONG, choice: null, detail: null};
  const line = D.lineOf(rec, mk);
  assert.equal(line.text, LONG);
  assert.equal(D.lineText(line), `- 11.9. ${LONG}`);
  assert.deepEqual(D.fileLinesOf(line), [`- 11.9. ${LONG}`]);
  assert.equal(D.editBase(line), LONG);
  const plain = D.lineOf(rec, null);
  assert.ok(plain.text.endsWith('…'));
  assert.equal(D.editBase(plain), RAW.trim());
  assert.deepEqual(D.reportChange(plain, undefined), {ok: true, value: null});
});

test('화면 연결: 고치기 칸·저장이 잘린 줄 글(l.text) 대신 editBase·reportChange를 쓴다', () => {
  for (const [file, ns] of [['app/record-window-view.js', 'M'], ['app/biz-detail-window.js', 'D']]) {
    const src = read(file);
    assert.ok(!src.includes('ctl.draft = {body: l.text}'), file);
    assert.ok(!src.includes('d.body ?? l.text'), file);
    assert.ok(src.includes(`d.body ?? ${ns}.editBase(l)`), file);
    assert.ok(src.includes(`ctl.draft = {body: ${ns}.editBase(l)}`), file);
    assert.ok(src.includes(`${ns}.reportChange(hit.line, ctl.draft?.body)`), file);
  }
});

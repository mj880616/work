import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {zlib, SAMPLE} from '../../scripts/weekly-hwpx/cli.mjs';
import {makeFakeReport} from '../../scripts/weekly-hwpx/fixture.mjs';
import {openHwpx, packHwpx} from '../../app/weekly-hwpx/hwpx.mjs';
import {prepareConfirmed, openConfirmed, startDraft, editableRows, assembleDraft, buildHwpx, issuedFrom} from '../../app/weekly-hwpx/draft.mjs';
import {weeklyLines, sectionXmlText, squashLine} from '../../app/weekly-lines.mjs';
import {hwpxSectionText, hwpxText} from '../../supabase/functions/_shared/document-text.ts';

// WEEKLY-개인본대조 W-2: 앱(받은 초안 기록)과 Edge(자료실 개인본 읽기, W-3)가 같은 줄 나누기를 쓰는지 지키는 시험. 글은 모두 지어낸 것.
const p = t => `<hp:p><hp:run><hp:t>${t}</hp:t></hp:run></hp:p>`;
const xmlOf = lines => `<hs:sec>${lines.map(p).join('')}</hs:sec>`;
const FILE = ['주간 업무 보고', '1. 요청사항', '일', '10/28 가상 결의대회 참석 요청', '2) 주요 일정', '10/29 일정 표 줄', '2. 기본․영역․의제 사업', '1) 요약', '사업영역', '가상 영역', '가 지부 임금교섭 준비 중', '5. 주요 일정', '10/30 일정 표 줄'];

test('앱의 줄 나누기 모듈은 Edge 공용 사본과 바이트까지 같다(org-name-match.mjs 와 같은 방식)', () => {
  assert.deepEqual(readFileSync('app/weekly-lines.mjs'), readFileSync('supabase/functions/_shared/weekly-lines.mjs'));
});

test('본문 XML 글자 읽기는 서버(_shared/document-text.ts hwpxSectionText)와 같은 글이 나온다', () => {
  const xml = `<hs:sec>${[
    '<hp:p><hp:run><hp:t>가&amp;나 &lt;다&gt; &#xAC00;&#44032;</hp:t></hp:run><hp:run><hp:t><hp:tab width="1"/>둘째 조각</hp:t></hp:run></hp:p>',
    '<hp:p><hp:run><hp:t attr="x">표 안</hp:t></hp:run></hp:p>', '<hp:p><hp:run><hp:t>   </hp:t></hp:run></hp:p>', '<hp:p></hp:p>',
    '<hp:p><hp:run><hp:t>&#0;&#xD800;&unknown;끝</hp:t></hp:run></hp:p>',
  ].join('')}</hs:sec>`;
  assert.equal(sectionXmlText(xml), hwpxSectionText(xml));
  assert.equal(sectionXmlText(xmlOf(FILE)), hwpxSectionText(xmlOf(FILE)));
});

test('앱이 내준 .hwpx 를 서버가 읽는 길(hwpxText → weeklyLines)로 읽어도 받은 초안 기록과 같은 줄이다 = 고치지 않고 올린 개인본은 모두 같은 줄', async () => {
  const {team, template} = prepareConfirmed(await openConfirmed(packHwpx(makeFakeReport(openHwpx(new Uint8Array(readFileSync(SAMPLE)), zlib)), zlib)));
  const base = startDraft(team, {me: '가짜담당 갑', myOrgs: ['가짜조직 갑'], date: '2026년 1월 5일(월)'});
  const rows = editableRows(base, '가짜담당 갑');
  const bytes = await buildHwpx(template, assembleDraft(base, {summary: new Map([[rows[0].index, ['- 가짜 진행 하나 완료', '- 새로 쓴 가짜 줄']]])}));
  const issued = await issuedFrom(bytes, '2026-01-05T09:00:00+09:00');
  const serverLines = weeklyLines(await hwpxText(bytes));
  assert.ok(serverLines.length > 5);
  assert.deepEqual(serverLines.map(l => [l.section, squashLine(l.text)]), issued.lines.map(l => [l.section, squashLine(l.text)]));
});

// REC-정리멈춤반복-긴구간(S56-47, 설계 docs/design/meeting-transcript-server.md 9절)
// 긴 녹음 구간을 조각으로 나눠 한 단계에 조각 하나씩 전사하고(끊겨도 이어 함), 요약도 한 단계에 AI 요청 한 번만 한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as cut from '../supabase/functions/meeting-transcribe/audio-cut.mjs';
import * as sj from '../supabase/functions/meeting-transcribe/server-job.mjs';
import { normalizeOggOpus, oggCrc, readPages } from '../supabase/functions/meeting-transcribe/ogg.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const cat = (...arrs) => { const n = arrs.reduce((s, a) => s + a.length, 0); const o = new Uint8Array(n); let i = 0; for (const a of arrs) { o.set(a, i); i += a.length; } return o; };
const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

// ---- 시험용 Ogg/Opus: 머리 두 쪽 + 소리 쪽(쪽마다 20ms 묶음 50개 = 1초) ----
function oggPage(seq, flags, granule, packets) {
  const lacing = [];
  for (const p of packets) { let n = p.length; while (n >= 255) { lacing.push(255); n -= 255; } lacing.push(n); }
  const body = cat(...packets);
  const page = new Uint8Array(27 + lacing.length + body.length);
  page.set(ascii('OggS'), 0); page[5] = flags;
  let g = BigInt(granule); for (let k = 0; k < 8; k++) { page[6 + k] = Number(g & 0xffn); g >>= 8n; }
  page.set([0x78, 0x56, 0x34, 0x12], 14);
  page[18] = seq & 0xff; page[19] = (seq >> 8) & 0xff;
  page[26] = lacing.length; page.set(lacing, 27); page.set(body, 27 + lacing.length);
  const crc = oggCrc(page, 0, page.length);
  page[22] = crc & 0xff; page[23] = (crc >>> 8) & 0xff; page[24] = (crc >>> 16) & 0xff; page[25] = (crc >>> 24) & 0xff;
  return page;
}
function oggFile(seconds) {
  const head = cat(ascii('OpusHead'), Uint8Array.from([1, 1, 0x38, 0x01, 0x80, 0xbb, 0, 0, 0, 0, 0]));
  const tags = cat(ascii('OpusTags'), Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0]));
  const pages = [oggPage(0, 2, 0, [head]), oggPage(1, 0, 0, [tags])];
  // TOC 0x08 = config 1(20ms, 960표본), 한 프레임. 녹음기 시계처럼 granule을 엉뚱하게(1억부터) 적는다.
  for (let s = 0; s < seconds; s++) pages.push(oggPage(s + 2, 0, 100000000 + (s + 1) * 48000, Array.from({ length: 50 }, () => Uint8Array.from([0x08, 1, 2, 3]))));
  return cat(...pages);
}

// ---- 시험용 WebM(크롬 MediaRecorder처럼 Segment·Cluster 크기 모름) ----
const ebml = (id, body) => cat(id, Uint8Array.from([0x80 | 0, 0, 0, 0, 0, 0, 0, 0].map((v, i) => (i === 0 ? 0x01 : (body.length / 2 ** (8 * (7 - i))) & 0xff))), body);
const unknown = Uint8Array.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
function webmFile(clusters) {
  const header = ebml(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]), ebml(Uint8Array.from([0x42, 0x82]), ascii('webm')));
  const info = ebml(Uint8Array.from([0x15, 0x49, 0xa9, 0x66]), ebml(Uint8Array.from([0x2a, 0xd7, 0xb1]), Uint8Array.from([0x0f, 0x42, 0x40])));
  const tracks = ebml(Uint8Array.from([0x16, 0x54, 0xae, 0x6b]), ebml(Uint8Array.from([0xae]), ebml(Uint8Array.from([0xd7]), Uint8Array.from([1]))));
  const list = [header, Uint8Array.from([0x18, 0x53, 0x80, 0x67]), unknown, info, tracks];
  for (let c = 0; c < clusters; c++) {
    list.push(Uint8Array.from([0x1f, 0x43, 0xb6, 0x75]), unknown, ebml(Uint8Array.from([0xe7]), Uint8Array.from([c])));
    for (let k = 0; k < 5; k++) list.push(ebml(Uint8Array.from([0xa3]), Uint8Array.from([0x81, 0, k * 20, 0x80, 0x1f, 0x43, 0xb6, 0x75, 9, 9])));
  }
  return cat(...list);
}

// ---- 시험용 MP4 ----
const box = (type, body) => { const b = new Uint8Array(8 + body.length); const n = b.length; b.set([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255], 0); b.set(ascii(type), 4); b.set(body, 8); return b; };
function mp4File(fragments) {
  const list = [box('ftyp', ascii('iso6mp41')), box('moov', box('mvex', new Uint8Array(4)))];
  for (let f = 0; f < fragments; f++) list.push(box('moof', box('mfhd', Uint8Array.from([0, 0, 0, 0, 0, 0, 0, f]))), box('mdat', new Uint8Array(500).fill(f)));
  return cat(...list);
}

test('조각 수: 20분 넘는 구간만 약 15분씩, 길이를 모르면 크기로, 상한 8', () => {
  assert.equal(cut.chunkCount(59 * 60, 14e6), 4, '59분 구간 = 4조각');
  assert.equal(cut.chunkCount(15 * 60, 3e6), 1, '짧은 구간은 그대로 한 번(화자 구분 유지)');
  assert.equal(cut.chunkCount(20 * 60, 4e6), 1);
  assert.equal(cut.chunkCount(25 * 60, 5e6), 2);
  assert.equal(cut.chunkCount(0, 14 * 1024 * 1024), 4, '길이 모름: 크기로');
  assert.equal(cut.chunkCount(0, 3 * 1024 * 1024), 1);
  assert.equal(cut.chunkCount(0, 100 * 1024 * 1024), cut.MAX_CHUNKS);
});

test('Ogg/Opus(폰 앱): 머리 쪽 + 소리 쪽으로 자르고, 조각마다 granule을 0부터 다시 적어 규격에 맞는 파일이 된다', () => {
  const raw = oggFile(120);
  const whole = normalizeOggOpus(raw).bytes;
  const plan = cut.cutPlan(whole);
  assert.ok(plan);
  const ranges = cut.chunkRanges(plan, 4);
  assert.equal(ranges.length, 4);
  // 조각들이 소리 쪽을 빠짐·겹침 없이 덮는다.
  assert.equal(ranges[0][0], plan.headEnd); assert.equal(ranges[3][1], whole.length);
  for (let k = 1; k < 4; k++) assert.equal(ranges[k][0], ranges[k - 1][1]);
  let total = 0;
  for (let k = 0; k < 4; k++) {
    const fixed = normalizeOggOpus(cut.chunkBytes(whole, plan, ranges, k));
    assert.equal(fixed.stats.kind, 'opus');
    const pages = readPages(fixed.bytes).pages;
    assert.equal(pages[0].flags & 2, 2, '첫 쪽 = 처음 표시'); assert.equal(pages.at(-1).flags & 4, 4, '끝 표시');
    assert.ok(Math.abs(fixed.stats.seconds - 30) <= 2, `조각 ${k + 1} 길이 ≈ 30초 (${fixed.stats.seconds})`);
    total += fixed.stats.seconds;
  }
  assert.ok(Math.abs(total - 120) <= 2);
});

test('WebM(노트북 크롬): 크기를 모르는 Cluster도 경계를 찾아 머리(EBML·Tracks)를 붙여 자른다, 블록 안 우연한 Cluster 바이트에 속지 않는다', () => {
  const file = webmFile(12);
  const plan = cut.cutPlan(file);
  assert.ok(plan); assert.equal(plan.starts.length, 12, 'Cluster 12개');
  const ranges = cut.chunkRanges(plan, 4);
  assert.equal(ranges.length, 4);
  for (let k = 0; k < 4; k++) {
    const c = cut.chunkBytes(file, plan, ranges, k);
    assert.deepEqual([...c.subarray(0, plan.headEnd)], [...file.subarray(0, plan.headEnd)], '머리 그대로');
    assert.deepEqual([...c.subarray(plan.headEnd, plan.headEnd + 4)], [0x1f, 0x43, 0xb6, 0x75], 'Cluster로 시작');
    assert.equal(cut.cutPlan(c).starts.length, 3, '조각도 다시 읽히는 WebM');
  }
  // 두 줄기가 이어 붙은 파일은 자르지 않는다(통째로).
  assert.equal(cut.cutPlan(cat(webmFile(3), webmFile(3))), null);
});

test('fMP4(audio/mp4 녹음): ftyp·moov 머리 + moof·mdat 묶음으로 자른다. 보통 m4a(moof 없음)·mp3는 자르지 않는다', () => {
  const file = mp4File(8);
  const plan = cut.cutPlan(file);
  assert.ok(plan); assert.equal(plan.starts.length, 8);
  const ranges = cut.chunkRanges(plan, 3);
  assert.equal(ranges.length, 3);
  const c = cut.chunkBytes(file, plan, ranges, 1);
  assert.equal(String.fromCharCode(...c.subarray(4, 8)), 'ftyp');
  assert.equal(cut.cutPlan(c).starts.length, ranges[1][1] - ranges[1][0] > 0 ? cut.cutPlan(c).starts.length : 0);
  assert.equal(cut.cutPlan(cat(box('ftyp', ascii('M4A ')), box('moov', new Uint8Array(4)), box('mdat', new Uint8Array(900)))), null);
  assert.equal(cut.cutPlan(Uint8Array.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4, 5])), null, 'mp3');
  assert.equal(cut.cutPlan(new Uint8Array(0)), null);
  // 단위가 조각 수보다 적으면 단위 수만큼.
  assert.equal(cut.chunkRanges(cut.cutPlan(mp4File(2)), 4).length, 2);
});

test('구간 조각 진행: 조각마다 항목에 남기고, 끊긴 조각은 다시, 다 끝나면 글을 잇고 진행 칸을 뺀다', () => {
  let part = { no: 1, seconds: 3540, job: '11111111-1111-4111-8111-111111111111', text: null };
  assert.equal(sj.chunkNext(part, 4), 0);
  part = sj.chunkDone(part, 4, '첫 조각 ');
  assert.deepEqual(part.chunks, { n: 4, texts: ['첫 조각'] }); assert.equal(part.text, null);
  assert.equal(sj.nextPart([part]), 0, '구간은 아직 전사 중');
  assert.equal(sj.doneParts([part]), 0);
  // 다음 실행이 둘째 조각 중간에 끊김 → 저장되지 않았으므로 다음 실행이 둘째 조각부터 다시.
  assert.equal(sj.chunkNext(part, 4), 1);
  part = sj.chunkDone(part, 4, '');
  part = sj.chunkDone(part, 4, '셋째');
  part = sj.chunkDone(part, 4, '넷째');
  assert.equal(part.chunks, undefined); assert.equal(part.text, '첫 조각\n\n셋째\n\n넷째', '빈 조각(쉬는 시간)은 건너뜀');
  assert.equal(sj.doneParts([part]), 1);
  // 자를 계획이 바뀌면(n이 다름) 처음부터.
  assert.equal(sj.chunkNext({ chunks: { n: 4, texts: ['a'] } }, 3), 0);
  assert.equal(sj.chunkState({ chunks: { n: 2, texts: ['a', 'b'] } }), null, '모양이 틀린 진행은 버림');
  // 한 번에 끝나는 구간.
  assert.equal(sj.chunkDone({ no: 1, text: null }, 1, ' 글 ').text, '글');
});

test('2시간 넘는 녹음 모의: 59분 구간 셋 = 12단계, 한 단계는 조각 하나(15분 안쪽), 중간 끊김 뒤 이어서 끝난다', () => {
  let parts = sj.recordingParts([1, 2, 3].map((n) => ({ segment_no: n, status: 'combined', job_id: `1111111${n}-1111-4111-8111-111111111111`, duration_sec: 3540 })));
  let steps = 0, cuts = 0;
  for (let guard = 0; guard < 100; guard++) {
    const i = sj.nextPart(parts);
    if (i < 0) break;
    const n = sj.chunkState(parts[i])?.n ?? cut.chunkCount(parts[i].seconds, 14e6);
    const k = sj.chunkNext(parts[i], n);
    assert.ok(parts[i].seconds / n <= cut.CHUNK_SECONDS, '조각 하나는 15분 이하');
    steps++;
    if (steps === 6 && !cuts) { cuts++; continue; } // 이번 실행은 시간 한도에 끊김: 저장 없이 사라짐
    parts = parts.map((p, j) => (j === i ? sj.chunkDone(p, n, `구간${p.no} 조각${k + 1}`) : p));
  }
  assert.equal(steps, 13, '12조각 + 끊긴 한 번');
  assert.equal(sj.doneParts(parts), 3);
  const text = sj.joinParts(parts);
  assert.match(text, /구간1 조각1[\s\S]*구간1 조각4[\s\S]*― 59분부터 ―\n구간2 조각1[\s\S]*― 1시간 58분부터 ―\n구간3 조각1[\s\S]*구간3 조각4$/);
  assert.equal((text.match(/구간2 조각2/g) || []).length, 1, '끊긴 조각이 두 번 들어가지 않음');
});

test('요약 반 나눔: 답이 잘리면 표시만 남기고 다음 단계들이 반 하나씩 — 한 단계에 AI 요청 한 번', () => {
  const d = (x) => ({ decisions: x, information: '', actions: [], attendees: [], meetingDate: '' });
  // 한 조각 회의: [표시] → 반1 → 반2 → [a,b] → 합치기.
  const short = '가'.repeat(5000);
  let p = sj.summaryPlan(short, [sj.halfMark()]);
  assert.deepEqual([p.kind, p.half, p.single, p.total], ['half', 0, true, 3]);
  p = sj.summaryPlan(short, [{ halves: [d('a')] }]);
  assert.deepEqual([p.kind, p.half], ['half', 1]);
  p = sj.summaryPlan(short, [d('a'), d('b')]);
  assert.equal(p.kind, 'merge');
  // 여러 조각 회의: 둘째 조각이 잘림 → [d1, 표시] → 둘째 조각의 반들 → [d1, 합친 것] → 셋째 조각.
  const long = Array.from({ length: 4000 }, (_, i) => `화자${i % 3 + 1}: ${'가'.repeat(15)} ${i}`).join('\n');
  const pieces = sj.summaryPlan(long, []).pieces;
  assert.ok(pieces.length >= 3);
  p = sj.summaryPlan(long, [d('1'), sj.halfMark()]);
  assert.deepEqual([p.kind, p.at, p.half, p.single, p.count], ['half', 1, 0, false, pieces.length]);
  assert.equal(p.piece, pieces[1]);
  p = sj.summaryPlan(long, [d('1'), sj.combineDrafts([d('2a'), d('2b')])]);
  assert.deepEqual([p.kind, p.next], ['part', 2]);
  assert.equal(sj.isHalfMark(d('x')), false); assert.equal(sj.isHalfMark({ halves: [d('a'), d('b')] }), false);

  // 서버 단계: 요약 갈래마다 serverDraft를 한 번만 부른다.
  const src = read('supabase/functions/meeting-transcribe/index.ts');
  const summary = src.slice(src.indexOf("if (job.stage === 'summary') {"), src.indexOf("throw new Fail('failed');\n}", src.indexOf("if (job.stage === 'summary') {")));
  const branches = summary.split(/\n    if \(plan\.kind === |\n    let raw;|\n    \} else \{/);
  for (const b of branches) assert.ok((b.match(/await serverDraft\(/g) || []).length <= 1, '한 갈래에 AI 요청 한 번');
});

test('서버: 긴 구간은 조각 하나만, 조각 전사는 실행 시간 안에서 기다림을 끊고, 진행은 기존 parts 칸(새 표·새 칸 없음)', () => {
  const src = read('supabase/functions/meeting-transcribe/index.ts');
  assert.match(src, /import \{ chunkBytes, chunkCount, chunkRanges, cutPlan \} from '\.\/audio-cut\.mjs';/);
  const fn = src.slice(src.indexOf('async function transcribeChunked('), src.indexOf('// 서버 요약 한 번('));
  assert.match(fn, /const n = ranges\.length, k = chunkNext\(part, n\);/);
  assert.equal((fn.match(/await geminiRun\(/g) || []).length, 2, '나눌 수 없으면 통째 한 번, 나누면 조각 하나');
  assert.match(fn, /CHUNK_TRANSCRIBE_MS\)/);
  assert.match(fn, /if \(ogg\) chunk = fixOgg\(chunk\);/);
  const ms = Number(src.match(/const CHUNK_TRANSCRIBE_MS = (\d+);/)[1]);
  assert.ok(ms <= 240000, '조각 전사 기다림 + 올리기·읽기 대기가 Edge 실행 한도(약 400초) 안');
  // 구간 행: 조각이 남으면 uploaded(이어서 정리 목록에 남음), 다 끝나면 done.
  assert.match(src, /out\.last \? \{ status: 'done'[^}]*\} : \{ status: 'uploaded', error_code: null \}/);
  // 기다림·재시도 상한은 늘리지 않았다.
  assert.match(read('supabase/functions/meeting-transcribe/server-job.mjs'), /export const MAX_STEP_CUTS = 2;/);
  assert.match(src, /signal: AbortSignal\.timeout\(300000\)/, '요약 한 번 기다림 그대로');
  // 로그는 수만.
  assert.match(fn, /console\.warn\('meeting-transcribe: chunk', k \+ 1, n, chunk\.byteLength\);/);
});

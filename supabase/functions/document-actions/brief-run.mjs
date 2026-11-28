// BRIEF-브리핑룸 PR ②(설계 docs/design/brief-room.md 4절): 브리핑 작업 한 건을 단계별로 이어 가는 곳. 입출력은 deps로만 받는다(Node 시험 가능).
// 단계: read(Drive 끝까지 읽기) → chunk(조각마다 AI 메모) → merge(합치기 AI + 서버 검사) → done.
// - read(S67-33): 자료실 AI 색인이 이미 끝까지 읽어 둔 글자(잘리지 않은 HWP·HWPX·글 파일)가 있으면 그것을 먼저 쓴다.
//   없으면 Drive에서 읽되, HWP·HWPX는 여러 번에 나눠 읽는다(부를 때마다 정한 양, 읽은 글은 source_text에 쌓고 위치는 parts의 ctl에).
//   진행 표시 step_no/step_total이 read 단계에서도 움직인다.
// - 함수가 메모리·시간 한도로 죽으면 정리 코드가 돌지 않아 lease가 남는다. 다음 잡기에서 남은 lease = 앞 실행이 죽음으로 보고,
//   같은 단계·같은 위치에서 BRIEF_MAX_DEATHS번 죽으면 실패(read 단계는 read_failed)로 끝낸다(영원히 '만드는 중'으로 남지 않게).
// - 한 번 부를 때 budgetMs 안에서만 돌고, 못 끝내면 lease를 풀고 다음 부름(스스로 잇기 또는 화면)이 잇는다.
// - 작업 잡기는 lease + attempts 값 비교로 한 곳만(같은 작업을 두 실행이 동시에 돌리지 않음). 저장도 attempts가 내 값일 때만.
// - AI를 부르기 전마다 사람별 월 한도 판정(deps.capCheck). 한도면 failed/ai_monthly_cap. 판정을 못 읽으면 멈춤(닫힌 쪽).
// - 글 내용·AI 답은 로그에 남기지 않는다(고정 코드만). 끝나면 source_text를 비운다.
import {
  BRIEF_CHUNK_CHARS, BRIEF_MAX_CHUNKS, BRIEF_MIN_TEXT, BRIEF_TEXT_MAX, CHUNK_INSTRUCTIONS, MERGE_INSTRUCTIONS,
  chunkInput, chunkWithPages, foldForMatch, mergeInput, pageStarts, pagesKnown, parseChunkNote,
  quoteCandidates, SCOPE_UNKNOWN_TEXT, scopeNames, scopeText, splitChunks, stepTotal, tidyBriefText, verifyBrief,
  CHUNK_PLUS_INSTRUCTIONS, lensText, mergeInputPlus, mergePlusInstructions, parseChunkNotePlus, verifyBriefPlus,
} from '../_shared/brief-room.mjs';

export const BRIEF_TABLE = 'app_document_briefs';
export const BRIEF_LEASE_MS = 3 * 60 * 1000;
export const BRIEF_BUDGET_MS = 140 * 1000;
// S67-33: 40 → 80. read 단계를 나눠 읽으면 부름(잡기) 수가 늘어난다. 같은 자리 반복 사망은 BRIEF_MAX_DEATHS가 따로 막는다.
export const BRIEF_MAX_ATTEMPTS = 80;
export const BRIEF_MAX_DEATHS = 3;               // 같은 단계·같은 위치에서 함수가 죽은 횟수 상한
export const BRIEF_STALE_MS = 30 * 1000;          // 화면이 '멈춘 작업'으로 보고 이어 달라고 하는 기준(lease가 지난 뒤)
export const CHUNK_MAX_TOKENS = 1800;  // S68-56: points 12개 안 + 인용 3개
export const MERGE_MAX_TOKENS = 3000;  // S68-56: 본문 요약(항목 40개 안)이 들어가 2000 → 3000
// BRIEF-품질올리기('더 깊게', 운영자 기능 brief_plus): 조각 메모에 근거 위치·숫자 목록이 더해져 출력 상한을 늘린다(모델은 그대로).
// 합치기 상한·생각 수준은 _shared/ai-model.ts BRIEF_PLUS_MERGE 한 곳(brief.ts가 그 값으로 부른다).
export const CHUNK_PLUS_MAX_TOKENS = 2800;
export const BRIEF_PLUS_FEATURE = 'brief_plus';
// '더 깊게' 합치기는 오래 걸릴 수 있어(생각 수준 high), 앞 일로 이 시간 넘게 쓴 부름에서는 시작하지 않고 다음 부름(새 시간)으로 넘긴다.
export const PLUS_MERGE_FRESH_MS = 15 * 1000;
// 화면·응답에 돌려주는 칸(글 원문·조각 메모는 빼고).
export const BRIEF_PUBLIC = 'id,document_id,status,stage,step_no,step_total,page_count,brief,error_code,created_at,updated_at,finished_at,lease_until';

const S = { type: 'string' };
const LINES = { type: 'array', items: S };
// S68-56(명진 11/23 15:06·15:12): 칸을 미리 정하지 않는다. 조각 메모 = 자료 순서 요약 points + 원문 인용(발언자 포함).
// 진행 중이던 작업의 옛 메모(touches·todos·conflicts)는 mergeInput이 칸 이름 없이 줄만 옮겨 합친다.
const OBJ = (props) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
export const CHUNK_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false, required: ['lead', 'points', 'quotes'],
  properties: {
    lead: S,
    points: { type: 'array', items: OBJ({ heading: S, text: S }) },
    quotes: { type: 'array', items: OBJ({ text: S, heading: S, speaker: S, why: S }) },
  },
});
// 최종 브리핑 v3: 요지 1~3줄 · AI가 정한 소제목·항목(쪽·우리 관련 표시) · 원문 인용(후보 번호만).
export const MERGE_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false, required: ['gist', 'sections', 'quotes'],
  properties: {
    gist: LINES,
    sections: { type: 'array', items: OBJ({ title: S, items: { type: 'array', items: OBJ({ text: S, page: { type: 'integer' }, ours: { type: 'boolean' } }) } }) },
    quotes: { type: 'array', items: OBJ({ id: S }) },
  },
});

// '더 깊게' 스키마(strict json_schema: 칸은 모두 필수). 기본 스키마는 위 그대로다.
export const CHUNK_PLUS_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false, required: ['lead', 'points', 'facts', 'quotes'],
  properties: {
    lead: S,
    points: { type: 'array', items: OBJ({ heading: S, text: S, ref: S }) },
    facts: { type: 'array', items: OBJ({ what: S, value: S, ref: S }) },
    quotes: { type: 'array', items: OBJ({ text: S, heading: S, speaker: S, why: S }) },
  },
});
const SIDE = OBJ({ value: S, ref: S });
export const MERGE_PLUS_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false, required: ['core', 'gist', 'sections', 'issues', 'mismatches', 'background', 'quotes'],
  properties: {
    core: S,
    gist: LINES,
    sections: { type: 'array', items: OBJ({ title: S, items: { type: 'array', items: OBJ({ text: S, page: { type: 'integer' }, ours: { type: 'boolean' }, ref: S }) } }) },
    issues: { type: 'array', items: OBJ({ text: S, why: S, ref: S }) },
    mismatches: { type: 'array', items: OBJ({ what: S, a: SIDE, b: SIDE, note: S }) },
    background: { type: 'array', items: OBJ({ text: S }) },
    quotes: { type: 'array', items: OBJ({ id: S }) },
  },
});

/**
 * 이 작업공간이 '더 깊게'인지 + 관점 글. 로그인 토큰 REST(userDb)로 app_my_features()(서버 허용 표)를 읽는다 — 화면이 보낸 값은 쓰지 않는다.
 * 못 읽으면 지금 방식(on=false, 닫힌 쪽 — 비용이 늘지 않음). 관점은 내 프로필 view_prefs.brief_lens(못 읽거나 비면 기본 관점).
 * 관점 글은 돌려주기만 하고 로그에 남기지 않는다.
 */
export async function readBriefPlus(userDb, userId) {
  let features = null;
  try { features = await userDb('rpc/app_my_features', { method: 'POST', body: {} }); } catch { features = null; }
  if (!Array.isArray(features) || !features.includes(BRIEF_PLUS_FEATURE)) return { on: false, lens: '' };
  let lens = '';
  try {
    if (isUuid(String(userId))) {
      const rows = await userDb(`app_profiles?user_id=eq.${encodeURIComponent(userId)}&select=view_prefs&limit=1`);
      const vp = Array.isArray(rows) ? rows[0]?.view_prefs : null;
      lens = vp && typeof vp === 'object' ? vp.brief_lens : '';
    }
  } catch { lens = ''; }
  return { on: true, lens: lensText(lens) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const isUuid = v => typeof v === 'string' && UUID.test(v);

// parts 안의 진행 기록 한 칸({ctl:{mark, strikes, read}}). 조각 메모와 섞이지 않게 notesOf로 거른다.
export const ctlOf = parts => (Array.isArray(parts) ? parts.find(p => p && typeof p === 'object' && p.ctl && typeof p.ctl === 'object')?.ctl : null) ?? {};
export const notesOf = parts => (Array.isArray(parts) ? parts : []).filter(p => p && typeof p === 'object' && !p.ctl);
export const withCtl = (parts, ctl) => [...notesOf(parts), { ctl }];

// 자료실 AI 색인·자료 글자 읽기가 저장한 글자(app_documents.extracted_text)가 '끝까지 읽은 원문'인지.
// - 색인(document-ai-index)은 50,000자에서 자르고 '…[이하 생략]'을 붙인다. 자료 글자 읽기(document-text)는 정확히 12,000자에서 자른다.
// - PDF·DOC 등은 색인이 AI로 옮겨 적은 글일 수 있어(원문 대조가 흔들림) 쓰지 않는다. HWP·HWPX·글 파일만(파일 그대로 뽑은 글자).
export const INDEX_TEXT_CUT_A = 12000, INDEX_TEXT_CUT_B = 50000;
export function fullIndexText(doc) {
  if (!doc || doc.extraction_status !== 'ready' || typeof doc.extracted_text !== 'string') return '';
  const name = String(doc.file_name || doc.title || '').toLowerCase();
  if (!/\.(hwp|hwpx|txt|md|markdown|csv|tsv|log)$/.test(name)) return '';
  const text = doc.extracted_text;
  if (/\[이하 생략\]\s*$/.test(text)) return '';
  const n = [...text].length;
  if (n === INDEX_TEXT_CUT_A || n >= INDEX_TEXT_CUT_B) return '';
  return text;
}

export class BriefError extends Error {
  constructor(status, code) { super(code); this.name = 'BriefError'; this.status = status; this.code = code; }
}

/**
 * @param {{
 *  db: (path: string, opts?: {method?: string, body?: unknown, prefer?: string}) => Promise<any>,
 *  extract: (doc: Record<string, unknown>) => Promise<{text: string, reason: string}>,
 *  ai: (name: string, instructions: string, input: string, schema: object, maxTokens: number) => Promise<{ok: true, text: string|null, model: string} | {ok: false, code: string}>,
 *  capCheck: () => Promise<{ok: boolean, status?: number, code?: string}>,
 *  scope: () => Promise<{orgs: string[], areas: string[]}>,
 *  plus?: () => Promise<{on: boolean, lens: string}>,   // BRIEF-품질올리기: 없으면 지금 방식
 *  now: () => number,
 *  log?: (code: string) => void,
 *  budgetMs?: number,
 * }} deps
 */
export function createBriefRunner(deps) {
  const log = deps.log ?? (() => {});
  const iso = ms => new Date(ms).toISOString();
  const enc = encodeURIComponent;

  async function readRow(id) {
    const rows = await deps.db(`${BRIEF_TABLE}?id=eq.${enc(id)}&select=${BRIEF_PUBLIC},workspace_id,attempts,source_text,parts&limit=1`);
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }

  /** 진행 중 작업이 있으면 그것, 없으면 새 작업(queued). doc은 서버가 owner를 확인한 자료 행. */
  async function start({ userId, doc }) {
    const running = await deps.db(`${BRIEF_TABLE}?document_id=eq.${enc(doc.id)}&workspace_id=eq.${enc(doc.workspace_id)}&status=in.(queued,running)&select=${BRIEF_PUBLIC}&limit=1`);
    if (Array.isArray(running) && running[0]) return { row: running[0], created: false };
    const cap = await deps.capCheck();
    if (!cap.ok) throw new BriefError(cap.status ?? 503, cap.code ?? 'usage_unavailable');
    const made = await deps.db(`${BRIEF_TABLE}?select=${BRIEF_PUBLIC}`, {
      method: 'POST', prefer: 'return=representation',
      body: {
        workspace_id: doc.workspace_id, created_by: userId, document_id: doc.id,
        source_file_id: typeof doc.file_id === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(doc.file_id) ? doc.file_id : null,
        status: 'queued', stage: 'read', step_no: 0, step_total: 0,
      },
    });
    if (!Array.isArray(made) || !made[0]) throw new BriefError(503, 'brief_unavailable');
    return { row: made[0], created: true };
  }

  /** lease가 비었거나 지난 작업만 잡는다. 잡으면 attempts 새 값, 못 잡으면 null. */
  async function claim(id, nowMs) {
    const row = await readRow(id);
    if (!row || row.status === 'done' || row.status === 'failed') return null;
    if (row.lease_until && Date.parse(row.lease_until) > nowMs) return null;
    const attempts = Number(row.attempts) || 0;
    // 남은 lease(지난 시각) = 앞 실행이 정리 없이 죽었다(메모리·시간 한도). 같은 자리에서 거듭 죽으면 실패로 끝낸다.
    const ctl = ctlOf(row.parts);
    const mark = `${row.stage}:${Number(row.step_no) || 0}:${ctl.read ? `${ctl.read.sec}.${ctl.read.para}` : '-'}`;
    const died = !!row.lease_until;
    const strikes = died ? (ctl.mark === mark ? (Number(ctl.strikes) || 0) + 1 : 1) : 0;
    if (strikes >= BRIEF_MAX_DEATHS) {
      log('brief_died_repeatedly');
      await deps.db(`${BRIEF_TABLE}?id=eq.${enc(id)}&attempts=eq.${attempts}`, {
        method: 'PATCH', prefer: 'return=minimal',
        body: { status: 'failed', error_code: row.stage === 'read' ? 'read_failed' : 'step_failed', source_text: null, lease_until: null, finished_at: iso(nowMs), updated_at: iso(nowMs) },
      });
      return null;
    }
    if (died) log('brief_previous_run_died');
    if (attempts >= BRIEF_MAX_ATTEMPTS) {
      await deps.db(`${BRIEF_TABLE}?id=eq.${enc(id)}&attempts=eq.${attempts}`, {
        method: 'PATCH', prefer: 'return=minimal',
        body: { status: 'failed', error_code: 'too_many_tries', source_text: null, lease_until: null, finished_at: iso(nowMs), updated_at: iso(nowMs) },
      });
      return null;
    }
    const got = await deps.db(`${BRIEF_TABLE}?id=eq.${enc(id)}&attempts=eq.${attempts}&status=in.(queued,running)&select=id`, {
      method: 'PATCH', prefer: 'return=representation',
      body: { status: 'running', attempts: attempts + 1, lease_until: iso(nowMs + BRIEF_LEASE_MS), started_at: row.started_at ?? iso(nowMs), updated_at: iso(nowMs),
        parts: withCtl(row.parts, { ...ctl, mark, strikes }) },
    });
    if (!Array.isArray(got) || got.length !== 1) return null;
    return { ...row, status: 'running', attempts: attempts + 1, parts: withCtl(row.parts, { ...ctl, mark, strikes }) };
  }

  async function save(row, patch) {
    const nowMs = deps.now();
    const done = patch.status === 'done' || patch.status === 'failed';
    const body = { ...patch, updated_at: iso(nowMs), lease_until: done ? null : iso(nowMs + BRIEF_LEASE_MS) };
    if (done) { body.finished_at = iso(nowMs); body.source_text = null; }
    const r = await deps.db(`${BRIEF_TABLE}?id=eq.${enc(row.id)}&attempts=eq.${row.attempts}&select=id`, { method: 'PATCH', prefer: 'return=representation', body });
    if (!Array.isArray(r) || r.length !== 1) throw new BriefError(409, 'brief_taken'); // 다른 실행이 잡았다 → 이 실행은 멈춘다
    Object.assign(row, patch);
  }
  const fail = (row, code) => save(row, { status: 'failed', stage: row.stage, error_code: code });

  const READ_FAIL = { too_large: 'too_large', unsupported: 'unsupported', locked: 'locked', read_failed: 'read_failed' };

  // 읽기 끝: 정리 → 조각 나누기 → chunk 단계로.
  // partial='preview'(S67-37): HWP 본문을 못 읽어 미리보기 글자(앞부분만)로 만든다. 표시는 parts의 ctl에 두었다가 merge에서 brief.partial로 옮긴다.
  async function finishRead(row, raw, reason, partial = null) {
    const { text } = tidyBriefText(raw);
    if (text.replace(/\s/g, '').length < BRIEF_MIN_TEXT) { await fail(row, READ_FAIL[reason] ?? 'no_text'); return 'stop'; }
    const starts = pageStarts(text);
    const chunks = splitChunks(text, BRIEF_CHUNK_CHARS);
    if (chunks.length > BRIEF_MAX_CHUNKS) { await fail(row, 'too_large'); return 'stop'; }
    await save(row, { stage: 'chunk', source_text: text, page_count: partial ? null : (pagesKnown(starts) ? starts.length : null), step_no: 0, step_total: stepTotal(chunks.length), parts: partial ? withCtl([], { partial }) : [] });
    return 'next';
  }

  // read 한 번(한 몫). 'next' = chunk로 넘어감, 'pause' = 더 읽을 것이 남음(다음 부름이 잇는다), 'stop' = 실패로 끝남.
  async function stepRead(row, doc) {
    const ctl = ctlOf(row.parts);
    const at = ctl.read && Number.isInteger(ctl.read.sec) && Number.isInteger(ctl.read.para) ? { sec: ctl.read.sec, para: ctl.read.para } : null;
    if (!at) {
      const indexed = fullIndexText(doc);
      if (indexed && indexed.replace(/\s/g, '').length >= BRIEF_MIN_TEXT) { log('brief_read_index_text'); return finishRead(row, indexed, 'ok'); }
    }
    const sofar = at && typeof row.source_text === 'string' ? row.source_text : '';
    const room = Math.max(0, BRIEF_TEXT_MAX - sofar.length);
    const got = await deps.extract(doc, { from: at, maxChars: room });
    if (got?.reason && got.reason !== 'ok' && !got?.text) {
      // 앞 몫까지 읽은 뒤의 실패는 읽기 실패(앞부분만으로 브리핑을 만들지 않는다)
      await fail(row, at ? 'read_failed' : (READ_FAIL[got.reason] ?? 'no_text'));
      return 'stop';
    }
    if (!at && got?.partial === 'preview' && got?.text) { log('brief_read_preview'); return finishRead(row, got.text, 'read_failed', 'preview'); }
    const piece = typeof got?.text === 'string' ? got.text : '';
    const text = sofar && piece ? `${sofar}\n${piece}` : (sofar || piece);
    const next = got?.next && Number.isInteger(got.next.sec) && Number.isInteger(got.next.para) ? got.next : null;
    if (next && text.length < BRIEF_TEXT_MAX) {
      // 다음 위치가 지금보다 앞이 아니어야 한다(같은 자리 맴돌기 막기)
      if (at && (next.sec < at.sec || (next.sec === at.sec && next.para <= at.para))) { await fail(row, 'read_failed'); return 'stop'; }
      const done = (Number(row.step_no) || 0) + 1;
      const total = Math.max(Number(got.total) || 0, done + 1);
      await save(row, { source_text: tidyBriefText(text).text, step_no: Math.min(done, 1000), step_total: Math.min(total, 1000), parts: withCtl(row.parts, { ...ctl, read: next }) });
      return 'pause';
    }
    return finishRead(row, text, got?.reason ?? 'ok');
  }

  // AI 한 번. 한도·호출 실패는 코드로 돌려준다(던지지 않음).
  async function callAi(name, instructions, input, schema, maxTokens, opts) {
    const cap = await deps.capCheck();
    if (!cap.ok) return { ok: false, code: cap.code === 'ai_monthly_cap' ? 'ai_monthly_cap' : 'usage_unavailable', final: cap.code === 'ai_monthly_cap' };
    const r = opts ? await deps.ai(name, instructions, input, schema, maxTokens, opts) : await deps.ai(name, instructions, input, schema, maxTokens);
    return r.ok ? r : { ok: false, code: r.code, final: r.code === 'ai_not_configured' };
  }

  async function stepChunk(row, title, plus) {
    const text = row.source_text;
    if (typeof text !== 'string' || !text) { await fail(row, 'no_text'); return 'stop'; }
    const starts = pageStarts(text);
    const chunks = splitChunks(text, BRIEF_CHUNK_CHARS);
    const i = row.step_no;
    if (i >= chunks.length) { await save(row, { stage: 'merge' }); return 'next'; }
    const chunk = chunks[i];
    const body = chunkWithPages(text, starts, chunk);
    const input = chunkInput({ index: i, total: chunks.length, title, body });
    const r = plus.on
      ? await callAi('brief_chunk', CHUNK_PLUS_INSTRUCTIONS, input, CHUNK_PLUS_SCHEMA, CHUNK_PLUS_MAX_TOKENS)
      : await callAi('brief_chunk', CHUNK_INSTRUCTIONS, input, CHUNK_SCHEMA, CHUNK_MAX_TOKENS);
    if (!r.ok) { if (r.final) { await fail(row, r.code); return 'stop'; } log(`brief_${r.code}`); return 'pause'; }
    const note = (plus.on ? parseChunkNotePlus : parseChunkNote)(r.text ?? '', { folded: foldForMatch(text), starts, chunk })
      ?? { lead: '', points: [], quotes: [], skipped: true };
    if (note.skipped) log('brief_chunk_bad_answer');
    const notes = [...notesOf(row.parts), note];
    const partial = ctlOf(row.parts).partial;
    const parts = partial ? withCtl(notes, { partial }) : notes; // 미리보기로 만든 표시는 merge까지 남긴다
    await save(row, { parts, step_no: i + 1, model: r.model ?? row.model ?? null });
    return 'next';
  }

  async function stepMerge(row, scope, title, plus, fresh) {
    const notes = notesOf(row.parts).filter(n => !n.skipped);
    if (!notes.length) { await fail(row, 'ai_bad_answer'); return 'stop'; }
    const candidates = quoteCandidates(notes);
    // '더 깊게': 앞 일로 시간을 많이 쓴 부름이면 다음 부름(새 시간)에서 합친다(오래 걸리는 합치기가 실행 시간 한도에 걸리지 않게).
    if (plus.on && !fresh()) return 'pause';
    const r = plus.on
      ? await callAi('brief_merge', mergePlusInstructions(plus.lens), mergeInputPlus({ title, scope: scope.text, notes, candidates }), MERGE_PLUS_SCHEMA, 0, { plus: true })
      : await callAi('brief_merge', MERGE_INSTRUCTIONS, mergeInput({ title, scope: scope.text, notes, candidates }), MERGE_SCHEMA, MERGE_MAX_TOKENS);
    if (!r.ok) { if (r.final) { await fail(row, r.code); return 'stop'; } log(`brief_${r.code}`); return 'pause'; }
    const ctx = { candidates, pageCount: row.page_count ?? null, names: scope.names };
    const checked = plus.on
      ? verifyBriefPlus(r.text ?? '', { ...ctx, folded: foldForMatch(typeof row.source_text === 'string' ? row.source_text : '') })
      : verifyBrief(r.text ?? '', ctx);
    if (!checked) { await fail(row, 'ai_bad_answer'); return 'stop'; }
    const brief = ctlOf(row.parts).partial === 'preview' ? { ...checked, partial: 'preview' } : checked;
    await save(row, { status: 'done', stage: 'done', brief, step_no: row.step_total, model: r.model ?? row.model ?? null });
    return 'stop';
  }

  /**
   * 잡을 수 있으면 잡아서 budget 안에서 이어 간다. 돌려주는 값: 'done' | 'failed' | 'paused' | 'busy'(다른 실행이 잡고 있음).
   * @param {string} id
   * @param {Record<string, unknown>} doc 서버가 다시 읽은 자료 행(owner 확인됨)
   */
  async function run(id, doc) {
    const started = deps.now();
    const row = await claim(id, started);
    if (!row) return 'busy';
    const title = String(doc.title || doc.file_name || '').trim();
    // S67-50: 담당 범위 = 이 사람이 등록한 담당 대상·프로젝트 이름뿐(사람마다 다름). 못 읽으면 names=null('우리 관련' 표시를 하나도 남기지 않음).
    // S68-56: 담당 목록은 합치기에만 쓴다(조각 요약은 내용만).
    let scopeLine = null;
    const scope = async () => scopeLine ??= (async () => {
      try { const s = await deps.scope(); return { text: scopeText(s.orgs, s.areas), names: scopeNames(s.orgs, s.areas) }; }
      catch { log('brief_scope_unavailable'); return { text: SCOPE_UNKNOWN_TEXT, names: null }; }
    })();
    // BRIEF-품질올리기: '더 깊게'인지는 부를 때마다 서버 허용 표로 다시 본다(못 읽으면 지금 방식). 조각 단계에 들어갈 때만 읽는다.
    let plusInfo = null;
    const plus = async () => plusInfo ??= (async () => {
      if (!deps.plus) return { on: false, lens: '' };
      try { const p = await deps.plus(); return p && p.on === true ? { on: true, lens: lensText(p.lens) } : { on: false, lens: '' }; }
      catch { log('brief_plus_unavailable'); return { on: false, lens: '' }; }
    })();
    const fresh = () => deps.now() - started <= PLUS_MERGE_FRESH_MS;
    try {
      while (deps.now() - started < (deps.budgetMs ?? BRIEF_BUDGET_MS)) {
        let step;
        if (row.stage === 'read') step = await stepRead(row, doc);
        else if (row.stage === 'chunk') step = await stepChunk(row, title, await plus());
        else if (row.stage === 'merge') step = await stepMerge(row, await scope(), title, await plus(), fresh);
        else step = 'stop';
        if (step === 'stop') break;
        if (step === 'pause') break;
      }
    } catch (e) {
      if (e instanceof BriefError && e.code === 'brief_taken') return 'busy';
      log('brief_step_failed');
      try { await fail(row, 'brief_failed'); } catch { /* 다음 부름이 attempts로 정리 */ }
      return 'failed';
    }
    if (row.status === 'done' || row.status === 'failed') return row.status;
    // 못 끝냄: lease를 바로 풀어 다음 부름이 잡게 한다.
    try {
      await deps.db(`${BRIEF_TABLE}?id=eq.${enc(row.id)}&attempts=eq.${row.attempts}`, { method: 'PATCH', prefer: 'return=minimal', body: { lease_until: null, updated_at: iso(deps.now()) } });
    } catch { log('brief_release_failed'); }
    return 'paused';
  }

  return { start, run, claim, readRow };
}

/** 화면이 '멈춘 작업'으로 볼지(진행 중인데 lease가 비었거나 지났고 마지막 저장이 오래됨). */
export function isStalled(row, nowMs) {
  if (!row || (row.status !== 'queued' && row.status !== 'running')) return false;
  const lease = row.lease_until ? Date.parse(row.lease_until) : 0;
  const upd = row.updated_at ? Date.parse(row.updated_at) : 0;
  return lease <= nowMs && nowMs - upd >= BRIEF_STALE_MS;
}

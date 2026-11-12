// MTG-녹음초안 2단계: 회의 녹음 전사(Edge meeting-transcribe)의 순수 규칙. Node 시험·Deno 배포 양쪽에서 읽으므로 .mjs로 둔다.
// - S60-9 REC-전사모델바꾸기: 전사 전용 Interactions(gemini-3.5-transcribe, 화자 구분 기능) → 일반 모델 gemini-2.5-flash의
//   generateContent(올린 파일 주소 + 받아 적기 지시문). 화자 구분 전용 기능이 없으므로 지시문으로 '화자1: …' 줄을 나누게 한다.
// - 전사 글은 여기서 저장하지 않는다. 부른 화면에 한 번 돌려줄 뿐이다(원문은 회의 기록에만).
import { geminiKrw } from '../_shared/ai-prices.mjs';

// 회의 녹음 전사 모델(S60-9 REC-전사모델바꾸기, 명진 결정 11/12 "더 싼 전사모델로"): 이 한 줄만 바꾸면 전사 요청·사용량·가격 셈이 모두 따라간다
// (나중에 같은 녹음으로 gemini-2.5-flash-lite와 비교할 때도 여기만). 옛 전사 전용 모델(gemini-3.5-transcribe)의 지난 사용량 행은 그대로 둔다.
export const TRANSCRIBE_MODEL = 'gemini-2.5-flash';
// 공식 모델 안내(ai.google.dev gemini-2.5-flash, 2026-11-12 확인): 출력 상한 65,536토큰. 생각은 thinkingBudget 0으로 끈다(2.5 Flash는 0 = 끔).
export const TRANSCRIBE_MAX_OUTPUT_TOKENS = 65536;
// 받아 적기는 답이 하나여야 한다 → 낮게. 0(늘 같은 다음 낱말)은 같은 말 되풀이에 빠지기 쉬워 조금 띄운다.
export const TRANSCRIBE_TEMPERATURE = 0.2;
export const GEMINI_KEY_NAME = 'GEMINI_API_KEY';
export const MAX_BYTES = 100 * 1024 * 1024;      // 회의자료 올리기(meeting-files)와 같은 100MB
export const MAX_SECONDS = 60 * 60;              // Gemini 한 번 요청 상한 1시간
export const MONTHLY_LIMIT_KRW = 15000;          // 회의 전사 이번 달 상한(추정 금액, 서울 날짜 기준)
export const RUNNING_STALE_MS = 15 * 60 * 1000;  // 진행 중으로 15분 넘게 남은 작업은 끊긴 것으로 본다
export const UNATTACHED_TRASH_DAYS = 30;         // 회의에 붙이지 않은 녹음은 30일 뒤 Drive 휴지통
export const SWEEP_LIMIT = 5;                    // 한 번 부를 때 정리하는 녹음 수
export const AUDIO_TOKENS_PER_SECOND = 32;       // Gemini 음성 토큰(사용량이 비어 올 때 추정용)
export const USAGE_REF_PREFIX = 'mtg-';
// 글을 못 받은 시도(빈 답·끝나지 않은 답)는 이 머리로 적는다 — 쓴 돈은 홈 AI 사용량에 그대로 보이고, 월 상한(monthKrw)에는 들어가지 않는다(명진 결정 11/12).
export const FAILED_USAGE_REF_PREFIX = 'mtgfail-';
const KST = 9 * 3600000;

const EXT_MIME = Object.freeze({
  m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg',
  opus: 'audio/ogg', flac: 'audio/flac', webm: 'audio/webm', '3gp': 'audio/3gpp', amr: 'audio/amr',
});
export const AUDIO_EXTS = Object.freeze(Object.keys(EXT_MIME));
const MIME = /^(audio|video)\/[a-z0-9.+-]{1,60}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;

export const MESSAGES = Object.freeze({
  not_ready: '녹음 전사는 준비 중이에요.',
  monthly_limit: '이번 달 녹음 전사 한도에 닿았어요.',
  busy: '다른 녹음을 전사하는 중이에요. 끝난 뒤 다시 눌러 주세요.',
  too_large: '녹음 파일은 100MB까지 전사할 수 있어요.',
  too_long: '녹음은 1시간까지 전사할 수 있어요.',
  bad_type: '녹음 파일(m4a·mp3·wav 등)만 전사할 수 있어요.',
  bad_request: '요청을 확인하지 못했어요.',
  not_found: '전사 작업을 찾지 못했어요.',
  not_done: '전사가 끝난 녹음만 붙일 수 있어요.',
  drive_failed: '녹음 파일을 Drive에서 읽거나 저장하지 못했어요.',
  // MULTI ②-2: 이 작업공간에 Drive 연결이 없을 때(다른 작업공간 연결로 넘어가지 않음).
  drive_not_connected: 'Google Drive가 아직 연결되지 않았어요. 자료실에서 Drive를 연결해 주세요.',
  // 전사 실패는 원인별로 나눈다(MTG-폰녹음전사, 요청함 10/30 15:29). 화면은 GEMINI_KIND로 세 갈래(전사 서비스·파일 형식) + 연결 끊김(화면 쪽).
  gemini_failed: '전사 서비스(Gemini)가 실패했어요. 녹음은 그대로 있어요. 잠시 뒤 다시 눌러 주세요.',
  gemini_upload: '전사 서비스(Gemini)에 녹음을 올리지 못했어요. 녹음은 그대로 있어요. 잠시 뒤 다시 눌러 주세요.',
  gemini_timeout: '전사 서비스(Gemini) 응답이 늦어 멈췄어요. 녹음은 그대로 있어요. 잠시 뒤 다시 눌러 주세요.',
  gemini_file_failed: '전사 서비스가 녹음 파일 형식을 읽지 못했어요. 녹음은 Drive에 그대로 있어요.',
  gemini_rejected: '전사 서비스가 녹음 파일을 받지 않았어요(파일 형식). 녹음은 Drive에 그대로 있어요.',
  bad_format: '녹음 파일이 깨져 읽지 못했어요(파일 형식). 녹음은 Drive에 그대로 있어요.',
  empty_transcript: '녹음에서 글을 찾지 못했어요.',
  // REC-글못찾음: 전사 서비스 답 자체가 글 없이 왔거나(완료인데 빈 답), 끝까지 못 만들고 일부만 왔을 때(incomplete). 같은 소리도 다시 하면 될 수 있다.
  gemini_empty: '전사 서비스(Gemini)가 글 없이 답했어요. 녹음은 그대로 있어요. 잠시 뒤 다시 눌러 주세요.',
  gemini_incomplete: '전사 서비스(Gemini)가 녹음 끝까지 글로 옮기지 못했어요. 녹음은 그대로 있어요. 잠시 뒤 다시 눌러 주세요.',
  // S60-9 REC-전사모델바꾸기: 받아 적은 글에 같은 말이 비정상으로 되풀이됨 — 조각을 반으로 나눠 다시 하고도 남으면 이 코드로 멈춘다.
  gemini_repeat: '전사 서비스(Gemini)가 같은 말을 되풀이해 적었어요. 녹음은 그대로 있어요. 잠시 뒤 다시 눌러 주세요.',
  usage_unavailable: '이번 달 사용량을 확인하지 못했어요. 잠시 뒤 다시 눌러 주세요.',
  failed: '처리하지 못했어요. 잠시 뒤 다시 눌러 주세요.',
  // REC-정리멈춤반복: 서버 정리 단계가 Edge 실행 시간 안에 끝나지 못해 두 번 끊김 / 요약 답이 길어 잘림.
  step_cut: '한 구간이 서버 시간 안에 끝나지 않아 끊겼어요. 소리는 Drive에 남아 있어요.',
  draft_cut: '회의가 길어 요약이 중간에 잘렸어요. 전사한 글은 남아 있어요.',
  // REC-서버정리(S49-2)
  draft_failed: '전사는 끝났는데 요약을 만들지 못했어요. [다시]를 누르세요.',
  daily_limit: '오늘의 AI 사용 한도에 닿아 요약을 만들지 못했어요. 전사 전문은 남아 있어요.',
  jobs_unavailable: '서버 정리를 아직 쓸 수 없어요.',
  too_many_steps: '정리가 너무 오래 걸려 멈췄어요. [다시]를 누르세요.',
  // REC-정리멈춤반복-긴구간: 요약 요청 시간 초과 · 요약 단계가 서버 실행 시간 안에 끝나지 못해 두 번 끊김(전사 단계 step_cut과 구분).
  draft_timeout: '요약이 오래 걸려 멈췄어요. 전사한 글은 남아 있어요. [다시]를 누르세요.',
  draft_step_cut: '요약이 서버 시간 안에 끝나지 않아 끊겼어요. 전사한 글은 남아 있어요. [다시]를 누르세요.',
  // REC-한회의로잇기(PR-2, 설계 docs/design/rec-join.md 3-5절): 잇기·합치기가 멈춘 이유. 어느 경우에도 보고는 그대로다
  // (보고 글을 바꾸는 곳은 DB 함수 app_meeting_join_apply 한 번뿐이고, 어긋나면 전체가 취소된다).
  report_changed: '그 사이 보고를 수정해서 잇지 않았어요. [다시]를 누르면 수정한 글로 처음부터 이어요.',
  report_gone: '그 보고를 찾지 못했어요. 바뀐 것은 없어요.',
  source_changed: '그 사이 합칠 보고를 수정해서 합치지 않았어요. [다시]를 누르세요.',
  source_gone: '합칠 보고나 녹음을 찾지 못했어요. 바뀐 것은 없어요.',
  already_joined: '이미 다른 보고에 들어간 녹음이에요.',
  no_first_transcript: '회의록 전문이 없는 보고에는 이어 붙일 수 없어요.',
  bad_target: '[회의] 보고에만 이어 붙일 수 있어요.',
  not_applied: '되돌릴 내용을 찾지 못했어요.',
  text_too_long: '글이 너무 길어 이어 붙일 수 없어요.',
});
export const STATUS = Object.freeze({
  not_ready: 503, monthly_limit: 429, busy: 409, too_large: 413, too_long: 413, bad_type: 415, bad_request: 400,
  not_found: 404, not_done: 409, drive_failed: 502, drive_not_connected: 424, gemini_failed: 502,
  gemini_empty: 502, gemini_incomplete: 502, gemini_repeat: 502,
  gemini_upload: 502, gemini_timeout: 504, gemini_file_failed: 422, gemini_rejected: 422, bad_format: 422, empty_transcript: 422, usage_unavailable: 503, failed: 500,
  draft_failed: 502, daily_limit: 429, jobs_unavailable: 503, too_many_steps: 409, step_cut: 504, draft_cut: 502,
  draft_timeout: 504, draft_step_cut: 504,
  report_changed: 409, report_gone: 404, source_changed: 409, source_gone: 404, already_joined: 409, no_first_transcript: 422, bad_target: 422,
  not_applied: 409, text_too_long: 413,
});
// 실패 코드 → 화면 갈래. 'gemini'(전사 서비스) · 'format'(파일 형식). 연결 끊김은 화면이 받은 오류(시간 초과·네트워크)로 가른다.
export const FAIL_KIND = Object.freeze({
  gemini_failed: 'gemini', gemini_upload: 'gemini', gemini_timeout: 'gemini',
  gemini_file_failed: 'format', gemini_rejected: 'format', bad_format: 'format', bad_type: 'format',
  gemini_empty: 'gemini', gemini_incomplete: 'gemini', gemini_repeat: 'gemini',
});
// Gemini 답(HTTP 상태) → 실패 코드. 400·422(요청은 닿았지만 받지 않음)는 파일 형식, 408·504는 늦음, 나머지는 전사 서비스 실패.
export function geminiCode(status) {
  const n = Number(status) || 0;
  if (n === 400 || n === 422) return 'gemini_rejected';
  if (n === 408 || n === 504) return 'gemini_timeout';
  return 'gemini_failed';
}
export class Fail extends Error {
  constructor(code) { super(MESSAGES[code] ? code : 'failed'); this.code = MESSAGES[code] ? code : 'failed'; }
}
export const failBody = code => ({ ok: false, code, error: MESSAGES[code] ?? MESSAGES.failed });

export const isUuid = v => typeof v === 'string' && UUID.test(v);
export const isDriveId = v => typeof v === 'string' && DRIVE_ID.test(v);
export function extOf(name) { const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/); return m ? m[1] : ''; }

// 파일 이름·형식 → Gemini에 알릴 소리 형식(서버 정리의 회의자료 파일, S49-2). 모르면 null.
export function audioMime(name, type) {
  const raw = String(type || '').toLowerCase().split(';')[0].trim();
  if (MIME.test(raw)) return raw;
  return EXT_MIME[extOf(name)] ?? null;
}

// 올리기 머리글 검사. 몸통(녹음)은 검사하지 않고 길이만 본다. 틀리면 Fail.
// name: encodeURIComponent 된 파일 이름, length: Content-Length, type: Content-Type, seconds: 화면이 잰 길이(초, 없을 수 있음).
export function parseUpload({ name, length, type, seconds }) {
  let fileName = '';
  try { fileName = decodeURIComponent(String(name || '')).replace(/[\u0000-\u001f\u007f/\\]/g, ' ').trim(); } catch { throw new Fail('bad_request'); }
  if (!fileName || fileName.length > 255) throw new Fail('bad_request');
  const ext = extOf(fileName);
  if (!AUDIO_EXTS.includes(ext)) throw new Fail('bad_type');
  const raw = String(type || '').toLowerCase().split(';')[0].trim();
  const mime = MIME.test(raw) ? raw : EXT_MIME[ext];
  const size = Number(length);
  if (!Number.isSafeInteger(size) || size <= 0) throw new Fail('bad_request');
  if (size > MAX_BYTES) throw new Fail('too_large');
  let duration = null;
  if (seconds !== null && seconds !== undefined && String(seconds).trim() !== '') {
    const s = Math.ceil(Number(seconds));
    if (!Number.isFinite(s) || s <= 0 || s > 36000) throw new Fail('bad_request');
    if (s > MAX_SECONDS) throw new Fail('too_long');
    duration = s;
  }
  return { fileName, mime, size, duration };
}

// ---- 전사 요청(S60-9: gemini-2.5-flash generateContent, 공식 REST 모양) ----
// POST /v1beta/models/{모델}:generateContent
//   contents[0].parts = [ {fileData:{mimeType,fileUri}}(Files API로 올린 녹음), {text: 지시문} ]
//   generationConfig = { temperature, maxOutputTokens(모델 최대 65,536), thinkingConfig:{thinkingBudget:0}(생각 끔 — 생각 토큰도 출력값으로 셈) }
// 지시문: 한국어 회의를 그대로 받아 적기(요약·의역 금지), 말하는 사람이 바뀌면 '화자1: '·'화자2: ' 줄, 안 들리면 '(안 들림)'만.
// 조각(split.mjs)마다 따로 요청하므로 화자 번호는 조각마다 1부터 새로 시작한다(조각 사이에는 '― N분부터 ―' 머리 줄이 들어감, 구간 사이와 같음).
export const UNCLEAR_MARK = '(안 들림)';
export const TRANSCRIBE_PROMPT = [
  '이 녹음은 한국어 회의입니다. 들리는 말을 처음부터 끝까지 빠짐없이 그대로 받아 적으세요.',
  '- 요약·의역·정리·번역하지 말고 말한 그대로 적습니다. 실제로 한 번 말한 것은 한 번만 적습니다.',
  "- 말하는 사람이 바뀔 때마다 새 줄을 시작하고, 줄 맨 앞에 '화자1: ', '화자2: '처럼 번호를 붙입니다.",
  '- 번호는 이 녹음에서 처음 말한 순서대로 1부터 매기고, 같은 사람에게는 끝까지 같은 번호를 씁니다. 이름을 알아도 번호만 씁니다.',
  "- 한 사람만 말하면 모든 줄을 '화자1: '로 시작합니다.",
  `- 알아들을 수 없는 곳은 내용을 짐작하지 말고 '${UNCLEAR_MARK}'로만 표시합니다.`,
  '- 말이 없는 곳(침묵·잡음·음악)은 적지 않습니다.',
  '- 시각·제목·설명·머리말·마크다운 없이, 받아 적은 줄만 답합니다.',
].join('\n');
export const transcribePath = (model = TRANSCRIBE_MODEL) => `/v1beta/models/${encodeURIComponent(model)}:generateContent`;
export function transcriptionRequest(fileUri, mimeType) {
  return {
    contents: [{ role: 'user', parts: [{ fileData: { mimeType, fileUri } }, { text: TRANSCRIBE_PROMPT }] }],
    generationConfig: {
      temperature: TRANSCRIBE_TEMPERATURE,
      maxOutputTokens: TRANSCRIBE_MAX_OUTPUT_TOKENS,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
}

// ---- 전사 답 읽기(generateContent 답 모양, 공식 REST 참고) ----
// 답: { candidates:[{ content:{ parts:[{text}, …] }, finishReason }], promptFeedback:{ blockReason }, usageMetadata, modelVersion }.
// - 글은 첫 후보의 text 조각을 그대로 잇는다(한 답 안의 조각은 이어진 글). thought:true 조각(생각 요약)은 전사 글이 아니다.
// - finishReason: STOP(끝까지) · MAX_TOKENS(출력 상한에서 잘림) · SAFETY·RECITATION·BLOCKLIST·PROHIBITED_CONTENT·SPII·OTHER 등(멈춤·차단).
// - promptFeedback.blockReason이 있으면 요청 자체가 막혀 후보가 없다.
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const candidateOf = json => (Array.isArray(json?.candidates) && isObj(json.candidates[0]) ? json.candidates[0] : null);
const partsOf = cand => (Array.isArray(cand?.content?.parts) ? cand.content.parts.filter(isObj) : []);
const textParts = cand => partsOf(cand).filter(p => typeof p.text === 'string' && p.thought !== true);
const REASON = /^[A-Z][A-Z_]{0,39}$/;
// 끝난 이유(대문자·밑줄만, 아니면 '').
export function finishReason(json) {
  const r = candidateOf(json)?.finishReason;
  return typeof r === 'string' && REASON.test(r) ? r : '';
}
function blockReason(json) {
  const r = json?.promptFeedback?.blockReason;
  return typeof r === 'string' && r ? (REASON.test(r) ? r : '?') : '';
}
// '화자 1:'·'**화자1**:'·'화자1：' 같은 머리를 '화자1: '로 맞춘다(지시문과 다르게 써도 화면·잇기 규칙이 받는 한 모양으로).
const SPEAKER_HEAD = /^[ \t]*(?:\*\*)?화자[ \t]*(\d{1,3})(?:\*\*)?[ \t]*[:：](?:\*\*)?[ \t]*/;
export function tidySpeakers(text) {
  return String(text || '').replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(SPEAKER_HEAD, (_, n) => `화자${Number(n)}: `)).join('\n').trim();
}
const speakerCount = text => new Set([...String(text || '').matchAll(/^화자(\d{1,3}): /gm)].map(m => m[1])).size;

// ---- 같은 말 되풀이 감지(S60-9) ----
// 일반 모델은 긴 소리를 받아 적다 같은 말·같은 줄을 끝없이 되풀이하다 출력 상한까지 가는 일이 있다(받아 적기 전용 모델과 다른 점).
// 화자 머리를 떼고 낱말(띄어쓰기 단위, 앞뒤 문장부호 뗌)로 나눈 뒤, k낱말 묶음이 끊김 없이 이어 되풀이된 횟수를 센다.
// 기준(사람 말에서는 나오지 않을 만큼 넉넉히, 근거는 PR 본문):
//   1~3낱말 묶음 30번 이상('네 네 네…' 같은 맞장구·표결 '찬성' 줄도 30번 연속은 드묾)
//   4~15낱말(한 문장) 10번 이상 · 16~80낱말(여러 문장 덩어리) 5번 이상.
export const REPEAT_RULES = Object.freeze([
  Object.freeze({ maxWords: 3, times: 30 }),
  Object.freeze({ maxWords: 15, times: 10 }),
  Object.freeze({ maxWords: 80, times: 5 }),
]);
const REPEAT_MAX_WORDS = REPEAT_RULES[REPEAT_RULES.length - 1].maxWords;
const wordsOf = text => String(text || '').split('\n').map(l => l.replace(SPEAKER_HEAD, '')).join(' ').split(/\s+/)
  .map(w => w.replace(/^[("'“‘\[<]+/u, '').replace(/[.,?!…~·"'”’)\]>:;]+$/u, '')).filter(Boolean);
// 기준을 넘은 첫 되풀이 {words: 묶음 낱말 수, times: 이어 나온 횟수}. 없으면 null. 글 내용은 돌려주지 않는다(로그에 수만).
export function repeatRun(text) {
  const w = wordsOf(text);
  for (let k = 1; k <= REPEAT_MAX_WORDS && k * 2 <= w.length; k++) {
    const need = REPEAT_RULES.find(r => k <= r.maxWords).times;
    let run = 0;
    for (let i = k; i <= w.length; i++) {
      if (i < w.length && w[i] === w[i - k]) { run++; continue; }
      const times = Math.floor(run / k) + 1;
      if (run && times >= need) return { words: k, times };
      run = 0;
    }
  }
  return null;
}

// 답의 '모양'만 한 줄로(운영 로그용): 키 이름·끝난 이유·차단·후보/조각 수·글자 수·줄 수·화자 수·되풀이·토큰 수.
// 전사 글·오류 글·파일 주소는 넣지 않는다. 키는 영문·숫자·밑줄만 남기고 나머지는 '?'.
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const keyOf = v => (typeof v === 'string' && KEY.test(v) ? v : '?');
const tally = list => {
  const m = new Map();
  for (const k of list) m.set(k, (m.get(k) || 0) + 1);
  return m.size ? [...m].map(([k, n]) => `${k}:${n}`).join(',') : '-';
};
const num = v => (Number.isSafeInteger(Number(v)) && Number(v) >= 0 && v !== null && v !== '' ? Number(v) : '-');
export function answerShape(json) {
  if (!isObj(json)) return `type=${json === null ? 'null' : Array.isArray(json) ? 'array' : typeof json}`;
  const cands = Array.isArray(json.candidates) ? json.candidates : [];
  const cand = candidateOf(json);
  const parts = partsOf(cand);
  const texts = textParts(cand);
  const text = tidySpeakers(texts.map(p => p.text).join(''));
  const rep = text ? repeatRun(text) : null;
  const u = isObj(json.usageMetadata) ? json.usageMetadata : {};
  return [
    `finish=${finishReason(json) || (typeof cand?.finishReason === 'string' ? '?' : '-')}`,
    `block=${blockReason(json) || '-'}`,
    `keys=${Object.keys(json).map(keyOf).sort().join(',') || '-'}`,
    `cands=${cands.length}`,
    `parts=${tally(parts.map(p => (p.thought === true ? 'thought' : typeof p.text === 'string' ? 'text' : Object.keys(p).map(keyOf)[0] || '?')))}`,
    `chars=${text.length}`,
    `blank=${texts.filter(p => !p.text.trim()).length}`,
    `lines=${text ? text.split('\n').filter(l => l.trim()).length : 0}`,
    `speakers=${speakerCount(text)}`,
    `repeat=${rep ? `${rep.words}x${rep.times}` : '-'}`,
    `out_tokens=${num(u.candidatesTokenCount)}`,
    `thought_tokens=${num(u.thoughtsTokenCount)}`,
  ].join(' ');
}
// 전사 응답 읽기. 글을 받지 못했으면 원인별 Fail(지금 갈래 그대로):
//   형식이 아님 · 요청 차단(blockReason) · 그 밖 멈춤(SAFETY 등) → gemini_failed
//   같은 말 되풀이(repeatRun) → gemini_repeat(반으로 나눠 다시) · 출력 상한에서 잘림(MAX_TOKENS) → gemini_incomplete(반으로 나눠 다시)
//   끝까지 왔는데 글 없음 → gemini_empty. 되풀이는 잘림보다 먼저 본다(되풀이하다 상한에 닿는 일이 많아 원인을 사실대로 남김).
const DONE = new Set(['STOP', 'FINISH_REASON_UNSPECIFIED', '']);
export function readTranscript(json) {
  if (!isObj(json)) throw new Fail('gemini_failed');
  if (blockReason(json)) throw new Fail('gemini_failed');
  const cand = candidateOf(json);
  const finish = finishReason(json);
  if (cand && typeof cand.finishReason === 'string' && !finish) throw new Fail('gemini_failed');
  const text = tidySpeakers(textParts(cand).map(p => p.text).join(''));
  if (text && repeatRun(text)) throw new Fail('gemini_repeat');
  if (finish === 'MAX_TOKENS') throw new Fail('gemini_incomplete');
  if (!DONE.has(finish)) throw new Fail('gemini_failed');
  if (!text) throw new Fail('gemini_empty');
  return { text, speakerSplit: speakerCount(text) >= 2 };
}

const count = v => (Number.isSafeInteger(Number(v)) && Number(v) >= 0 ? Number(v) : 0);
// 사용량 읽기(usageMetadata): 입력 promptTokenCount(그중 음성은 promptTokensDetails의 AUDIO), 출력 = candidatesTokenCount + thoughtsTokenCount
// (생각 토큰도 출력값 — 생각을 꺼도 혹시 오면 그대로 셈). 숫자가 없으면 녹음 길이(초) × 32로 음성 토큰을 추정해 월 상한이 비지 않게 한다.
export function readUsage(json, duration, model = TRANSCRIBE_MODEL) {
  const u = isObj(json?.usageMetadata) ? json.usageMetadata : {};
  let input = count(u.promptTokenCount);
  const output = count(u.candidatesTokenCount) + count(u.thoughtsTokenCount);
  let audio = 0;
  const modal = Array.isArray(u.promptTokensDetails) ? u.promptTokensDetails : [];
  for (const m of modal) if (String(m?.modality || '').toUpperCase() === 'AUDIO') audio += count(m.tokenCount);
  if (!input) input = count(Math.ceil((duration || 0) * AUDIO_TOKENS_PER_SECOND));
  if (!audio || audio > input) audio = input;
  const name = String(json?.modelVersion || model).trim().toLowerCase().replace(/^models\//, '');
  return { model: /^[a-z0-9][a-z0-9._-]{0,63}$/.test(name) ? name : model, calls: 1, input_tokens: input, audio_tokens: audio, output_tokens: output };
}

export function seoulDay(at) { return new Date(at.getTime() + KST).toISOString().slice(0, 10); }
export function monthStart(at) { return `${seoulDay(at).slice(0, 7)}-01`; }
// 사용량 보고 번호. 작업마다·시도마다 하나(같은 작업을 다시 전사해도 겹치지 않게).
// piece: 긴 소리를 나눠 한 번에 여러 조각을 동시에 전사할 때 조각 번호(1부터, REC-긴녹음나눠전사) — 같은 밀리초에 끝나도 겹치지 않게.
export function usageRef(jobId, at, failed = false, piece = 0) {
  const n = Number.isSafeInteger(piece) && piece > 0 && piece < 1000 ? `-c${piece}` : '';
  return `${failed ? FAILED_USAGE_REF_PREFIX : USAGE_REF_PREFIX}${jobId}-${at.getTime().toString(36)}${n}`;
}
// 이번 달 회의 전사 추정 금액(원). rows: app_ai_external_usage 중 ref가 mtg-로 시작하는 행.
export function monthKrw(rows) {
  let sum = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (typeof r?.ref === 'string' && !r.ref.startsWith(USAGE_REF_PREFIX)) continue;
    sum += geminiKrw(r?.model, count(r?.input_tokens), count(r?.audio_tokens), count(r?.output_tokens));
  }
  return Math.round(sum * 100) / 100;
}
export const overLimit = krw => !(Number.isFinite(krw) && krw < MONTHLY_LIMIT_KRW);

// 진행 중인데 오래된 작업(끊긴 것).
export function isStale(job, now) {
  if (job?.status !== 'running') return false;
  const t = Date.parse(job.started_at || job.updated_at || job.created_at || '');
  return !Number.isFinite(t) || now.getTime() - t > RUNNING_STALE_MS;
}
// 전사를 시작할 수 있는 상태(올림·실패면 다시, 끊긴 진행 중도 다시).
export const canStart = (job, now) => job?.status === 'uploaded' || job?.status === 'failed' || isStale(job, now);
// 30일 지난 붙이지 않은 녹음의 기준 시각.
export function trashBefore(now) { return new Date(now.getTime() - UNATTACHED_TRASH_DAYS * 86400000).toISOString(); }
// 회의에 붙일 자료 행(meeting-files가 만드는 회의자료 행과 같은 모양, 링크만).
export function attachDocument({ job, meeting, userId }) {
  const title = job.file_name.replace(/\.[^.]+$/, '').trim() || job.file_name;
  return {
    workspace_id: meeting.workspace_id, project_id: meeting.project_id ?? null, meeting_id: meeting.id,
    title, category: '회의자료', source: null, document_date: null, description: null, tags: ['회의자료', '회의녹음'],
    drive_url: `https://drive.google.com/file/d/${job.drive_file_id}/view`, file_id: job.drive_file_id,
    file_name: job.file_name, mime_type: job.mime_type, file_size: job.size_bytes,
    visibility: 'private', uploaded_by: userId, auto_classified: false,
  };
}

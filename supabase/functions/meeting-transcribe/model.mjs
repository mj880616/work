// MTG-녹음초안 2단계: 회의 녹음 전사(Edge meeting-transcribe)의 순수 규칙. Node 시험·Deno 배포 양쪽에서 읽으므로 .mjs로 둔다.
// - 전사 요청 모양·응답 읽기는 명진의 통화 전사 앱 스크립트(Gemini Interactions, docs/ops/call-prompts-patch.md 4절 ⑦)와 같다:
//   transcription_config(language_codes ko-KR, mode verbatim + diarization_mode speaker), store false,
//   화자 구분을 거절(HTTP 400)하면 화자 구분 없이 한 번 더, 단어별 화자 표시로 '화자1: …' 줄 묶기.
// - 다른 점: Gemini 안내(2026-10 확인)상 한 번 요청은 녹음 1시간까지, 화자 구분은 30분까지라 30분 넘는 녹음은 처음부터 화자 구분 없이 보낸다.
// - 전사 글은 여기서 저장하지 않는다. 부른 화면에 한 번 돌려줄 뿐이다(원문은 회의 기록에만).
import { geminiKrw } from '../_shared/ai-prices.mjs';

// 통화 전사 스크립트의 MODEL 값은 저장소 밖(앱 스크립트)에 있어 확인하지 못했다. Gemini 전사 안내의 전사 전용 모델을 쓴다.
export const TRANSCRIBE_MODEL = 'gemini-3.5-transcribe';
export const GEMINI_KEY_NAME = 'GEMINI_API_KEY';
export const MAX_BYTES = 100 * 1024 * 1024;      // 회의자료 올리기(meeting-files)와 같은 100MB
export const MAX_SECONDS = 60 * 60;              // Gemini 한 번 요청 상한 1시간
export const DIARIZE_MAX_SECONDS = 30 * 60;      // 화자 구분은 30분까지
export const MONTHLY_LIMIT_KRW = 5000;           // 회의 전사 이번 달 상한(추정 금액, 서울 날짜 기준)
export const RUNNING_STALE_MS = 15 * 60 * 1000;  // 진행 중으로 15분 넘게 남은 작업은 끊긴 것으로 본다
export const UNATTACHED_TRASH_DAYS = 30;         // 회의에 붙이지 않은 녹음은 30일 뒤 Drive 휴지통
export const SWEEP_LIMIT = 5;                    // 한 번 부를 때 정리하는 녹음 수
export const AUDIO_TOKENS_PER_SECOND = 32;       // Gemini 음성 토큰(사용량이 비어 올 때 추정용)
export const USAGE_REF_PREFIX = 'mtg-';
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
  gemini_failed: '전사하지 못했어요. 잠시 뒤 다시 눌러 주세요.',
  empty_transcript: '녹음에서 글을 찾지 못했어요.',
  usage_unavailable: '이번 달 사용량을 확인하지 못했어요. 잠시 뒤 다시 눌러 주세요.',
  failed: '처리하지 못했어요. 잠시 뒤 다시 눌러 주세요.',
});
export const STATUS = Object.freeze({
  not_ready: 503, monthly_limit: 429, busy: 409, too_large: 413, too_long: 413, bad_type: 415, bad_request: 400,
  not_found: 404, not_done: 409, drive_failed: 502, gemini_failed: 502, empty_transcript: 422, usage_unavailable: 503, failed: 500,
});
export class Fail extends Error {
  constructor(code) { super(MESSAGES[code] ? code : 'failed'); this.code = MESSAGES[code] ? code : 'failed'; }
}
export const failBody = code => ({ ok: false, code, error: MESSAGES[code] ?? MESSAGES.failed });

export const isUuid = v => typeof v === 'string' && UUID.test(v);
export const isDriveId = v => typeof v === 'string' && DRIVE_ID.test(v);
export function extOf(name) { const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/); return m ? m[1] : ''; }

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

// Gemini 전사 요청 몸통(통화 전사 스크립트와 같은 모양). diarize: 화자 구분 켜기.
export function transcriptionRequest(fileUri, mimeType, diarize, model = TRANSCRIBE_MODEL) {
  return {
    model,
    input: [{ type: 'audio', uri: fileUri, mime_type: mimeType }],
    generation_config: {
      transcription_config: {
        language_codes: ['ko-KR'],
        mode: diarize ? { type: 'verbatim', diarization_mode: 'speaker' } : { type: 'verbatim' },
      },
    },
    store: false,
  };
}
// 30분 넘는(또는 길이를 모르는) 녹음은 처음부터 화자 구분 없이 보낸다.
export const wantsDiarize = duration => Number.isFinite(duration) && duration > 0 && duration <= DIARIZE_MAX_SECONDS;

function stepsOf(json) {
  if (Array.isArray(json?.steps)) return json.steps;
  if (Array.isArray(json?.interaction?.steps)) return json.interaction.steps;
  return [];
}
// 단어별 화자 표시(spk_1 …)로 같은 화자가 이어지는 단어를 한 줄로 묶는다. 화자 표시가 없거나 한 명뿐이면 ''.
export function speakerLines(json) {
  const words = [];
  for (const step of stepsOf(json)) {
    if (!step || !Array.isArray(step.content)) continue;
    for (const part of step.content) {
      if (!part || !Array.isArray(part.annotations)) continue;
      for (const a of part.annotations) {
        if (a && a.type === 'word_info' && typeof a.text === 'string' && a.text.trim() && typeof a.speaker === 'string' && a.speaker) {
          words.push({ speaker: a.speaker, text: a.text.trim() });
        }
      }
    }
  }
  if (!words.length) return '';
  const order = [];
  for (const w of words) if (!order.includes(w.speaker)) order.push(w.speaker);
  if (order.length < 2) return '';
  const lines = [];
  let current = null, buffer = [];
  for (const w of words) {
    if (w.speaker !== current && buffer.length) { lines.push(`화자${order.indexOf(current) + 1}: ${buffer.join(' ')}`); buffer = []; }
    current = w.speaker;
    buffer.push(w.text);
  }
  if (buffer.length) lines.push(`화자${order.indexOf(current) + 1}: ${buffer.join(' ')}`);
  return lines.map(line => line.replace(/\s+([.,?!。])/g, '$1')).join('\n');
}
// 전사 응답 읽기. 끝나지 않았거나 글이 없으면 Fail.
export function readTranscript(json) {
  if (!json || typeof json !== 'object') throw new Fail('gemini_failed');
  if (json.status && json.status !== 'completed') throw new Fail('gemini_failed');
  const parts = [];
  if (typeof json.output_text === 'string' && json.output_text.trim()) parts.push(json.output_text);
  else if (typeof json.interaction?.output_text === 'string' && json.interaction.output_text.trim()) parts.push(json.interaction.output_text);
  else {
    for (const step of stepsOf(json)) {
      if (!Array.isArray(step?.content)) continue;
      for (const part of step.content) if (part && part.type === 'text' && typeof part.text === 'string') parts.push(part.text);
    }
  }
  const plain = parts.join('\n').trim();
  const split = speakerLines(json);
  const text = split || plain;
  if (!text) throw new Fail('empty_transcript');
  return { text, speakerSplit: !!split };
}

const count = v => (Number.isSafeInteger(Number(v)) && Number(v) >= 0 ? Number(v) : 0);
// 사용량 읽기. 응답에 숫자가 없으면 녹음 길이(초) × 32로 음성 토큰을 추정해 월 상한이 비지 않게 한다.
export function readUsage(json, duration, model = TRANSCRIBE_MODEL) {
  const u = json?.usage ?? json?.interaction?.usage ?? {};
  let input = count(u.total_input_tokens ?? u.input_tokens ?? u.prompt_token_count);
  const output = count(u.total_output_tokens ?? u.output_tokens) + count(u.total_thought_tokens ?? u.thought_tokens);
  let audio = 0;
  const modal = Array.isArray(u.input_tokens_by_modality) ? u.input_tokens_by_modality : [];
  for (const m of modal) if (String(m?.modality || '').toLowerCase() === 'audio') audio += count(m.tokens ?? m.token_count);
  if (!input) input = count(Math.ceil((duration || 0) * AUDIO_TOKENS_PER_SECOND));
  if (!audio || audio > input) audio = input;
  const name = String(json?.model || model).trim().toLowerCase().replace(/^models\//, '');
  return { model: /^[a-z0-9][a-z0-9._-]{0,63}$/.test(name) ? name : model, calls: 1, input_tokens: input, audio_tokens: audio, output_tokens: output };
}

export function seoulDay(at) { return new Date(at.getTime() + KST).toISOString().slice(0, 10); }
export function monthStart(at) { return `${seoulDay(at).slice(0, 7)}-01`; }
// 사용량 보고 번호. 작업마다·시도마다 하나(같은 작업을 다시 전사해도 겹치지 않게).
export function usageRef(jobId, at) { return `${USAGE_REF_PREFIX}${jobId}-${at.getTime().toString(36)}`; }
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

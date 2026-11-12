import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { parseAiUsageReport } from '../../supabase/functions/drive-summary/ai-usage.mjs';

// AI-비용보기 2단계: 통화 전사·분석 앱 스크립트에 붙이는 사용량 보고(docs/ops/ai-usage-report.gs).
const source = fs.readFileSync(new URL('../../docs/ops/ai-usage-report.gs', import.meta.url), 'utf8');
function load() {
  const sent = [], logs = [];
  const props = { COLLECTOR_HEARTBEAT_SECRET: 'test-secret' };
  const ctx = {
    Utilities: {
      getUuid: () => crypto.randomUUID(), DigestAlgorithm: { SHA_256: 1 }, Charset: { UTF_8: 1 },
      computeDigest: (_a, t) => [...crypto.createHash('sha256').update(t).digest()].map(b => (b > 127 ? b - 256 : b)),
    },
    Logger: { log: m => logs.push(String(m)) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null }) },
    UrlFetchApp: { fetch: (url, opt) => { sent.push({ url, opt }); return { getResponseCode: () => ctx.code ?? 200 }; } },
    JSON, Number, String, Math, Array, isFinite, code: 200,
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return { ctx, sent, logs, props };
}
const answer = { responseId: 'resp-1', modelVersion: 'models/gemini-2.5-flash', candidates: [{ content: { parts: [{ text: '전사 글은 보내지 않는다' }] } }],
  usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 40, thoughtsTokenCount: 10, promptTokensDetails: [{ modality: 'AUDIO', tokenCount: 300 }] } };

test('비밀값·답 글은 코드에 없고, 숫자·모델·보고 번호만 서버 검사를 통과하는 모양으로 보낸다', () => {
  assert.doesNotMatch(source, /COLLECTOR_HEARTBEAT_SECRET\s*=\s*['"][^'"]/);
  const { ctx, sent } = load();
  assert.equal(ctx.web2AiUsage_report('transcript', answer), true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /\/functions\/v1\/drive-summary\?action=ai_usage$/);
  assert.equal(sent[0].opt.headers['x-collector-heartbeat-secret'], 'test-secret');
  assert.doesNotMatch(sent[0].opt.payload, /전사 글|resp-1/);
  const body = parseAiUsageReport(sent[0].opt.payload);
  assert.ok(body);
  assert.match(body.ref, /^call-[0-9a-f]{32}$/);
  assert.deepEqual({ model: body.model, input: body.input_tokens, audio: body.audio_tokens, output: body.output_tokens }, { model: 'gemini-2.5-flash', input: 500, audio: 300, output: 50 });
});

test('분석은 calla-, 같은 답은 같은 번호(두 번 보내도 한 번만 셈), 전사·분석 번호는 다름', () => {
  const { ctx, sent } = load();
  ctx.web2AiUsage_report('analysis', JSON.stringify(answer));
  ctx.web2AiUsage_report('analysis', answer);
  ctx.web2AiUsage_report('transcript', answer);
  const refs = sent.map(s => JSON.parse(s.opt.payload).ref);
  assert.match(refs[0], /^calla-[0-9a-f]{32}$/);
  assert.equal(refs[0], refs[1]);
  assert.notEqual(refs[0].slice(6), refs[2].slice(5));
  assert.ok(parseAiUsageReport(sent[0].opt.payload));
});

test('실패해도 오류를 던지지 않는다(전사 흐름을 멈추지 않음): 비밀값 없음·사용량 없음·잘못된 source·HTTP 실패', () => {
  const a = load(); delete a.props.COLLECTOR_HEARTBEAT_SECRET;
  assert.equal(a.ctx.web2AiUsage_report('transcript', answer), false); assert.equal(a.sent.length, 0);
  const b = load();
  assert.equal(b.ctx.web2AiUsage_report('transcript', { candidates: [] }), false);
  assert.equal(b.ctx.web2AiUsage_report('meeting', answer), false);
  assert.equal(b.ctx.web2AiUsage_report('transcript', 'not json'), false);
  assert.equal(b.sent.length, 0);
  const c = load(); c.ctx.code = 401;
  assert.equal(c.ctx.web2AiUsage_report('transcript', answer), false);
  assert.ok(c.logs.every(l => !l.includes('test-secret')));
});

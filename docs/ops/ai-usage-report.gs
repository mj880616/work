/**
 * Web2 AI 사용량 보고 — 통화 전사·통화 분석 (AI-비용보기 2단계)
 *
 * 하는 일: 기존 통화 전사·분석 앱 스크립트가 Gemini를 한 번 부를 때마다, Gemini 답에 들어 있는 사용량 숫자
 *   (입력·음성·출력 토큰, 모델 이름)만 Web2에 보낸다. 전사 글·분석 글·파일 이름·전화번호는 보내지 않는다.
 *   Web2 프로필 'AI 사용량'이 이 숫자로 통화 전사·분석 금액(추정)을 회의 녹음 전사와 나눠 센다.
 *
 * 붙이는 곳: 기존 "통화 전사·분석" 앱 스크립트 프로젝트에 새 파일(+ → 스크립트)로 이 내용을 통째로 붙인다.
 *   그다음 Gemini 답을 JSON으로 읽은 바로 다음 줄에 한 줄을 더한다.
 *     전사:  web2AiUsage_report('transcript', 답JSON);
 *     분석:  web2AiUsage_report('analysis', 답JSON);
 *   이 함수는 실패해도 오류를 던지지 않는다(전사·분석 흐름을 멈추지 않음). 실패는 실행 로그에 한 줄만 남긴다.
 *
 * 비밀값: 이 코드에 넣지 않는다. 이 프로젝트의 "프로젝트 설정 → 스크립트 속성" COLLECTOR_HEARTBEAT_SECRET에만 둔다
 *   (수집 점검 신호 스크립트와 같은 값. 스크립트 속성은 프로젝트마다 따로라 이 프로젝트에도 한 번 넣는다).
 *
 * 보고 번호(ref): 전사는 'call-', 분석은 'calla-'로 시작한다. Gemini 답의 responseId로 만들어 같은 답을 두 번 보내도 한 번만 센다.
 * 함수 이름은 모두 web2AiUsage_로 시작한다(기존 스크립트와 겹치지 않게).
 */

// Web2 받는 입구(공개 주소, 비밀값 아님)
var WEB2_AI_USAGE_URL = 'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/drive-summary?action=ai_usage';
var WEB2_AI_USAGE_SECRET_KEY = 'COLLECTOR_HEARTBEAT_SECRET';
var WEB2_AI_USAGE_PREFIX = { transcript: 'call-', analysis: 'calla-' };

/**
 * Gemini 답 하나의 사용량을 Web2에 보낸다.
 * @param {string} source 'transcript'(통화 전사) 또는 'analysis'(통화 분석)
 * @param {Object|string} geminiJson Gemini generateContent 답(JSON.parse한 것 또는 글 그대로)
 * @param {string=} model (선택) 답에 modelVersion이 없을 때 쓸 모델 이름(예: 'gemini-2.5-flash')
 * @return {boolean} 보냈으면 true
 */
function web2AiUsage_report(source, geminiJson, model) {
  try {
    if (!WEB2_AI_USAGE_PREFIX[source]) { Logger.log('Web2 AI 사용량: source는 transcript 또는 analysis만'); return false; }
    var json = typeof geminiJson === 'string' ? JSON.parse(geminiJson) : geminiJson;
    var body = web2AiUsage_body_(source, json, model);
    if (!body) { Logger.log('Web2 AI 사용량: 답에 사용량이 없어 보내지 않음'); return false; }
    var secret = PropertiesService.getScriptProperties().getProperty(WEB2_AI_USAGE_SECRET_KEY);
    if (!secret) { Logger.log('Web2 AI 사용량: 스크립트 속성에 ' + WEB2_AI_USAGE_SECRET_KEY + '가 없음'); return false; }
    var res = UrlFetchApp.fetch(WEB2_AI_USAGE_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-collector-heartbeat-secret': secret },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    if (code !== 200) { Logger.log('Web2 AI 사용량: 보내기 실패 HTTP ' + code); return false; }
    return true;
  } catch (e) {
    Logger.log('Web2 AI 사용량: 보내기 실패 ' + (e && e.name ? e.name : 'Error'));
    return false;
  }
}

/**
 * 처음 한 번 시험: 일부러 빈 사용량을 보내 비밀값만 확인한다(기록은 남지 않음).
 * 로그가 "비밀값 정상(400 INVALID_BODY)"이면 성공, "401"이면 스크립트 속성 값이 틀린 것.
 */
function web2AiUsage_test() {
  var secret = PropertiesService.getScriptProperties().getProperty(WEB2_AI_USAGE_SECRET_KEY);
  if (!secret) throw new Error('스크립트 속성에 ' + WEB2_AI_USAGE_SECRET_KEY + '가 없습니다.');
  var res = UrlFetchApp.fetch(WEB2_AI_USAGE_URL, {
    method: 'post', contentType: 'application/json', headers: { 'x-collector-heartbeat-secret': secret },
    payload: '{}', muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code === 400) Logger.log('비밀값 정상(400 INVALID_BODY). 이제 전사·분석 뒤 한 줄을 더하면 됩니다.');
  else if (code === 401) throw new Error('401: 스크립트 속성 ' + WEB2_AI_USAGE_SECRET_KEY + ' 값이 Web2와 다릅니다.');
  else throw new Error('예상 밖 응답 HTTP ' + code);
}

// ── 아래는 고칠 필요 없음 ─────────────────────────────────────────────

// Gemini 답 → 보고 몸통(숫자·모델 이름·보고 번호만). 음성 토큰은 입력의 일부, 출력에는 생각 토큰을 더한다.
function web2AiUsage_body_(source, json, model) {
  if (!json || typeof json !== 'object') return null;
  var u = json.usageMetadata;
  if (!u || typeof u !== 'object') return null;
  var n = function (v) { v = Number(v); return isFinite(v) && v > 0 ? Math.floor(v) : 0; };
  var input = n(u.promptTokenCount);
  var output = n(u.candidatesTokenCount) + n(u.thoughtsTokenCount);
  var audio = 0;
  (Array.isArray(u.promptTokensDetails) ? u.promptTokensDetails : []).forEach(function (d) {
    if (d && String(d.modality || '').toUpperCase() === 'AUDIO') audio += n(d.tokenCount);
  });
  if (audio > input) audio = input;
  if (!input && !output) return null;
  var name = String(json.modelVersion || model || '').trim().toLowerCase().replace(/^models\//, '');
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name)) return null;
  var id = String(json.responseId || '') || Utilities.getUuid();
  return {
    ref: WEB2_AI_USAGE_PREFIX[source] + web2AiUsage_hash_(source + ':' + id),
    provider: 'gemini', source: source, model: name, calls: 1,
    input_tokens: input, audio_tokens: audio, output_tokens: output,
  };
}

// 글 → 32자 16진수(보고 번호용. 답 번호를 그대로 보내지 않는다).
function web2AiUsage_hash_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.slice(0, 16).map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

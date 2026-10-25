/**
 * 통화 요약용 맥락 문서 자동 갱신 (CALL-맥락문서)
 *
 * 하는 일: 하루 한 번 Web2 서버(collector-feed ?action=context)에서 담당조직(정식 이름·약칭)과 진행 중 프로젝트의 **이름만** 받아,
 *   '통화 요약용 맥락' 문서 안의 **자동 구간**(시작 줄과 끝 줄 사이)만 새로 쓴다.
 *   - 표지 줄은 문서에 한 번 넣어 두고(callCtx_addMarkers), 사람이 지우거나 옮기지 않는다. 표지 밖(명진이 쓴 부분)은 건드리지 않는다.
 *   - 표지가 없거나 하나뿐이거나 순서가 바뀌었거나 둘 이상이면 아무것도 쓰지 않고 실패로 센다.
 *   - 받은 목록이 비었거나 모양이 다르면 문서를 덮어쓰지 않는다(마지막 성공본이 남는다). 내용이 어제와 같으면 문서를 건드리지 않는다.
 *   - 연속 3번 실패하면 일부러 오류를 내서 앱 스크립트 실패 알림 메일이 가게 한다.
 *   - 시험 모드(기본 켬): 받아서 개수만 로그에 적고 문서는 고치지 않는다. 스크립트 속성 CALL_CTX_TEST_MODE 가 '끔'일 때만 문서에 쓴다.
 *   - 사람 이름·연락처·메모·ID는 받지도 쓰지도 않는다. 문서 ID·비밀값은 이 코드에 넣지 않고 로그에도 남기지 않는다.
 *
 * 붙여 넣는 곳: 'Web2 수집 보내기' 프로젝트(collector-feed.gs가 있는 프로젝트)에 **새 파일로 더한다**. 비밀값 COLLECTOR_FEED_SECRET 은 이미 그 프로젝트에 있다.
 *   통화 분석 스크립트(trascription)는 스크립트 속성이 많아 화면에서 속성을 더 넣을 수 없으므로(collector-feed-setup.md) 그쪽에는 붙이지 않는다.
 *   그 프로젝트에 스크립트 속성 CALL_CONTEXT_DOC_ID(맥락 문서 주소 끝부분, 분석 스크립트가 쓰는 것과 같은 문서)만 새로 넣는다.
 * 설치 안내: docs/ops/call-context-sync.md · 설계: docs/design/call-context.md · 서버: supabase/functions/collector-feed/context.ts
 * 기존 스크립트와 이름이 겹치지 않도록 함수·설정 이름은 모두 callCtx / CALL_CTX 로 시작한다.
 */

// ── 여기 한 칸은 보통 비워 둔다 (속성 CALL_CONTEXT_DOC_ID 가 없을 때만 쓴다) ─────────────────
var CALL_CTX_DOC_ID_FALLBACK = '여기에_맥락_문서_주소_끝부분';
// ─────────────────────────────────────────────────────────────────────

// Web2 받는 입구(공개 주소, 비밀값 아님)
var CALL_CTX_URL = 'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/collector-feed';
var CALL_CTX_SECRET_KEY = 'COLLECTOR_FEED_SECRET';
var CALL_CTX_SECRET_HEADER = 'x-collector-feed-secret';
var CALL_CTX_DOC_KEY = 'CALL_CONTEXT_DOC_ID';        // 분석 스크립트가 이미 쓰는 속성 이름
var CALL_CTX_TEST_KEY = 'CALL_CTX_TEST_MODE';        // 없거나 '켬'이면 시험 모드. '끔'일 때만 문서에 쓴다
var CALL_CTX_STATE_KEY = 'CALL_CTX_STATE';           // {fails, lastOkDay}
var CALL_CTX_START = '<<WEB2 자동 시작>>';
var CALL_CTX_END = '<<WEB2 자동 끝>>';
var CALL_CTX_NOTE = '(이 구간은 Web2에서 하루 한 번 자동으로 바뀝니다. 직접 고치지 마세요. 아래 시작·끝 표시 줄도 지우지 마세요.)';
var CALL_CTX_FAIL_ALERT = 3;                         // 연속 실패가 이 횟수가 되면 오류를 내서 알림 메일이 가게 한다
// 서버 context.ts 와 같은 상한(스크립트도 한 번 더 지킨다)
var CALL_CTX_MAX_ORGS = 150;
var CALL_CTX_MAX_ORG_CHARS = 60;
var CALL_CTX_MAX_ALIASES = 5;
var CALL_CTX_MAX_ALIAS_CHARS = 30;
var CALL_CTX_MAX_PROJECTS = 80;
var CALL_CTX_MAX_PROJECT_CHARS = 100;
var CALL_CTX_MAX_TOTAL_CHARS = 6000;                 // 이름·약칭 글자 합계
var CALL_CTX_MAX_SECTION_CHARS = 8000;               // 서식 줄까지 포함한 자동 구간 전체

// ── 손으로 [실행]하는 함수 ───────────────────────────────────────────────

/** 문서에 표지 줄 두 개를 맨 아래에 넣는다(둘 다 없을 때만). 넣은 뒤 두 줄 사이로 옮기고 싶은 옛 목록은 직접 지운다. */
function callCtx_addMarkers() {
  var body = callCtx_openBody_();
  var found = callCtxFindMarkers(callCtx_texts_(body));
  if (found.ok || found.reason !== 'no-markers') {
    Logger.log('표지 줄을 넣지 않았습니다: ' + found.reason + ' (이미 있거나 모양이 이상합니다. 문서를 확인하세요)');
    return;
  }
  body.appendParagraph(CALL_CTX_START);
  body.appendParagraph(CALL_CTX_END);
  Logger.log('문서 맨 아래에 표지 두 줄을 넣었습니다. 이 두 줄 사이가 자동 구간입니다.');
}

/** 받아서 무엇이 바뀔지만 본다(문서는 고치지 않는다). 시험 모드와 상관없이 쓰기 없음. */
function callCtx_check() {
  callCtx_sync_(false);
}

/** 하루 한 번 트리거가 부른다. 시험 모드(기본)면 쓰지 않고 로그만, CALL_CTX_TEST_MODE 가 '끔'이면 자동 구간을 새로 쓴다. */
function callCtx_run() {
  var testMode = PropertiesService.getScriptProperties().getProperty(CALL_CTX_TEST_KEY) !== '끔';
  callCtx_sync_(!testMode);
}

/** 매일 새벽 4시 20분 무렵 callCtx_run 을 부르게 한다. */
function callCtx_installDailyTrigger() {
  callCtx_removeTrigger();
  ScriptApp.newTrigger('callCtx_run').timeBased().atHour(4).nearMinute(20).everyDays(1).create();
  Logger.log('매일 새벽 4시대에 callCtx_run 을 실행하도록 설치했습니다.');
}

function callCtx_removeTrigger() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'callCtx_run') { ScriptApp.deleteTrigger(t); removed++; }
  });
  Logger.log('callCtx_run 트리거 ' + removed + '개를 지웠습니다.');
}

// ── 내부 (Apps Script 서비스 사용) ────────────────────────────────────────

function callCtx_sync_(write) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) { Logger.log('다른 갱신이 실행 중이라 건너뜁니다.'); return; }
  try {
    var state = callCtx_loadState_();
    var failure = null;
    try {
      failure = callCtx_attempt_(write);
    } catch (e) {
      failure = '예상하지 못한 오류';   // 오류 글에 문서·비밀값이 섞이지 않게 원문은 적지 않는다
    }
    var nowMs = Date.now();
    if (failure) {
      if (!write) { Logger.log('맥락 갱신 확인 실패(시험·확인 전용이라 연속 실패로 세지 않음): ' + failure); return; }
      state.fails = (state.fails || 0) + 1;
      callCtx_saveState_(state);
      Logger.log('맥락 갱신 실패(' + state.fails + '회 연속): ' + failure);
      if (callCtxShouldAlert(state.fails)) throw new Error('맥락 갱신이 ' + state.fails + '번 연속 실패했습니다. 마지막 사유: ' + failure);
      return;
    }
    if (write) { state.fails = 0; state.lastOkDay = callCtxKstDay(nowMs); callCtx_saveState_(state); }
  } finally {
    lock.releaseLock();
  }
}

/** 한 번 시도. 성공이면 null, 실패면 사유 글(이름·ID·비밀값 없음). */
function callCtx_attempt_(write) {
  var secret = PropertiesService.getScriptProperties().getProperty(CALL_CTX_SECRET_KEY);
  if (!secret) return '스크립트 속성 ' + CALL_CTX_SECRET_KEY + ' 이 없습니다';
  var res = callCtx_post_(secret);
  if (res.code !== 200) return 'Web2 응답 ' + res.code + (res.code === 0 ? '(연결 실패)' : '');
  var ctx = callCtxParse(res.json);
  if (!ctx.ok) return '받은 목록을 쓰지 않습니다: ' + ctx.reason;
  var lines = callCtxRender(ctx, callCtxKstDay(Date.now()));
  if (lines.join('\n').length > CALL_CTX_MAX_SECTION_CHARS) return '자동 구간이 너무 깁니다';

  var body = callCtx_openBody_();
  if (!body) return '맥락 문서를 열 수 없습니다';
  var texts = callCtx_texts_(body);
  var found = callCtxFindMarkers(texts);
  if (!found.ok) return '표지 줄 문제: ' + found.reason;
  var old = texts.slice(found.start + 1, found.end);
  Logger.log('받음: 조직 ' + ctx.organizations.length + '개, 프로젝트 ' + ctx.projects.length + '개, 생략 ' + (ctx.omitted.organizations + ctx.omitted.projects) + '개 / 자동 구간 ' + lines.length + '줄(기존 ' + old.length + '줄)');
  if (callCtxSame(old, lines)) { Logger.log('어제와 같아서 문서를 건드리지 않습니다.'); return null; }
  if (!write) { Logger.log('내용이 달라졌습니다. (시험 모드 또는 확인 전용: 문서는 고치지 않았습니다)'); return null; }

  // 새 줄을 시작 표지 바로 아래에 먼저 넣고, 옛 줄을 뒤에서부터 지운다(중간에 멈춰도 자동 구간이 비지 않는다).
  for (var i = 0; i < lines.length; i++) body.insertParagraph(found.start + 1 + i, lines[i]);
  var oldFirst = found.start + 1 + lines.length;
  for (var j = found.end - 1 + lines.length; j >= oldFirst; j--) body.getChild(j).removeFromParent();
  Logger.log('자동 구간을 새로 썼습니다.');
  return null;
}

function callCtx_openBody_() {
  var id = PropertiesService.getScriptProperties().getProperty(CALL_CTX_DOC_KEY);
  if (!id && CALL_CTX_DOC_ID_FALLBACK.indexOf('여기에') !== 0) id = CALL_CTX_DOC_ID_FALLBACK;
  if (!id) return null;
  try { return DocumentApp.openById(id).getBody(); } catch (e) { return null; }
}

/** 본문 맨 위 단계 요소의 글. 문단·목록 항목이 아니면 null(표 등). */
function callCtx_texts_(body) {
  var out = [];
  for (var i = 0; i < body.getNumChildren(); i++) {
    var child = body.getChild(i), type = child.getType();
    if (type === DocumentApp.ElementType.PARAGRAPH) out.push(child.asParagraph().getText());
    else if (type === DocumentApp.ElementType.LIST_ITEM) out.push(child.asListItem().getText());
    else out.push(null);
  }
  return out;
}

function callCtx_post_(secret) {
  var headers = {};
  headers[CALL_CTX_SECRET_HEADER] = secret;
  try {
    var res = UrlFetchApp.fetch(CALL_CTX_URL + '?action=context', {
      method: 'post', contentType: 'application/json', headers: headers, payload: '{}', muteHttpExceptions: true,
    });
    var json = null;
    try { json = JSON.parse(res.getContentText()); } catch (e) { json = null; }
    return { code: res.getResponseCode(), json: json };
  } catch (e) {
    return { code: 0, json: null };   // 연결 실패
  }
}

function callCtx_loadState_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(CALL_CTX_STATE_KEY);
    var s = raw ? JSON.parse(raw) : {};
    return { fails: Number(s.fails) > 0 ? Math.floor(Number(s.fails)) : 0, lastOkDay: typeof s.lastOkDay === 'string' ? s.lastOkDay : '' };
  } catch (e) {
    return { fails: 0, lastOkDay: '' };
  }
}

function callCtx_saveState_(state) {
  PropertiesService.getScriptProperties().setProperty(CALL_CTX_STATE_KEY, JSON.stringify({ fails: state.fails || 0, lastOkDay: state.lastOkDay || '' }));
}

// ── 순수 함수 (네트워크·Drive 없음, tests/security/call-context-gas.test.mjs가 시험) ──────────

function callCtxKstDay(ms) {
  return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 한 줄 글: 제어 문자·줄바꿈을 빈칸으로, 표지·링크·굵게 표시에 쓰이는 글자를 지우고 글자 수를 자른다. 비면 ''. */
function callCtxClean(value, max) {
  if (typeof value !== 'string') return '';
  var s = value.normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060-\u2069]/g, ' ')
    .replace(/[<>\[\]]/g, ' ').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, max).join('').trim();
}

/**
 * 서버 응답 → 쓸 수 있는 목록. 모양이 다르거나 조직이 0개이거나 합계가 상한을 넘으면 {ok:false, reason}.
 * 서버가 이미 자르지만 스크립트도 한 번 더 지킨다. 이름 안의 표지·마크다운 글자는 지운다.
 */
function callCtxParse(json) {
  if (!json || json.ok !== true || !Array.isArray(json.organizations) || !Array.isArray(json.projects)) return { ok: false, reason: '모양이 다릅니다' };
  if (json.organizations.length > CALL_CTX_MAX_ORGS || json.projects.length > CALL_CTX_MAX_PROJECTS) return { ok: false, reason: '개수가 상한을 넘었습니다' };
  var orgs = [], projects = [], total = 0, i;
  for (i = 0; i < json.organizations.length; i++) {
    var o = json.organizations[i];
    if (!o || typeof o !== 'object' || !Array.isArray(o.aliases)) return { ok: false, reason: '조직 모양이 다릅니다' };
    var name = callCtxClean(o.name, CALL_CTX_MAX_ORG_CHARS);
    if (!name) continue;
    var aliases = [];
    for (var k = 0; k < o.aliases.length && aliases.length < CALL_CTX_MAX_ALIASES; k++) {
      var a = callCtxClean(o.aliases[k], CALL_CTX_MAX_ALIAS_CHARS);
      if (a && a !== name && aliases.indexOf(a) < 0) aliases.push(a);
    }
    total += Array.from(name).length;
    aliases.forEach(function (x) { total += Array.from(x).length; });
    orgs.push({ name: name, aliases: aliases });
  }
  for (i = 0; i < json.projects.length; i++) {
    if (typeof json.projects[i] !== 'string') return { ok: false, reason: '프로젝트 모양이 다릅니다' };
    var p = callCtxClean(json.projects[i], CALL_CTX_MAX_PROJECT_CHARS);
    if (!p) continue;
    total += Array.from(p).length;
    projects.push(p);
  }
  if (!orgs.length) return { ok: false, reason: '담당조직이 0개입니다(덮어쓰지 않음)' };
  if (total > CALL_CTX_MAX_TOTAL_CHARS) return { ok: false, reason: '글자 합계가 상한을 넘었습니다' };
  var om = json.omitted && typeof json.omitted === 'object' ? json.omitted : {};
  var omitted = {
    organizations: Number.isSafeInteger(om.organizations) && om.organizations > 0 ? om.organizations : 0,
    projects: Number.isSafeInteger(om.projects) && om.projects > 0 ? om.projects : 0,
  };
  return { ok: true, organizations: orgs, projects: projects, omitted: omitted };
}

/** 자동 구간 안에 들어갈 줄들(표지 줄 제외). 첫 줄은 갱신 날짜. */
function callCtxRender(ctx, day) {
  var lines = ['마지막 갱신: ' + day, CALL_CTX_NOTE, '', '[담당조직 정식 이름과 약칭]'];
  ctx.organizations.forEach(function (o) {
    lines.push('- ' + o.name + (o.aliases.length ? ' (약칭: ' + o.aliases.join(', ') + ')' : ''));
  });
  if (ctx.projects.length) {
    lines.push('', '[진행 중 프로젝트]');
    ctx.projects.forEach(function (p) { lines.push('- ' + p); });
  }
  var skipped = ctx.omitted.organizations + ctx.omitted.projects;
  if (skipped > 0) lines.push('', '(일부 생략: 담당조직 ' + ctx.omitted.organizations + '개, 프로젝트 ' + ctx.omitted.projects + '개)');
  return lines;
}

/**
 * 본문 요소 글 배열(문단·목록이 아닌 요소는 null)에서 표지 줄을 찾는다.
 * 시작·끝이 정확히 하나씩, 시작이 끝보다 앞, 둘 사이에 표 같은 다른 요소가 없을 때만 ok.
 */
function callCtxFindMarkers(texts) {
  var starts = [], ends = [];
  for (var i = 0; i < texts.length; i++) {
    var t = texts[i] == null ? '' : String(texts[i]).trim();
    if (t === CALL_CTX_START) starts.push(i);
    else if (t === CALL_CTX_END) ends.push(i);
  }
  if (!starts.length && !ends.length) return { ok: false, reason: 'no-markers' };
  if (starts.length !== 1 || ends.length !== 1) return { ok: false, reason: starts.length === 1 || ends.length === 1 ? '표지 줄이 하나뿐이거나 겹칩니다' : '표지 줄이 여러 개입니다' };
  if (starts[0] >= ends[0]) return { ok: false, reason: '표지 줄 순서가 바뀌었습니다' };
  for (var j = starts[0] + 1; j < ends[0]; j++) if (texts[j] == null) return { ok: false, reason: '자동 구간 안에 표 같은 다른 요소가 있습니다' };
  return { ok: true, start: starts[0], end: ends[0] };
}

/** 기존 자동 구간 줄과 새 줄이 같은가. 첫 줄(마지막 갱신 날짜)은 비교하지 않는다. 끝의 빈 줄 차이는 무시. */
function callCtxSame(oldLines, newLines) {
  var norm = function (lines) {
    var a = lines.slice(1).map(function (l) { return String(l == null ? '' : l).trim(); });
    while (a.length && a[a.length - 1] === '') a.pop();
    return a;
  };
  var a = norm(oldLines), b = norm(newLines);
  if (!oldLines.length || a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function callCtxShouldAlert(fails) {
  return fails >= CALL_CTX_FAIL_ALERT;
}

// node 시험에서만 쓰는 내보내기(앱 스크립트에는 module이 없어서 아무 일도 하지 않는다).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    callCtxKstDay: callCtxKstDay, callCtxClean: callCtxClean, callCtxParse: callCtxParse, callCtxRender: callCtxRender,
    callCtxFindMarkers: callCtxFindMarkers, callCtxSame: callCtxSame, callCtxShouldAlert: callCtxShouldAlert,
  };
}

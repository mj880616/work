/**
 * Web2 수집 점검 신호 (OPS-수집점검 2단계)
 *
 * 하는 일: 1시간마다 아래 두 가지 "시각"만 읽어 Web2에 알린다. 파일 이름·내용·ID는 보내지 않는다.
 *   1) 통화 전사 폴더에서 가장 최근 파일 시각 + 최근 24시간에 생긴 파일 수
 *   2) 텔레그램 수집 상태 파일의 마지막 수정 시각
 * Web2 홈 "마지막 수집 시각" 칸이 이 값으로 텔레그램·통화 전사 줄을 보여 준다.
 *
 * 설정 안내: docs/ops/collector-heartbeat.md (붙여넣기 → ID 채우기 → 비밀값 → 시험 → 1시간 트리거)
 *
 * 비밀값은 이 코드에 넣지 않는다. "프로젝트 설정 → 스크립트 속성"의 COLLECTOR_HEARTBEAT_SECRET에만 둔다.
 * 기존 통화 전사 스크립트와 이름이 겹치지 않도록 함수 이름은 모두 web2Heartbeat_로 시작한다.
 */

// ── 여기 두 줄만 채운다 ──────────────────────────────────────────────
// 통화 전사 글이 쌓이는 Drive 폴더 ID (폴더 주소의 /folders/ 뒤 부분)
var WEB2_HEARTBEAT_TRANSCRIPT_FOLDER_ID = '여기에_전사_폴더_ID';
// 회사 PC 텔레그램 수집 프로그램이 고치는 상태 파일 ID (파일 주소의 /d/ 와 /view 사이 부분)
var WEB2_HEARTBEAT_TELEGRAM_FILE_ID = '여기에_텔레그램_상태_파일_ID';
// ────────────────────────────────────────────────────────────────

// 전사 폴더 안의 하위 폴더까지 볼지(날짜별 하위 폴더에 저장한다면 true)
var WEB2_HEARTBEAT_INCLUDE_SUBFOLDERS = false;
// Web2 받는 입구(공개 주소, 비밀값 아님)
var WEB2_HEARTBEAT_URL = 'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/drive-summary?action=heartbeat';
var WEB2_HEARTBEAT_SECRET_KEY = 'COLLECTOR_HEARTBEAT_SECRET';
var WEB2_HEARTBEAT_MAX_FILES = 20000; // 폴더가 아주 커도 실행 시간 안에 끝나게 상한

/** 1시간 트리거가 부르는 함수. 손으로 [실행]해서 시험해도 된다. */
function web2Heartbeat_send() {
  var secret = PropertiesService.getScriptProperties().getProperty(WEB2_HEARTBEAT_SECRET_KEY);
  if (!secret) throw new Error('스크립트 속성에 ' + WEB2_HEARTBEAT_SECRET_KEY + '가 없습니다. 안내 문서 3단계를 먼저 하세요.');
  var results = [];
  results.push(web2Heartbeat_try_('transcript', web2Heartbeat_transcript_, secret));
  results.push(web2Heartbeat_try_('telegram', web2Heartbeat_telegram_, secret));
  Logger.log(results.join('\n'));
  if (results.some(function (line) { return line.indexOf('정상') < 0; })) {
    throw new Error('일부 신호를 보내지 못했습니다. 위 실행 로그를 확인하세요.');
  }
}

/** 처음 한 번: 1시간마다 web2Heartbeat_send를 부르는 트리거를 만든다(이미 있으면 그대로 둔다). */
function web2Heartbeat_installHourlyTrigger() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'web2Heartbeat_send'; });
  if (exists) { Logger.log('이미 1시간 트리거가 있습니다. 새로 만들지 않았습니다.'); return; }
  ScriptApp.newTrigger('web2Heartbeat_send').timeBased().everyHours(1).create();
  Logger.log('1시간 트리거를 만들었습니다.');
}

/** 멈추고 싶을 때: 이 스크립트의 점검 신호 트리거만 지운다(전사 트리거는 건드리지 않는다). */
function web2Heartbeat_removeTrigger() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'web2Heartbeat_send') { ScriptApp.deleteTrigger(t); removed++; }
  });
  Logger.log('지운 점검 신호 트리거: ' + removed + '개');
}

/**
 * 처음 한 번: 긴 임의 비밀값을 만들어 스크립트 속성에 저장한다(이미 있으면 바꾸지 않는다).
 * 값은 로그에 찍지 않는다. "프로젝트 설정 → 스크립트 속성"에서 보고 복사해 Supabase에 똑같이 등록한다.
 */
function web2Heartbeat_makeSecret() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(WEB2_HEARTBEAT_SECRET_KEY)) { Logger.log('비밀값이 이미 있습니다. 바꾸지 않았습니다.'); return; }
  var value = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  props.setProperty(WEB2_HEARTBEAT_SECRET_KEY, value);
  Logger.log('비밀값을 만들어 스크립트 속성에 저장했습니다(값은 로그에 남기지 않음).');
}

// ── 아래는 고칠 필요 없음 ─────────────────────────────────────────────

function web2Heartbeat_try_(source, read, secret) {
  try {
    var beat = read();
    if (!beat) return source + ': 보낼 시각 없음(폴더가 비어 있음) — 건너뜀';
    var code = web2Heartbeat_post_(source, beat, secret);
    if (code === 200) return source + ': 정상(200)';
    if (code === 401) return source + ': 비밀값 불일치(401) — Supabase 비밀값과 스크립트 속성 값이 같은지 확인';
    if (code === 409) return source + ': Web2 읽기용 사본 폴더 없음(409) — Web2에서 사본을 한 번 만든 뒤 다시';
    if (code === 405 || code === 404) return source + ': 받는 입구 미배포(' + code + ') — Web2 함수 배포 뒤 다시';
    return source + ': 실패(HTTP ' + code + ')';
  } catch (e) {
    return source + ': 읽기 실패 — ' + (e && e.message ? e.message : e);
  }
}

function web2Heartbeat_post_(source, beat, secret) {
  var body = { source: source, last_at: beat.lastAt.toISOString() };
  if (typeof beat.count === 'number') body.count = beat.count;
  var res = UrlFetchApp.fetch(WEB2_HEARTBEAT_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-collector-heartbeat-secret': secret },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  return res.getResponseCode();
}

function web2Heartbeat_checkId_(id, label) {
  if (!id || id.indexOf('여기에_') === 0) throw new Error(label + ' ID를 코드 맨 위에 채우세요.');
}

/** 전사 폴더: 가장 최근 파일 시각(만든 시각·고친 시각 중 늦은 것) + 최근 24시간에 생긴 파일 수. */
function web2Heartbeat_transcript_() {
  web2Heartbeat_checkId_(WEB2_HEARTBEAT_TRANSCRIPT_FOLDER_ID, '전사 폴더');
  var since = Date.now() - 24 * 3600 * 1000;
  var latest = 0, count = 0, seen = 0;
  var folders = [DriveApp.getFolderById(WEB2_HEARTBEAT_TRANSCRIPT_FOLDER_ID)];
  while (folders.length && seen < WEB2_HEARTBEAT_MAX_FILES) {
    var folder = folders.shift();
    var files = folder.getFiles();
    while (files.hasNext() && seen < WEB2_HEARTBEAT_MAX_FILES) {
      var f = files.next();
      seen++;
      if (f.isTrashed()) continue;
      var created = f.getDateCreated().getTime(), updated = f.getLastUpdated().getTime();
      latest = Math.max(latest, created, updated);
      if (created >= since) count++;
    }
    if (WEB2_HEARTBEAT_INCLUDE_SUBFOLDERS) {
      var subs = folder.getFolders();
      while (subs.hasNext()) folders.push(subs.next());
    }
  }
  if (!latest) return null;
  return { lastAt: new Date(Math.min(latest, Date.now())), count: Math.min(count, 100000) };
}

/** 텔레그램 수집 상태 파일: 마지막 수정 시각만. */
function web2Heartbeat_telegram_() {
  web2Heartbeat_checkId_(WEB2_HEARTBEAT_TELEGRAM_FILE_ID, '텔레그램 상태 파일');
  var updated = DriveApp.getFileById(WEB2_HEARTBEAT_TELEGRAM_FILE_ID).getLastUpdated().getTime();
  return { lastAt: new Date(Math.min(updated, Date.now())) };
}

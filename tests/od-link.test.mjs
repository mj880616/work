import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// OD-연결아이콘(2026-10-28 13:53): 일기 원드라이브 연결 표시 = [오늘] 오른쪽 아이콘 하나 + 공용 드롭다운(사진 메뉴도 같은 부품).
// DOM 없이 모양 규칙과 화면 연결(정적)만 본다. 네트워크·기기 저장소 없음.
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const {odLinkState, odLinkLabel, odLinkButtonHtml, odLinkMenuHtml, OD_CLOUD_SVG} = await import('../app/od-link.js');
const {validValue, parsePrefs, KEYS} = await import('../app/view-prefs.js');
const acts = html => [...html.matchAll(/data-od-act="([a-z]+)"/g)].map(m => m[1]);
const OK = {configured:true, connected:true, folder:{name:'카메라'}, canDelete:true};

test('상태: 준비 안 된 서버는 숨김, 연결 안 됨은 흐림, 오류는 빨간 점, 연결됨', () => {
  assert.equal(odLinkState({configured:false, connected:false}), 'hidden');
  assert.equal(odLinkState({configured:true, connected:false}), 'off');
  assert.equal(odLinkState({configured:true, connected:false}, true), 'off');
  assert.equal(odLinkState(OK), 'ok');
  assert.equal(odLinkState(OK, true), 'error');
  assert.equal(odLinkState({configured:false, failed:true}), 'error');
  assert.equal(odLinkLabel('ok', OK), '원드라이브 · 연결됨 · 카메라');
  assert.equal(odLinkLabel('off'), '원드라이브 · 연결 안 됨');
});

test('드롭다운 항목: 연결 상태 / 폴더 바꾸기 / 하위 폴더 켜고 끄기 / 일기에서 사진 보이기 / 연결 끊기', () => {
  const html = odLinkMenuHtml({od:OK, show:true});
  assert.match(html, /data-od-link-status[^>]*>.*연결됨 · 카메라/);
  assert.deepEqual(acts(html), ['folder', 'subfolders', 'show', 'disconnect']);
  assert.match(html, />폴더 바꾸기</); assert.match(html, />하위 폴더 켜고 끄기</); assert.match(html, /연결 끊기</);
  assert.match(html, /role="menuitemcheckbox" aria-checked="true" data-od-act="show"><span class="od-link-check" aria-hidden="true">✓<\/span>일기에서 사진 보이기/);
  assert.match(odLinkMenuHtml({od:OK, show:false}), /aria-checked="false" data-od-act="show"><span class="od-link-check" aria-hidden="true"><\/span>/);
  assert.match(odLinkMenuHtml({od:OK, show:true, showLabel:'사진 메뉴에 보이기'}), /사진 메뉴에 보이기/);
  // 폴더 고르기 전·지우기 권한 없음·연결 안 됨·상태 확인 실패.
  assert.deepEqual(acts(odLinkMenuHtml({od:{...OK, folder:null}})), ['folder', 'disconnect']);
  assert.match(odLinkMenuHtml({od:{...OK, folder:null}}), />폴더 고르기</);
  assert.deepEqual(acts(odLinkMenuHtml({od:{...OK, canDelete:false}})), ['folder', 'subfolders', 'show', 'reconnect', 'disconnect']);
  assert.deepEqual(acts(odLinkMenuHtml({od:{configured:true, connected:false}})), ['connect']);
  assert.deepEqual(acts(odLinkMenuHtml({od:{configured:false, failed:true}})), ['retry']);
  // 오류 문구는 글자로만(HTML 삽입 없음).
  const bad = odLinkMenuHtml({od:{...OK, folder:{name:'<b>x</b>'}}, fault:true, message:'<img src=x>'});
  assert.doesNotMatch(bad, /<b>|<img/);
  assert.match(bad, /data-state="error"/);
});

test('아이콘: 직접 그린 단색 SVG(글자색), 그림 파일·외부 주소 없음, 작은 버튼', () => {
  assert.match(OD_CLOUD_SVG, /^<svg [^>]*viewBox="0 0 24 16"[^>]*aria-hidden="true"/);
  assert.match(OD_CLOUD_SVG, /fill="currentColor"/);
  assert.doesNotMatch(OD_CLOUD_SVG, /href|url\(|<image|#[0-9a-f]{3,6}\b/i);
  const btn = odLinkButtonHtml();
  assert.match(btn, /^<button type="button" class="mini od-link" data-od-link data-state="off" aria-haspopup="true" aria-expanded="false"/);
  assert.match(btn, /<span class="od-link-dot" aria-hidden="true"><\/span><\/button>$/);
  const css = read('app/od-link.css');
  assert.match(css, /\.od-link\[data-state="off"\] \.od-link-cloud\{opacity:\.4\}/);
  assert.match(css, /\.od-link\[data-state="error"\] \.od-link-dot\{display:block\}/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,6}\b/i, '색은 테마 변수만');
  assert.match(read('app/view-loader.js'), /diary:\['\.\/diary\.css','\.\/od-link\.css'/);
  assert.doesNotMatch(read('app/od-link.js'), /(local|session)Stor[a]ge|indexed[D]B/);
});

test('일기 연결: 옛 연결 줄(원드라이브 · 폴더 [설정])은 없고 [오늘] 오른쪽 아이콘 + 공용 anchored-menu 드롭다운', () => {
  const diary = read('app/diary.js'), part = read('app/od-link.js');
  assert.match(part, /import \{createAnchoredMenu\} from '\.\/anchored-menu\.js';/);
  assert.match(diary, /import \{odLinkButtonHtml, paintOdLink, createOdLinkMenu\} from '\.\/od-link\.js';/);
  assert.match(diary, /<div class="diary-month-od"><div class="diary-month">[^`]*data-diary-today>오늘<\/button><\/div>\$\{odLinkButtonHtml\(\)\}<\/div><div class="diary-lv-tools"/);
  assert.match(read('app/diary.css'), /\.diary-month-od\{ display:flex; align-items:center; gap:6px; \}/);
  assert.doesNotMatch(diary, /diary-od-line|data-od-open|toggleOdPanel/);
  assert.match(diary, /if \(button\.matches\('\[data-od-link\]'\)\) return odLinkMenu\.open\(button\);/);
  // 원드라이브 칸(받는 중·안내·설정 창)은 달력 밖에 두어 목록 보기에서도 설정 창이 보인다.
  assert.match(diary, /<section class="diary-od" data-diary-od hidden aria-label="원드라이브 사진"><\/section><div class="diary-cal" data-diary-cal>/);
  // 사진 보이기: 서버 기억(거절되면 이번 접속만), 끄면 원드라이브 사진만 빠진다.
  assert.match(diary, /viewPrefs\.set\('diary_onedrive', on, \{rejectable:true\}\)/);
  assert.match(diary, /const odShown = \(\) => \(odShowOn\(\) \? odMonth : null\);/);
  for (const use of ['odDay = odShown()?.days[day]', 'dayItems(selected, row, odShown()).length', 'all = dayItems(selected, row, odShown())']) assert.ok(diary.includes(use), use);
  assert.match(diary, /odReady:\(\) => ensureOdStatus\(\)\.then\(\(\) => !!\(od\.connected && od\.folder && odShowOn\(\)\)\)/);
  assert.match(read('docs/design/photo-menu.md'), /같은 부품 사용: `app\/od-link\.js`/);
});

test('diary_onedrive: 화면 규칙과 DB 검사(migration 20261028150000)가 같다', () => {
  assert.ok(KEYS.includes('diary_onedrive'));
  assert.equal(validValue('diary_onedrive', true), true);
  assert.equal(validValue('diary_onedrive', false), true);
  for (const bad of ['true', 1, 0, null, [true], {}]) assert.equal(validValue('diary_onedrive', bad), false, JSON.stringify(bad));
  assert.deepEqual(parsePrefs({diary_onedrive:false, diary_view:'list'}), {diary_view:'list', diary_onedrive:false});
  assert.deepEqual(parsePrefs({diary_onedrive:'no'}), {});
  const sql = read('supabase/migrations/20261028150000_profile_view_prefs_diary_onedrive.sql');
  assert.match(sql, /jsonb_typeof\(view_prefs -> 'diary_onedrive'\) = 'boolean'/);
});

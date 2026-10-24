import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// TRASH-Edge거르기2: 담당조직(app_suborganizations)·사업 보고(app_meetings)의 휴지통 행(deleted_at)을 서버 키 읽기에서 뺀다.
// 서버 키(service_role)는 RLS를 건너뛰므로 숨김 정책이 닿지 않는다. 사용자 토큰으로 읽는 함수는 숨김 정책이 이미 거른다.
// 동작 시험은 함수별 시험(drive-summary.test.mjs, collector-feed.test.mjs)에 있고, 여기서는 나머지 함수의 읽기 모양을 소스에서 고정한다.
const src = (path) => readFileSync(new URL(`../../supabase/functions/${path}`, import.meta.url), 'utf8');
const TABLES = /app_meetings|app_suborganizations(?!_)/;

test('library-files: 서버 키(admin)로 사업 보고를 찾을 때 휴지통 행은 뺀다', () => {
  const js = src('library-files/index.ts');
  const reads = js.match(/admin\.from\('app_meetings'\)[^;\n]*/g) || [];
  assert.equal(reads.length, 1);
  assert.match(reads[0], /\.is\('deleted_at',\s*null\)/);
});

test('page-ai-draft: 서버 키(admin)로 읽는 사업 보고에서 휴지통 행은 뺀다', () => {
  const js = src('page-ai-draft/index.ts');
  const reads = js.match(/admin\.from\('app_meetings'\)[^;]*/g) || [];
  assert.equal(reads.length, 1);
  assert.match(reads[0], /\.is\('deleted_at',\s*null\)/);
});

test('collector-feed: 담당조직 읽기는 deleted_at=is.null, drive-summary: 조직·기록·담당 지정·보고 읽기는 모두 거른다', () => {
  const feed = src('collector-feed/handler.ts');
  const orgRead = feed.match(/app_suborganizations\?[^`]*/g) || [];
  assert.equal(orgRead.length, 1);
  assert.match(orgRead[0], /deleted_at=is\.null/);
  const core = src('drive-summary/core.mjs');
  assert.match(core, /dbRows\('app_suborganizations', \{[^}]*deleted_at: 'is\.null'/);
  assert.match(core, /dbRows\('app_meetings', timeParams\([^;]*deleted_at: 'is\.null'/);
  assert.equal((core.match(/'organization\.deleted_at': 'is\.null'/g) || []).length, 2, '조직 기록과 담당 지정 두 곳');
});

test('사용자 토큰으로 읽는 함수는 서버 키로 이 두 표를 읽지 않는다(숨김 정책이 거른다)', () => {
  // 서버 키 클라이언트 이름: admin / service / SERVICE_KEY 로 만든 것. 이 함수들이 그 이름으로 두 표를 읽기 시작하면 이 시험이 알려 준다.
  for (const file of ['google-tasks/index.ts', 'meeting-ai-ingest/index.ts', 'meeting-ai-draft/index.ts', 'meeting-files/index.ts', 'team-ai/index.ts']) {
    const js = src(file);
    assert.doesNotMatch(js, new RegExp(`(?:admin|service\\w*|sb)\\.from\\('(?:app_meetings|app_suborganizations)'\\)`), `${file}: 서버 키로 읽으면 deleted_at을 걸러야 한다`);
    assert.match(js, TABLES, `${file}: 두 표를 읽는 곳이 있어야 이 시험이 뜻이 있다`);
  }
  // ai-assist: 서버 키 자체가 없다(모든 읽기가 로그인 토큰이다).
  assert.doesNotMatch(src('ai-assist/handler.ts'), /SERVICE_ROLE/i);
  assert.doesNotMatch(src('ai-assist/index.ts'), /SERVICE_ROLE/i);
});

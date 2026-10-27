import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// TRASH-다른삭제 5단계(Edge): 노트·업데이트(app_notes)의 휴지통 행(deleted_at)을 서버 키 읽기에서 뺀다.
// 서버 키(service_role)는 RLS를 건너뛰어 휴지통 숨김 정책이 닿지 않는다. 사용자 토큰으로 읽는 함수는 숨김 정책이 이미 거른다.
// 동작 시험은 함수별 시험(drive-summary, document-actions-register/hwp, basket-files)에 있고, 여기서는 app_notes를 읽는 모든 파일의
// 분류(거름 / 일부러 안 거름 / 사용자 토큰)를 소스에서 고정한다. 새 읽는 곳이 생기면 이 목록에 없어서 시험이 알려 준다.
const root = new URL('../../supabase/functions/', import.meta.url);
const src = (path) => readFileSync(new URL(path, root), 'utf8');
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { if (name !== 'node_modules') walk(full, out); }
    else if (/\.(ts|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(relative(new URL(root).pathname, full).split('\\').join('/'));
  }
  return out;
}

const CLASSIFIED = {
  // 서버 키로 읽음 -> deleted_at 거르기(DB 적용 전 칸이 없으면 42703 거절 뒤 거르기 없이 한 번 더)
  'drive-summary/basket-read.mjs': 'filtered',
  'document-actions/index.ts': 'filtered',
  '_shared/hwp-edit.ts': 'filtered',
  'basket-files/handler.ts': 'filtered',
  // 일부러 거르지 않음: 휴지통 노트가 되돌아올 수 있으므로 그 첨부 Drive 파일은 계속 보호돼야 한다
  '_shared/basket-file-origin.ts': 'unfiltered-on-purpose',
  // 일기사진정리: 서버 키로 모든 노트(휴지통 포함)의 첨부 목록을 읽어, 어떤 노트가 쓰는 Drive 사진도 휴지통에 보내지 않는다
  'basket-files/photo-prune.ts': 'unfiltered-on-purpose',
  // 사용자 토큰(로그인 JWT)으로 읽음: 휴지통 숨김 정책(restrictive)이 자동으로 거른다
  'ai-assist/handler.ts': 'user-token',
  'basket-files/ocr.ts': 'user-token',
  'basket-files/photo.ts': 'user-token',
  'basket-files/note-delete.ts': 'user-token',
};

test('app_notes를 다루는 Edge 소스는 모두 분류돼 있다(새 읽는 곳은 여기서 걸린다)', () => {
  const found = walk(new URL(root).pathname).filter((f) => /app_notes/.test(src(f))).sort();
  assert.deepEqual(found, Object.keys(CLASSIFIED).sort());
});

test('drive-summary: 바구니 줄 노트 읽기는 deleted_at=is.null, 칸이 없을 때(42703)만 거르기를 끄고 처음부터 다시 읽는다', () => {
  const js = src('drive-summary/basket-read.mjs');
  assert.match(js, /deleted_at: "is\.null"/);
  assert.match(js, /code === "42703"/);
  // select 칸은 그대로(거르기는 조건일 뿐): 읽는 칸 목록에 deleted_at이 없다.
  assert.doesNotMatch(js, /HEADER_FIELDS =\s*"[^"]*deleted_at/);
});

test('document-actions·hwp-edit: 서버 키로 노트 id를 읽을 때 휴지통 노트를 뺀다', () => {
  const actions = src('document-actions/index.ts');
  assert.match(actions, /async function readLiveNoteRows\(path: string\)/);
  assert.match(actions, /readLiveNoteRows\(`app_notes\?id=eq\./);
  assert.doesNotMatch(actions, /await db\(`app_notes\?id=eq\./, '노트 id 읽기는 readLiveNoteRows만 쓴다');
  const hwp = src('_shared/hwp-edit.ts');
  assert.match(hwp, /readLiveNoteRows\(\s*deps\.db,\s*`app_notes\?id=eq\./);
  assert.doesNotMatch(hwp, /deps\.db\(\s*`app_notes\?id=eq\./);
  // 같은 Drive 파일을 쓰는 노트가 있는지 보는 공유 검사는 일부러 거르지 않는다.
  assert.match(hwp, /app_notes\?workspace_id=eq\.\$\{ws\}&attachments=cs\./);
  assert.doesNotMatch(hwp.slice(hwp.indexOf('async function shared')), /deleted_at/);
});

test('basket-files 업로드: 노트 찾기와 저장 모두 deleted_at is null, 칸이 없을 때(42703)만 거르기 없이 다시 한다', () => {
  const js = src('basket-files/handler.ts');
  assert.equal((js.match(/\.is\("deleted_at", null\)/g) || []).length, 2, '찾기와 저장 두 곳');
  assert.equal((js.match(/code === "42703"/g) || []).length, 2);
});

test('일부러 거르지 않는 곳과 사용자 토큰 곳은 서버 키로 app_notes를 읽지 않거나 거르지 않는다고 고정', () => {
  assert.doesNotMatch(src('_shared/basket-file-origin.ts'), /deleted_at/);
  assert.doesNotMatch(src('ai-assist/handler.ts'), /SERVICE_ROLE/i);
  assert.doesNotMatch(src('ai-assist/index.ts'), /SERVICE_ROLE/i);
  for (const file of ['basket-files/ocr.ts', 'basket-files/photo.ts', 'basket-files/note-delete.ts']) {
    assert.doesNotMatch(src(file), /admin\.from\("app_notes"\)/, `${file}: 서버 키(admin)로 읽으면 deleted_at을 걸러야 한다`);
  }
});

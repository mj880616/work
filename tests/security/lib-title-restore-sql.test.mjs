// LIB-파일이름제목 되돌리기 SQL(docs/design/lib-title-restore-2026-11-03.md)이 공용 판정(app/library-file-name.mjs)과 어긋나지 않게 지킨다.
// SQL은 운영에서 CC가 직접 실행하므로, 흔한 낱말 목록·쓰기 조각의 begin/commit·백업 표 권한 회수를 문서 단계에서 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GENERIC_NAME_WORDS} from '../../app/library-file-name.mjs';

const doc = readFileSync(new URL('../../docs/design/lib-title-restore-2026-11-03.md', import.meta.url), 'utf8');
const blocks = [...doc.matchAll(/```sql\n([\s\S]*?)```/g)].map(m => m[1]);

test('SQL의 흔한 낱말 목록이 GENERIC_NAME_WORDS와 같다', () => {
  const lists = [...doc.matchAll(/unnest\(array\[([^\]]*)\]::text\[\]\) as word/g)].map(m => m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')));
  assert.ok(lists.length >= 4);
  for (const list of lists) assert.deepEqual(list, [...GENERIC_NAME_WORDS]);
});

test('낱말 나누기 문자 범위·뜻 있음 판정이 모든 조각에서 같다', () => {
  const classes = new Set([...doc.matchAll(/regexp_split_to_table\(lower\(normalize\(x\.base, NFKC\)\), '([^']+)'\)/g)].map(m => m[1]));
  assert.equal(classes.size, 1);
  assert.equal([...doc.matchAll(/w <> '' and w not in \(select word from words\) and w !~ '\^\[a-z\]\{1,2\}\$'/g)].length, 4);
});

test('쓰기 조각은 begin…commit이고 백업 표는 private 스키마·권한 회수', () => {
  const writes = blocks.filter(b => /\b(update|insert|create|drop)\b/i.test(b.replace(/--.*$/gm, '')));
  assert.ok(writes.length >= 3);
  for (const b of writes) {
    assert.match(b.trim(), /^begin;/);
    assert.match(b.trim(), /commit;$/);
  }
  assert.match(doc, /create table if not exists private\.lib_title_restore_backup_20261103/);
  assert.match(doc, /revoke all on table private\.lib_title_restore_backup_20261103 from public, anon, authenticated;/);
  assert.doesNotMatch(doc, /insert into supabase_migrations/i); // 행 고침이라 migration 기록을 넣지 않는다
});

test('사람이 정한 제목은 대상에서 빠진다', () => {
  const targetBlocks = blocks.filter(b => b.includes('from public.app_documents d\n  where'));
  assert.ok(targetBlocks.length >= 4);
  for (const b of targetBlocks) {
    assert.match(b, /coalesce\(d\.field_origin ->> 'title', ''\) <> 'user'/);
    assert.match(b, /<> '사용자 수정'/);
    assert.match(b, /not like '사용자 입력 제목%'/);
  }
});

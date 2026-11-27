// S70-83 READ-저장한글폴더 DB 시험의 바탕 schema(합성, 운영 자료 없음). 공용 fixture(작업공간·소유자 검사) 위에
// 저장한 글 표(20261122100000_reading_items)의 표·색인·권한·정책 부분만 그 migration 원문에서 잘라 올리고 기록 1행을 넣어 사전 조건을 맞춘다
// (그 migration의 밑줄 검사·검색 함수 부분은 이 시험과 무관해서 뺀다). setupSteps(read)는 차례대로 실행할 SQL 글 목록. pg 없이도(SQL만) 쓸 수 있다.
import {fixture} from './basket4-fixture.mjs';

export async function setupSteps(read) {
  const src = await read('supabase/migrations/20261122100000_reading_items.sql');
  const from = src.indexOf('create table public.app_reading_items (');
  const end = src.indexOf(';', src.indexOf('create policy reading_items_owner_all')) + 1;
  if (from < 0 || end <= from) throw new Error('reading_items table part not found');
  return [fixture, src.slice(from, end),
    "insert into supabase_migrations.schema_migrations(version,name) values ('20261122100000','reading_items')"];
}

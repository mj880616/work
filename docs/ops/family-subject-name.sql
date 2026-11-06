-- S51-26 FAMILY-노트로 ⑩: 이미 뽑힌 '잊지 말기' 줄(app_family_notes.body)의 주어 '상대'를 가족 이름으로 한 번 고친다.
-- 운영 데이터 변경이다. 커맨드센터가 collector-feed 배포(FAMILY_NAME 설정 포함) 뒤, 그리고 family-kept-to-note.sql(옛 줄 노트로 옮기기) **앞에** 실행한다
-- (먼저 고쳐야 노트로 옮긴 줄에도 이름이 들어간다). 작업 세션은 실행하지 않는다.
--
-- 가족 이름은 저장소에 쓰지 않는다: SQL Editor에서 아래 두 곳의 '<<가족 이름>>'을 실제 이름으로 바꿔 실행하고, 저장하지 않고 창을 닫는다.
-- 이름은 Edge 비밀값 FAMILY_NAME과 같은 글자(1~20자, 글자·숫자·빈칸). 바꾸지 않고 실행하면 ②가 멈춘다.
--
-- 일상어 3줄
--   무엇이 바뀌나: 홈 '잊지 말기' 줄 글자에서 '상대가'·'상대는'처럼 주어로 쓰인 '상대'가 가족 이름으로 바뀐다(이름 끝 받침에 맞춰 가→이, 는→은, 를→을, 와→과, 랑→이랑, 로→으로).
--                 '상대적' 같은 낱말은 그대로. 바꾼 뒤 150자를 넘는 줄은 그대로 둔다. 상태·날짜 등 다른 칸은 그대로.
--   잘못되면: 이름이 틀리면 틀린 이름이 들어간다 → ④ 되돌리기로 다시 '상대'로.
--   되돌리는 방법: ④(이름+조사 → '상대'+원래 조사. '상대방'이었던 줄은 '상대'로 돌아온다).
-- 내용(이름·줄 글자)은 출력하지 않는다. 결과는 건수만.

-- ① 사전 확인(select만). 기대: rows_with_subject = 고칠 줄 수(그 숫자만 보고).
select
  count(*)                                                                                                   as all_rows,
  count(*) filter (where body ~ '상대방?((가|는|를|와|랑|로)|(?=$|[[:space:],.·!?)\]]|[이을의에과도한께만]))') as rows_with_subject
from public.app_family_notes;

-- ② 고치기(새 쿼리 창에 begin; 부터 commit; 까지). '<<가족 이름>>'을 바꿨는지, 마지막 줄이 commit; 인지 확인하고 실행.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $$
declare
  name text := '<<가족 이름>>';
  fin int;
  bare text := '상대방?(?=$|[[:space:],.·!?)\]]|[이을의에과도한께만])';
  changed int;
begin
  name := btrim(regexp_replace(name, '\s+', ' ', 'g'));
  if char_length(name) not between 1 and 20 or name = '<<가족 이름>>' or name ~ '상대' or name ~ '[[:cntrl:]<>&/\\:;.,@#%=+*?!"''`()\[\]{}|^$~]' then
    raise exception 'FAMILY_SUBJECT_NAME: 이름 모양이 틀림(바꾸지 않았거나 1~20자 글자·숫자·빈칸이 아님); stop';
  end if;
  fin := case when ascii(right(name, 1)) between 44032 and 55203 then (ascii(right(name, 1)) - 44032) % 28 else 0 end;
  with fixed as (
    select id,
      regexp_replace(
        regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(body,
          '상대방?가', name || case when fin > 0 then '이' else '가' end, 'g'),
          '상대방?는', name || case when fin > 0 then '은' else '는' end, 'g'),
          '상대방?를', name || case when fin > 0 then '을' else '를' end, 'g'),
          '상대방?와', name || case when fin > 0 then '과' else '와' end, 'g'),
          '상대방?랑', name || case when fin > 0 then '이랑' else '랑' end, 'g'),
          '상대방?로', name || case when fin > 0 and fin <> 8 then '으로' else '로' end, 'g'),
        bare, name, 'g') as new_body
    from public.app_family_notes
    where body ~ '상대'
  )
  update public.app_family_notes f
     set body = x.new_body, updated_at = now()
    from fixed x
   where f.id = x.id and x.new_body <> f.body and char_length(x.new_body) <= 150 and x.new_body !~ '[[:cntrl:]]';
  get diagnostics changed = row_count;
  raise notice 'FAMILY_SUBJECT_NAME: % rows changed', changed;
end
$$;
commit;

-- ③ 사후 확인(select만). 기대: rows_with_subject가 ①보다 줄어듦(150자를 넘게 되는 줄만 남음), all_rows 그대로.
select
  count(*)                                                                                                   as all_rows,
  count(*) filter (where body ~ '상대방?((가|는|를|와|랑|로)|(?=$|[[:space:],.·!?)\]]|[이을의에과도한께만]))') as rows_with_subject
from public.app_family_notes;

-- ④ 되돌리기(필요할 때만). '<<가족 이름>>'을 ②와 같은 이름으로 바꿔 begin; 부터 commit; 까지.
-- begin;
-- do $$
-- declare name text := '<<가족 이름>>'; fin int; q text;
-- begin
--   name := btrim(regexp_replace(name, '\s+', ' ', 'g'));
--   if char_length(name) not between 1 and 20 or name = '<<가족 이름>>' or name ~ '상대' then raise exception 'FAMILY_SUBJECT_NAME_ROLLBACK: 이름 모양이 틀림; stop'; end if;
--   fin := case when ascii(right(name, 1)) between 44032 and 55203 then (ascii(right(name, 1)) - 44032) % 28 else 0 end;
--   q := regexp_replace(name, '([.*+?^${}()|\[\]\\])', '\\\1', 'g');
--   update public.app_family_notes
--      set body = case when fin > 0 then
--                   regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(body,
--                     q || '이랑', '상대랑', 'g'), q || '으로', '상대로', 'g'), q || '이', '상대가', 'g'), q || '은', '상대는', 'g'),
--                     q || '을', '상대를', 'g'), q || '과', '상대와', 'g'), q, '상대', 'g')
--                 else replace(body, name, '상대') end,
--          updated_at = now()
--    where strpos(body, name) > 0;
-- end
-- $$;
-- commit;

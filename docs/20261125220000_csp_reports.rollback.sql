begin;
-- 20261125220000_csp_reports의 짝 되돌리기(SQL Editor 새 쿼리 창 전용).
-- 함수·이번 기록 1행만 지운다. 표는 남긴다(숫자만 든 표이고, 지울지는 따로 결정).
-- 되돌린 뒤 Edge csp-report는 저장에 실패해 502를 돌려주고 브라우저는 보고를 버린다(화면 영향 없음). Worker를 이전 커밋으로 되돌리면 보고 자체를 안 보낸다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261125220000' and name = 'csp_reports') <> 1 then
    raise exception 'CSP_REPORTS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function if exists public.app_csp_report_add(jsonb);

delete from supabase_migrations.schema_migrations where version = '20261125220000' and name = 'csp_reports';
commit;

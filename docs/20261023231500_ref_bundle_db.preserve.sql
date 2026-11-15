-- SELECT only. rollback 전에 SQL Editor 새 창에서 실행하고 결과를 내려받아 보관한다.
-- rollback은 묶음 표를 통째로 지운다(처음 3개 외에 더하거나 이름을 바꾼 묶음 포함). 참고 연결 줄은 rollback이 멈춘 뒤 따로 승인받아 지운다.
-- 이 결과로 나중에 묶음 이름·순서와 참고 연결(어느 업데이트가 어느 묶음에 붙었는지, 요약)을 다시 채울 수 있다. 업데이트 원문(app_notes)은 지워지지 않는다.
select 'bundle' as kind, b.id, b.workspace_id, b.name, b.sort_order, b.created_at, null::uuid as note_id, null::uuid as bundle_id, null::text as summary
from public.app_reference_bundles b
union all
select 'link', l.id, l.workspace_id, null, null, l.created_at, l.note_id, l.bundle_id, l.summary
from public.app_record_links l
where l.bundle_id is not null
order by 1, 6, 2;

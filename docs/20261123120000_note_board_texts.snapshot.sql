-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 행 값은 읽지 않는다.
-- 연결선 표의 칸(비움 허용·기본값)·제약·색인·정책 식·권한과 글 상자 표가 없음, 이번 기록이 없음을 남긴다(되돌린 뒤 같은지 대조).
select 'table' as kind,'public.app_note_board_texts' as name,coalesce(to_regclass('public.app_note_board_texts')::text,'absent') as definition
union all select 'column',a.attname,format_type(a.atttypid,a.atttypmod)||' notnull='||a.attnotnull||' default='||coalesce(pg_get_expr(d.adbin,d.adrelid),'')||' acl='||coalesce(a.attacl::text,'')
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid=to_regclass('public.app_note_board_links') and a.attnum>0 and not a.attisdropped
union all select 'constraint',c.conname,pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid=to_regclass('public.app_note_board_links')
union all select 'index',i.relname,pg_get_indexdef(i.oid) from pg_index x join pg_class i on i.oid=x.indexrelid where x.indrelid=to_regclass('public.app_note_board_links')
union all select 'policy',p.polname,p.polcmd::text||' '||p.polroles::text||' '||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||' | '||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')
  from pg_policy p where p.polrelid=to_regclass('public.app_note_board_links')
union all select 'table acl','public.app_note_board_links',coalesce(c.relacl::text,'') from pg_class c where c.oid=to_regclass('public.app_note_board_links')
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261123120000'
order by 1,2;

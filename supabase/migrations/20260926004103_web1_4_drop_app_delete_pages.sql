begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Web1-4 removes the bulk page delete RPC. Its only caller, the Web2 page
-- manager, was retired, but authenticated owners could still hard-delete pages
-- through it, and app_page_revisions cascades with the page. A bulk delete via
-- this RPC on 2026-09-21 22:29 UTC emptied the reviewed Web1 public pages.
-- No function, view, or policy depends on it. RESTRICT (the default) aborts
-- this migration if that stops being true.
drop function public.app_delete_pages(uuid[]);

commit;

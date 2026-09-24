-- Remove Web2 push delivery infrastructure.
-- app_notifications remains temporarily because legacy collaboration RPCs still reference it.

drop trigger if exists trg_app_push_task_assignment on public.app_notifications;
drop function if exists private.app_dispatch_push();

drop table if exists public.app_push_native_tokens;
drop table if exists public.app_push_subscriptions;
drop table if exists public.app_push_config;

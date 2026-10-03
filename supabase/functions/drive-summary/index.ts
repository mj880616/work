// Deploy with verify_jwt=false: cron has no JWT. Both paths authenticate in core.
// No DB writes, Google permissions creation, or source-content logging.
import { createHandler } from './core.mjs';

Deno.serve(createHandler({
  env: {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    DRIVE_SUMMARY_CRON_SECRET: Deno.env.get('DRIVE_SUMMARY_CRON_SECRET'),
  },
}));

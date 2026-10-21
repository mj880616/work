// Deploy with verify_jwt=false: cron and the collector heartbeat have no JWT. Every path authenticates in core.
// No DB writes, Google permissions creation, or source-content logging.
import { createHandler } from './core.mjs';

Deno.serve(createHandler({
  env: {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    // S7-d: ledger tables are read with the owner's token + anon key (no service_role grant on them).
    SUPABASE_ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY'),
    DRIVE_SUMMARY_CRON_SECRET: Deno.env.get('DRIVE_SUMMARY_CRON_SECRET'),
    COLLECTOR_HEARTBEAT_SECRET: Deno.env.get('COLLECTOR_HEARTBEAT_SECRET'),
  },
}));

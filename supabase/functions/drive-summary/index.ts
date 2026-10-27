// Deploy with verify_jwt=false: cron and the collector heartbeat have no JWT. Every path authenticates in core.
// No Google permissions creation or source-content logging. The only DB write is the nightly text path
// (POST ?action=text_backfill, cron secret only): the four text columns of app_documents, workspace-scoped (text-backfill.mjs).
// LIB-이전파일정리 (POST ?action=library_prev_prune, cron secret only): moves expired previous library files to the Drive trash and marks
// them in app_documents.previous_files only (library-prev-prune.mjs).
import { createHandler } from './core.mjs';
import { createDocumentText } from '../_shared/document-text.ts';
import { inspectDriveFile, moveDriveFileToTrash } from '../_shared/drive-trash.ts';

Deno.serve(createHandler({
  env: {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    // S7-d: ledger tables are read with the owner's token + anon key (no service_role grant on them).
    SUPABASE_ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY'),
    DRIVE_SUMMARY_CRON_SECRET: Deno.env.get('DRIVE_SUMMARY_CRON_SECRET'),
    COLLECTOR_HEARTBEAT_SECRET: Deno.env.get('COLLECTOR_HEARTBEAT_SECRET'),
  },
  // LIB-이전파일정리: Drive trash (trashed=true, never DELETE) for the library's expired previous files; cron secret only.
  driveTrash: { inspect: inspectDriveFile, trash: moveDriveFileToTrash },
  // LIB-글자채우기야간: the same text reader as document-actions `document-text` (one place reads file text).
  createTextReader: (driveToken: () => Promise<string>) => createDocumentText({
    driveToken, fetch, log: code => console.error(JSON.stringify({ fn: 'drive-summary', code })),
  }),
}));

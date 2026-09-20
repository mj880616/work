#!/usr/bin/env node
// Disposable local Edge Runtime diagnostics. Never emit response bodies, Docker
// logs, request headers, secrets, user identifiers, or function source.
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const names = ['meeting-ai-draft', 'meeting-ai-ingest', 'meeting-files'];
function classify(log) {
  if (/requested module.*(?:does|did) not provide an export|cannot resolve module|module not found|could not resolve|import.*failed|npm package.*failed/i.test(log)) return 'IMPORT_OR_EXPORT';
  if (/SyntaxError|unexpected token|unexpected reserved word/i.test(log)) return 'SYNTAX';
  if (/ReferenceError|TypeError|uncaught exception/i.test(log)) return 'RUNTIME_EXCEPTION';
  if (/missing.*(?:SUPABASE_URL|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY)/i.test(log)) return 'ENVIRONMENT';
  if (/connect.*(?:refused|timed out)|ECONNREFUSED|network.*unreachable/i.test(log)) return 'LOCAL_SERVICE_CONNECTION';
  if (/out of memory|oomkilled|no space left on device/i.test(log)) return 'RUNNER_RESOURCE';
  return 'UNCLASSIFIED';
}
const mode = process.argv[2];
if (mode === 'classify') {
  try { console.log(`EDGE_LOG_CATEGORY=${classify(readFileSync(process.argv[3], 'utf8'))}`); }
  catch { console.log('EDGE_LOG_CATEGORY=UNAVAILABLE'); process.exitCode = 1; }
} else if (mode === 'run') {
  const api = process.env.API_URL;
  const key = process.env.ANON_KEY;
  let url;
  try { url = new URL(api); } catch { /* rejected below */ }
  if (!url || url.protocol !== 'http:' || !['localhost','127.0.0.1'].includes(url.hostname) || !key) {
    console.error('EDGE_DIAG_REFUSED_NONLOCAL_TARGET'); process.exit(2);
  }
  let failed = false;
  for (const name of names) {
    try {
      const response = await fetch(new URL(`/functions/v1/${name}`, url), {
        method: 'OPTIONS', headers: {apikey:key,Authorization:`Bearer ${key}`},
        signal: AbortSignal.timeout(12000),
      });
      let code = 'NONE';
      if (response.status >= 500) {
        try {
          const body = await response.json();
          if (['BOOT_ERROR','LOAD_FUNCTION_ERROR','LOAD_FUNCTION_METADATA_ERROR','WORKER_RESOURCE_LIMIT'].includes(body?.code)) code=body.code;
        } catch { /* raw body intentionally withheld */ }
      }
      console.log(`EDGE_BOOT name=${name} status=${response.status} code=${code}`);
      if (response.status !== 200 && response.status !== 204) failed = true;
    } catch {
      console.log(`EDGE_BOOT name=${name} status=UNAVAILABLE code=REQUEST_FAILED`);
      failed = true;
    }
  }
  const listing = spawnSync('docker',['ps','-a','--format','{{.Names}}'],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
  const candidates = (listing.stdout ?? '').split(/\r?\n/).filter(x=>/^supabase_(?:edge_runtime|functions)_[-a-z0-9_]+$/i.test(x));
  if (listing.status !== 0 || !candidates.length) {
    console.log('EDGE_RUNTIME_LOG_CATEGORY=UNAVAILABLE');
  } else {
    for (const container of candidates) {
      const logs = spawnSync('docker',['logs','--tail','250',container],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
      console.log(`EDGE_RUNTIME_LOG_CATEGORY=${logs.status===0?classify(`${logs.stdout}\n${logs.stderr}`):'UNAVAILABLE'}`);
    }
  }
  if (failed) process.exitCode = 1;
} else {
  console.error('Expected classify or run mode');
  process.exitCode = 2;
}

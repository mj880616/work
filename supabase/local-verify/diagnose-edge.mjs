#!/usr/bin/env node
// Disposable local Edge Runtime diagnostics. Never emit response bodies, Docker
// logs, request headers, secrets, user identifiers, or function source.
import {existsSync, readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {classifyEdgeResponse} from './edge-readiness-policy.mjs';

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
function localTarget() {
  const api = process.env.API_URL;
  const key = process.env.ANON_KEY;
  let url;
  try { url = new URL(api); } catch { /* rejected below */ }
  if (!url || url.protocol !== 'http:' || !['localhost','127.0.0.1'].includes(url.hostname) || !key) {
    console.error('EDGE_DIAG_REFUSED_NONLOCAL_TARGET'); process.exit(2);
  }
  return {url, key};
}
function responseCode(body) {
  try {
    const code = JSON.parse(body)?.code;
    return ['AUTH_REQUIRED', 'BOOT_ERROR', 'LOAD_FUNCTION_ERROR',
      'LOAD_FUNCTION_METADATA_ERROR', 'WORKER_RESOURCE_LIMIT'].includes(code) ? code : null;
  } catch { return null; }
}
function inspectLocalRuntime() {
  const localStatus = spawnSync('supabase',['status','-o','env'],
    {encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
  console.log(`EDGE_LOCAL_STATUS=${localStatus.status===0?'AVAILABLE':'UNAVAILABLE'}`);
  for (const name of names) {
    console.log(`EDGE_SOURCE name=${name} index=${existsSync(`supabase/functions/${name}/index.ts`)}`);
  }
  console.log(`EDGE_SOURCE shared=${existsSync('supabase/functions/_shared/meeting-auth.mjs')}`);
  const startLog = process.argv[4];
  if (startLog && startLog.startsWith('/tmp/') && existsSync(startLog)) {
    try { console.log(`EDGE_START_LOG_CATEGORY=${classify(readFileSync(startLog,'utf8'))}`); }
    catch { console.log('EDGE_START_LOG_CATEGORY=UNAVAILABLE'); }
  }
  const listing = spawnSync('docker',['ps','-a','--format','{{.Names}}|{{.State}}'],
    {encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
  if (listing.status !== 0) {
    console.log('EDGE_DOCKER_STATUS=UNAVAILABLE');
    return;
  }
  const services = ['edge_runtime', 'functions', 'kong'];
  const entries = (listing.stdout ?? '').split(/\r?\n/).map(line => line.split('|'));
  for (const service of services) {
    const entry = entries.find(([name]) => name?.startsWith(`supabase_${service}_`));
    console.log(`EDGE_CONTAINER service=${service} state=${entry?.[1] ?? 'ABSENT'}`);
    if (!entry || !['edge_runtime','functions'].includes(service)) continue;
    const [name] = entry;
    const detail = spawnSync('docker',['inspect','--format','{{json .State}}',name],
      {encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
    try {
      const state = JSON.parse(detail.stdout);
      console.log(`EDGE_CONTAINER_DETAIL service=${service} health=${state.Health?.Status ?? 'NONE'} oom=${Boolean(state.OOMKilled)} exit=${Number.isInteger(state.ExitCode) ? state.ExitCode : 'UNKNOWN'}`);
    } catch { console.log(`EDGE_CONTAINER_DETAIL service=${service} state=UNAVAILABLE`); }
    const logs = spawnSync('docker',['logs','--tail','250',name],
      {encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
    console.log(`EDGE_RUNTIME_LOG_CATEGORY=${logs.status===0?classify(`${logs.stdout}\n${logs.stderr}`):'UNAVAILABLE'}`);
  }
}
if (mode === 'classify') {
  try { console.log(`EDGE_LOG_CATEGORY=${classify(readFileSync(process.argv[3], 'utf8'))}`); }
  catch { console.log('EDGE_LOG_CATEGORY=UNAVAILABLE'); process.exitCode = 1; }
} else if (mode === 'readiness') {
  const {url, key} = localTarget();
  const point = /^[a-z-]{1,24}$/.test(process.argv[3] ?? '') ? process.argv[3] : 'unspecified';
  let failed = false;
  for (const name of names) {
    let stage = 'REQUEST_UNAVAILABLE';
    let optionsStatus = 'NONE';
    let requestStatus = 'NONE';
    let category = 'GATEWAY_OR_RUNTIME_UNAVAILABLE';
    try {
      const endpoint = new URL(`/functions/v1/${name}`, url);
      const options = await fetch(endpoint, {
        method:'OPTIONS', headers:{apikey:key,Authorization:`Bearer ${key}`},
        signal:AbortSignal.timeout(8000),
      });
      optionsStatus = options.status;
      const optionsBody = await options.text();
      category = classifyEdgeResponse(options.status, responseCode(optionsBody));
      if (options.status === 200 && optionsBody === 'ok') {
        stage = 'FUNCTION_BOOTED';
        const request = await fetch(endpoint, {
          method:'POST', headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
          body:'{}', signal:AbortSignal.timeout(8000),
        });
        requestStatus = request.status;
        category = classifyEdgeResponse(request.status, responseCode(await request.text()));
        if (category === 'FUNCTION_AUTHORIZATION_RETURNED') stage = 'AUTH_RETURNED';
        else stage = 'REQUEST_FAILED';
      } else stage = 'FUNCTION_BOOT_FAILED';
    } catch { stage = 'REQUEST_UNAVAILABLE'; }
    console.log(`EDGE_READINESS name=${name} point=${point} stage=${stage} options=${optionsStatus} request=${requestStatus} category=${category}`);
    if (stage !== 'AUTH_RETURNED') failed = true;
  }
  if (failed) inspectLocalRuntime();
  if (failed) process.exitCode = 1;
} else if (mode === 'run') {
  const {url, key} = localTarget();
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
  inspectLocalRuntime();
  if (failed) process.exitCode = 1;
} else {
  console.error('Expected classify, readiness or run mode');
  process.exitCode = 2;
}

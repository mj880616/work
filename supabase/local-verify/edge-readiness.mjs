#!/usr/bin/env node
// Local-only readiness probe for the three meeting Edge Functions.
// Never print keys, request/response bodies, headers, or non-loopback URLs.

const names = ['meeting-ai-draft', 'meeting-ai-ingest', 'meeting-files'];
const api = process.env.API_URL;
const key = process.env.ANON_KEY;
let base;
try { base = new URL(api); } catch { /* rejected below */ }

if (!base || base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname) || !key) {
  console.error('EDGE_READINESS_REFUSED_NONLOCAL_TARGET');
  process.exit(2);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let failed = false;

for (const name of names) {
  let ready = false;
  let status = 'UNAVAILABLE';
  let code = 'REQUEST_FAILED';

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const response = await fetch(new URL(`/functions/v1/${name}`, base), {
        method: 'OPTIONS',
        headers: {apikey: key, Authorization: `Bearer ${key}`},
        signal: AbortSignal.timeout(5000),
      });
      status = String(response.status);
      code = 'NONE';
      if (response.status >= 500) {
        try {
          const body = await response.json();
          if (['BOOT_ERROR','LOAD_FUNCTION_ERROR','LOAD_FUNCTION_METADATA_ERROR','WORKER_RESOURCE_LIMIT'].includes(body?.code)) {
            code = body.code;
          }
        } catch { /* raw response intentionally withheld */ }
      }
      if (response.status === 200 || response.status === 204) {
        ready = true;
        break;
      }
    } catch {
      status = 'UNAVAILABLE';
      code = 'REQUEST_FAILED';
    }
    if (attempt < 5) await sleep(2000);
  }

  console.log(`EDGE_READINESS name=${name} status=${status} code=${code} ready=${ready}`);
  if (!ready) failed = true;
}

if (failed) process.exitCode = 1;

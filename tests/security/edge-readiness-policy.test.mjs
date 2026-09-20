import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import { classifyEdgeResponse } from '../../supabase/local-verify/edge-readiness-policy.mjs';

test('edge readiness distinguishes gateway, boot, routing and function authorization responses', () => {
  assert.equal(classifyEdgeResponse(502, 'BOOT_ERROR'), 'FUNCTION_BOOT_FAILURE');
  assert.equal(classifyEdgeResponse(502, null), 'GATEWAY_OR_RUNTIME_UNAVAILABLE');
  assert.equal(classifyEdgeResponse(404, null), 'FUNCTION_ROUTING_FAILURE');
  assert.equal(classifyEdgeResponse(401, 'AUTH_REQUIRED'), 'FUNCTION_AUTHORIZATION_RETURNED');
  assert.equal(classifyEdgeResponse(500, null), 'REQUEST_EXCEPTION_OR_RUNTIME');
});

async function runReadiness(responseFor) {
  const server = createServer((request, response) => {
    const result = responseFor(request);
    response.writeHead(result.status, {'Content-Type': 'application/json'});
    response.end(result.body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const child = spawn(process.execPath,
      [fileURLToPath(new URL('../../supabase/local-verify/diagnose-edge.mjs', import.meta.url)), 'readiness', 'test'],
      {env: {...process.env, API_URL: `http://127.0.0.1:${server.address().port}`, ANON_KEY: 'synthetic-local-key'}});
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const exitCode = await new Promise(resolve => child.on('exit', resolve));
    return {exitCode, output};
  } finally {
    server.close();
  }
}

test('readiness proves all three endpoints return their own OPTIONS and auth responses', async () => {
  const result = await runReadiness(request => request.method === 'OPTIONS'
    ? {status:200, body:'ok'}
    : {status:401, body:JSON.stringify({code:'AUTH_REQUIRED', error:'synthetic'})});
  assert.equal(result.exitCode, 0, result.output);
  for (const name of ['meeting-ai-draft', 'meeting-ai-ingest', 'meeting-files']) {
    assert.match(result.output, new RegExp(`EDGE_READINESS name=${name} .*stage=AUTH_RETURNED`));
  }
  assert.doesNotMatch(result.output, /synthetic-local-key/);
});

test('readiness rejects a boot 502 and reports only its category', async () => {
  const result = await runReadiness(() => ({status:502, body:JSON.stringify({code:'BOOT_ERROR', secret:'never-print-me'})}));
  assert.notEqual(result.exitCode, 0);
  assert.match(result.output, /FUNCTION_BOOT_FAILURE/);
  assert.doesNotMatch(result.output, /never-print-me|synthetic-local-key/);
});

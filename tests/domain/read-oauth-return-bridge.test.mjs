import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const READ_APP = 'https://read.bokdoong.com/';

function runBridge(script, locationInput) {
  let replaced = '';
  const location = {
    search: locationInput.search || '',
    hash: locationInput.hash || '',
    replace(value) { replaced = value; }
  };
  const context = { URL, URLSearchParams, location };
  vm.runInNewContext(script, context);
  return replaced;
}

const auth = fs.readFileSync(new URL('../../app/auth-bootstrap.js', import.meta.url), 'utf8');
const bridgeStart = auth.indexOf('function forwardReadPkceCallback()');
const bridgeEnd = auth.indexOf('function decodeJwt', bridgeStart);
assert.ok(bridgeStart >= 0 && bridgeEnd > bridgeStart, 'web2 app read OAuth bridge must exist');
const bridgeScript = auth.slice(bridgeStart, bridgeEnd);

assert.equal(
  runBridge(bridgeScript, { search: '?code=abc123' }),
  READ_APP + '?code=abc123'
);
assert.equal(
  runBridge(bridgeScript, { search: '?code=abc123&foo=bar', hash: '#state=x' }),
  READ_APP + '?code=abc123&foo=bar#state=x'
);
assert.equal(
  runBridge(bridgeScript, { search: '?foo=bar' }),
  ''
);
assert.equal(
  runBridge(bridgeScript, { search: '?code=abc123', hash: '#access_token=token&refresh_token=refresh' }),
  ''
);

const root = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const rootScript = root.match(/<script>\s*\(function\(\)\{[\s\S]*?read\.bokdoong\.com[\s\S]*?<\/script>/)?.[0] || '';
assert.match(rootScript, /read\.bokdoong\.com/);
assert.match(rootScript, /params?|p=new URLSearchParams|URLSearchParams/);
assert.match(rootScript, /location\.replace/);

console.log('read OAuth return bridge is present and narrow');

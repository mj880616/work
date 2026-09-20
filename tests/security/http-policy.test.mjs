import test from 'node:test';
import assert from 'node:assert/strict';
import {hidden, assertMeetingDenied} from '../../supabase/local-verify/http-policy.mjs';

test('server failure cannot masquerade as RLS denial', () => {
  assert.equal(hidden({status: 503, data: null}), false);
  assert.equal(hidden({status: 500, data: []}), false);
  assert.equal(hidden({status: 200, data: []}), true);
  assert.equal(hidden({status: 403, data: {code: 'PGRST301'}}), true);
});

test('meeting denial requires exact status and authorization code', () => {
  assertMeetingDenied(assert, {status: 403, data: {code: 'RESOURCE_FORBIDDEN'}},
    403, 'RESOURCE_FORBIDDEN', 'outsider');
  assert.throws(() => assertMeetingDenied(assert, {status: 503, data: {code: 'BOOT_ERROR'}},
    403, 'RESOURCE_FORBIDDEN', 'outsider'));
});

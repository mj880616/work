import test from 'node:test';
import assert from 'node:assert/strict';
import {MeetingAuthError, meetingAuthResponse} from '../../supabase/functions/_shared/meeting-auth.mjs';

test('meeting authorization errors have distinct 401 and 403 responses', async () => {
  for (const [status, code] of [[401,'AUTH_REQUIRED'],[403,'RESOURCE_FORBIDDEN']]) {
    const response = meetingAuthResponse(new MeetingAuthError(status, code), {'Access-Control-Allow-Origin':'*'});
    assert.equal(response.status,status);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');
    assert.deepEqual(await response.json(),{error:status===401?'로그인이 필요합니다.':'접근 권한이 없습니다.',code});
  }
});

test('meeting authorization response leaves ordinary failures to the handler', () => {
  assert.equal(meetingAuthResponse(new Error('network unavailable'),{}),null);
  assert.throws(() => new MeetingAuthError(500,'RESOURCE_FORBIDDEN'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {redactBody, summarizeDefiners} from '../../supabase/local-verify/review-definer-body.mjs';

test('definer review removes secret-bearing literals, comments and dollar strings', () => {
  const raw = `-- secret-comment-canary\nselect 'secret-string-canary', "secret-id-canary", $$secret-dollar-canary$$, 12345;`;
  const safe = redactBody(raw);
  for (const secret of ['secret-comment-canary','secret-string-canary','secret-id-canary',
    'secret-dollar-canary','12345']) assert.ok(!safe.includes(secret));
  assert.match(safe, /select/);
});

test('review extracts only allowlisted SECURITY DEFINER functions', () => {
  const sql = `-- Name: app_can_view_event(uuid); Type: FUNCTION; Schema: private; Owner: postgres\n` +
    `CREATE FUNCTION private.app_can_view_event(p_id uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $function$\n` +
    `select private.app_is_workspace_member(p_id) and x = 'secret';\n$function$;\n` +
    `-- Name: app_can_edit_suborganization(uuid); Type: FUNCTION; Schema: private; Owner: postgres\n` +
    `CREATE FUNCTION private.app_can_edit_suborganization(p_id uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $function$\n` +
    `select auth.uid() is not null;\n$function$;`;
  const result = summarizeDefiners(sql);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].calledHelpers, ['app_is_workspace_member']);
  assert.equal(result[1].authUid, true);
  assert.ok(!JSON.stringify(result).includes('secret'));
});

#!/usr/bin/env node
// Report only explicitly selected privilege booleans and trusted function names.
import {readFileSync} from 'node:fs';
const path=process.argv[2];
const expected=new Set([
  'app_can_edit_space','app_can_edit_suborganization','app_can_manage_space',
  'app_can_view_event','app_can_view_space','app_enforce_workspace_member_role',
  'app_link_profile_workplace_org','app_seed_child_project_management',
  'app_sync_profile_workplace_name','app_task_child_project_guard',
].map(x=>`private.${x}`));
try {
  const rows=readFileSync(path,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  if(rows.length!==10 || rows.some(x=>!expected.delete(x.name)) || expected.size) throw Error('Function census mismatch');
  for(const x of rows) {
    if(typeof x.anonExecute!=='boolean'||typeof x.authenticatedExecute!=='boolean'||typeof x.serviceExecute!=='boolean') throw Error('ACL unavailable');
    const ret=/^[a-z_][a-z_0-9]*(?:\.[a-z_][a-z_0-9]*)?$/i.test(x.returns)?x.returns:'REDACTED';
    console.log(`DEFINER_ACL name=${x.name} returns=${ret} definer=${!!x.definer} search_path=${!!x.searchPath} uuid_input=${!!x.uuidInput} default_acl=${!!x.publicAclDefault} anon_exec=${x.anonExecute} auth_exec=${x.authenticatedExecute} service_exec=${x.serviceExecute} anon_schema=${!!x.anonSchemaUsage} auth_schema=${!!x.authenticatedSchemaUsage} service_schema=${!!x.serviceSchemaUsage}`);
  }
} catch {
  console.error('DEFINER_ACL_REVIEW_FAILED: metadata withheld');
  process.exitCode=1;
}

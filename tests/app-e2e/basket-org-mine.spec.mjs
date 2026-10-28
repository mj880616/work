import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const stamp='2026-10-11T01:02:03.123456Z',noteId='10000000-0000-4000-8000-000000000001';
const orgs=[
 {id:'30000000-0000-4000-8000-000000000001',workspace_id:'w',name:'합성 담당 A',active:true},
 {id:'30000000-0000-4000-8000-000000000002',workspace_id:'w',name:'합성 담당 B',active:null},
 {id:'30000000-0000-4000-8000-000000000003',workspace_id:'w',name:'합성 다른 조직',active:true,default_assignee_name:'합성 소유자'},
 {id:'30000000-0000-4000-8000-000000000004',workspace_id:'w',name:'합성 비활성',active:false},
];
const notice='담당조직이 지정되지 않아 전체 조직을 싣습니다';
for(const width of [390,1280]){
 for(const mode of ['two','zero','inactive-only','failure']){
   }
}

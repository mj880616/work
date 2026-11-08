// BIZ-기록하나로 B-3: 사업 '지금 상황'(app_business_now)·사업 기록(app_business_records) 가짜 서버.
// 실제 표처럼 (작업공간, 사업, 주)마다 1행 — 처음 채우기(resolution=ignore-duplicates)는 이미 있는 행을 건너뛴다. 이름·글은 모두 합성 값.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
export async function installBusinessNowServer(page,{now=[],records=[],missing=false}={}){
  const db={now:now.map(r=>({...r})),records:records.map(r=>({...r})),writes:[],fills:[],reads:0};
  let n=0;const id=()=>`bn000000-0000-4000-8000-${String(++n).padStart(12,'0')}`;
  const json=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_business_now',async route=>{
    const req=route.request(),q=new URL(req.url()).searchParams,m=req.method(),eq=k=>(q.get(k)||'').replace(/^eq\./,'');
    if(missing)return json(route,{code:'PGRST205',message:'Could not find the table'},404);
    if(m==='GET'){db.reads++;return json(route,db.now)}
    if(m==='POST'){
      const body=req.postDataJSON(),list=Array.isArray(body)?body:[body],prefer=req.headers().prefer||'';
      const out=[];
      for(const b of list){
        const same=db.now.find(r=>r.space_id===b.space_id&&r.week_start===b.week_start);
        if(same){if(prefer.includes('ignore-duplicates'))continue;return json(route,{code:'23505',message:'duplicate'},409)}
        const row={id:id(),body:'',owner_text:'',updated_at:'2026-11-17T01:00:00Z',...b};db.now.push(row);out.push(row);
      }
      if(Array.isArray(body))db.fills.push(list);else db.writes.push({m,...body});
      return prefer.includes('return=representation')?json(route,out,201):route.fulfill({status:201,body:''});
    }
    if(m==='PATCH'){const b=req.postDataJSON();db.writes.push({m,id:eq('id'),...b});const hit=db.now.filter(r=>r.id===eq('id'));hit.forEach(r=>Object.assign(r,b));return json(route,hit)}
    return json(route,{message:'no'},405);
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_business_records',route=>{
    const req=route.request();
    if(missing)return json(route,{code:'PGRST205',message:'Could not find the table'},404);
    if(req.method()==='GET')return json(route,db.records);
    const b=req.postDataJSON(),row={id:id(),end_day:null,created_at:'2026-11-17T01:00:00Z',...b};db.records.push(row);db.writes.push({m:'POST records',...b});
    return json(route,[row],201);
  });
  return db;
}

// Web2 서비스 워커. 요청을 가로채지 않는다(fetch는 그대로 통과).
// OD-폰보관: 화면이 가려질 때 넘긴 원드라이브 작은 그림 받기(Background Fetch, 지원 브라우저만)가 끝나면
// 그림 바이트만 od-thumb-cache.js(Cache Storage의 유일한 사용처)에 넣는다. 주소·토큰은 넣지 않는다.
importScripts('./od-thumb-cache.js');
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',()=>{});

const BG_PREFIX='od-thumb-';
async function keepFetched(event,done){
  const reg=event.registration;
  if(!reg||typeof reg.id!=='string'||!reg.id.startsWith(BG_PREFIX))return;
  const api=self.ODThumbCache,store=api.create();
  const owners=new Set();
  let kept=0,records=[];
  try{records=await reg.matchAll();}catch{records=[];}
  for(const record of records){
    const meta=api.untag(record.request&&record.request.url);
    if(!meta)continue;
    let res;
    try{res=await record.responseReady;}catch{continue;}
    if(!res||!res.ok)continue;
    let blob;
    try{blob=await res.blob();}catch{continue;}
    if(await store.put(meta.owner,meta.id,meta.size,meta.month,blob)){kept++;owners.add(meta.owner);}
  }
  // 한 사람 것만 받았을 때만 상한 정리(정리는 다른 주인의 사본을 지우므로).
  if(owners.size===1)await store.prune([...owners][0],{full:true});
  if(done&&typeof event.updateUI==='function'){
    try{await event.updateUI({title:`원드라이브 작은 그림 ${kept}장 보관`});}catch{}
  }
}
self.addEventListener('backgroundfetchsuccess',event=>event.waitUntil(keepFetched(event,true)));
self.addEventListener('backgroundfetchfail',event=>event.waitUntil(keepFetched(event,false)));

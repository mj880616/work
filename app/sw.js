self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',()=>{});
self.addEventListener('push',event=>{
  let data={};
  try{data=event.data?.json?.()||{}}catch{try{data={body:event.data?.text?.()||''}}catch{data={}}}
  const title=data.title||'공공기관사업팀 Workspace';
  const options={
    body:data.body||'',
    icon:'./app-icon.svg?v=20260924-unicorn2',
    badge:'./app-icon.svg?v=20260924-unicorn2',
    tag:data.tag||'kptu-workspace',
    renotify:true,
    data:{url:data.url||'/work/app/'}
  };
  event.waitUntil(self.registration.showNotification(title,options));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL(event.notification?.data?.url||'/work/app/',self.location.origin).href;
  event.waitUntil((async()=>{
    const list=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of list){
      if('navigate' in client)await client.navigate(target);
      if('focus' in client)return client.focus();
    }
    if(self.clients.openWindow)return self.clients.openWindow(target);
  })());
});

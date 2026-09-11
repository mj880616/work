(()=>{
  const original=window.fetch.bind(window);
  window.fetch=(input,init)=>{
    try{
      const url=typeof input==='string'?input:(input&&input.url)||'';
      if(url.includes('/functions/v1/library-files')&&init?.body instanceof FormData&&init.body.get('meeting_id')){
        const next=url.replace('/functions/v1/library-files','/functions/v1/meeting-files');
        input=typeof input==='string'?next:new Request(next,input);
      }
    }catch(_){ }
    return original(input,init);
  };
})();
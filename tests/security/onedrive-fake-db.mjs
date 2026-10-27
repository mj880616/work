// 지어낸 Supabase 표(메모리). onedrive-photos 시험 전용. 네트워크·실제 자료 없음.
// handler가 쓰는 PostgREST 모양만 흉내 낸다: select/eq/in/gte/lt/or(is.null,lt)/order/range/maybeSingle, insert/upsert/update/delete(+select).
export const KEYS={app_onedrive_folders:['workspace_id','item_id'],app_onedrive_photos:['workspace_id','item_id']};
export function memTables(seed={}){
  const tables={app_onedrive_folders:[],app_onedrive_photos:[],...structuredClone(seed)};
  const log=[];
  const from=table=>{
    const q={op:'select',filters:[],range:null,single:false,ret:false};
    const b={
      select(){if(q.op!=='select')q.ret=true;return b;},
      eq(k,v){q.filters.push(r=>r[k]===v);return b;},
      in(k,vs){q.filters.push(r=>vs.includes(r[k]));return b;},
      gte(k,v){q.filters.push(r=>r[k]!=null&&String(r[k])>=v);return b;},
      lt(k,v){q.filters.push(r=>r[k]!=null&&String(r[k])<v);return b;},
      or(expr){const parts=expr.split(',').map(p=>{const [c,op,...rest]=p.split('.');return {c,op,v:rest.join('.')};});
        q.filters.push(r=>parts.some(p=>p.op==='is'?r[p.c]==null:p.op==='lt'?(r[p.c]!=null&&String(r[p.c])<p.v):false));return b;},
      order(){return b;},range(a,z){q.range=[a,z];return b;},maybeSingle(){q.single=true;return b;},
      insert(v){q.op='insert';q.value=v;return b;},upsert(v){q.op='upsert';q.value=v;return b;},
      update(v){q.op='update';q.value=v;return b;},delete(){q.op='delete';return b;},
      then(res,rej){return Promise.resolve().then(()=>run(table,q)).then(res,rej);},
    };
    return b;
  };
  function run(table,q){
    const rows=tables[table]||=[];const keys=KEYS[table]||['workspace_id'];
    const match=r=>q.filters.every(f=>f(r));const same=(a,b)=>keys.every(k=>a[k]===b[k]);
    log.push({table,op:q.op,value:q.value});
    if(q.op==='select'){
      let out=rows.filter(match).map(r=>({...r}));
      if(keys.includes('item_id'))out.sort((a,b)=>String(a.item_id).localeCompare(String(b.item_id)));
      if(q.single)return {data:out[0]??null,error:null};
      if(q.range)out=out.slice(q.range[0],q.range[1]+1);
      return {data:out,error:null};
    }
    if(q.op==='insert'){for(const v of [].concat(q.value)){if(rows.some(r=>same(r,v)))return {error:{code:'23505'}};rows.push({...v});}return {error:null};}
    if(q.op==='upsert'){
      const list=[].concat(q.value);const seen=new Set();
      for(const v of list){const k=keys.map(x=>v[x]).join('|');if(seen.has(k))return {error:{code:'21000'}};seen.add(k);}
      for(const v of list){const hit=rows.find(r=>same(r,v));if(hit)Object.assign(hit,v);else rows.push({enabled:true,...v});}
      return {error:null};
    }
    if(q.op==='update'){const hit=rows.filter(match);for(const r of hit)Object.assign(r,q.value);return {data:q.ret?hit.map(r=>({...r})):null,error:null};}
    if(q.op==='delete'){const keep=rows.filter(r=>!match(r));const n=rows.length-keep.length;tables[table]=keep;return {data:null,error:null,count:n};}
    return {error:{code:'XX000'}};
  }
  return {tables,log,from};
}

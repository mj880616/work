// 지어낸 Supabase 표(메모리). onedrive-photos 시험 전용. 네트워크·실제 자료 없음.
// handler가 쓰는 PostgREST 모양만 흉내 낸다: select/eq/neq/is/in/gte/lt/lte/or(is.null,lt)/order/range/maybeSingle, insert/upsert/update/delete(+select).
// 시각 칸(…_at)은 글자 모양이 달라도 같은 시각이면 같게 비교한다(PostgreSQL timestamptz처럼). upsert는 supabase-js처럼 묶음 안 칸 합집합을 쓰고 빠진 칸은 null.
export const KEYS={app_onedrive_folders:['workspace_id','item_id'],app_onedrive_photos:['workspace_id','item_id']};
export function memTables(seed={}){
  const tables={app_onedrive_folders:[],app_onedrive_photos:[],...structuredClone(seed)};
  const cmp=(k,a,b)=>{if(a==null||b==null)return null;if(/_at$/.test(k)){const x=Date.parse(a),y=Date.parse(b);if(Number.isFinite(x)&&Number.isFinite(y))return x<y?-1:x>y?1:0;}
    const x=String(a),y=String(b);return x<y?-1:x>y?1:0;};
  const log=[];
  const from=table=>{
    const q={op:'select',filters:[],range:null,single:false,ret:false};
    const b={
      select(){if(q.op!=='select')q.ret=true;return b;},
      eq(k,v){q.filters.push(r=>r[k]===v||cmp(k,r[k],v)===0&&/_at$/.test(k));return b;},
      neq(k,v){q.filters.push(r=>r[k]!=null&&r[k]!==v);return b;},
      is(k,v){q.filters.push(r=>v===null?r[k]==null:r[k]===v);return b;},
      in(k,vs){q.filters.push(r=>vs.includes(r[k]));return b;},
      gte(k,v){q.filters.push(r=>cmp(k,r[k],v)>=0&&r[k]!=null);return b;},
      lt(k,v){q.filters.push(r=>r[k]!=null&&cmp(k,r[k],v)<0);return b;},
      lte(k,v){q.filters.push(r=>r[k]!=null&&cmp(k,r[k],v)<=0);return b;},
      or(expr){const parts=expr.split(',').map(p=>{const [c,op,...rest]=p.split('.');return {c,op,v:rest.join('.')};});
        q.filters.push(r=>parts.some(p=>p.op==='is'?r[p.c]==null:p.op==='lt'?(r[p.c]!=null&&String(r[p.c])<p.v):false));return b;},
      order(k,o={}){(q.orders||=[]).push([k,o.ascending!==false]);return b;},range(a,z){q.range=[a,z];return b;},maybeSingle(){q.single=true;return b;},
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
      if(q.orders)out.sort((a,b)=>{for(const [k,asc] of q.orders){const c=cmp(k,a[k],b[k]);if(c)return asc?c:-c;}return 0;});
      else if(keys.includes('item_id'))out.sort((a,b)=>String(a.item_id).localeCompare(String(b.item_id)));
      if(q.single)return {data:out[0]??null,error:null};
      if(q.range)out=out.slice(q.range[0],q.range[1]+1);
      return {data:out,error:null};
    }
    if(q.op==='insert'){for(const v of [].concat(q.value)){if(rows.some(r=>same(r,v)))return {error:{code:'23505'}};rows.push({...v});}return {error:null};}
    if(q.op==='upsert'){
      const list=[].concat(q.value);const seen=new Set();
      // supabase-js upsert(defaultToNull): 묶음 안 어느 행에 있는 칸은 모든 행에 보내고, 없는 행은 null. 그 칸이 아예 없으면 기존 값 그대로.
      const cols=[...new Set(list.flatMap(v=>Object.keys(v)))];for(const v of list)for(const c of cols)if(!(c in v))v[c]=null;
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

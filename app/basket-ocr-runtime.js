import {createBasketOcr} from './basket-ocr.js?v=1';

// One native authority per runtime lifetime. Facades own only operation guards
// and safe presentation outcomes; all attempt/write decisions stay in the core.
const runtimes=new WeakMap();
const refusal=code=>Object.freeze({ok:false,code,retryable:false,result_unknown:false,status:0});
export function createBasketOcrRuntime({rt,createController=createBasketOcr}={}) {
  let active=null,last=null;
  const outcomes=new Map();
  const scope=()=>{const context=rt.context.read();return {owner:context?.user?.id,workspace:context?.workspace?.id,epoch:rt.session.epoch()};};
  const key=value=>JSON.stringify([value.owner,value.workspace,value.epoch]);
  const authenticated=value=>{const session=rt.session.read();return key(scope())===key(value)&&typeof session?.access_token==='string'&&session.access_token.length>0&&session?.user?.id===value.owner;};
  const remember=(value,lease,action)=>{
    if(!value?.note_id||!value.drive_file_id||!lease.current())return;
    const id=JSON.stringify([key(lease.scope),value.note_id,value.drive_file_id]),prior=outcomes.get(id);
    if(value.ok){outcomes.delete(id);return;}
    if(!prior?.result_unknown||value.result_unknown)outcomes.set(id,Object.freeze({ok:value.ok,code:value.code,result_unknown:value.result_unknown,ocr_saved:value.ocr_saved,cleanup_state:value.cleanup_state,note_id:value.note_id,drive_file_id:value.drive_file_id,action}));
  };
  const core=createController({rt,isCurrent:()=>!!(active||last)?.current(),onChange:value=>{
    const lease=active;if(!lease?.current())return;
    try{lease.onChange(value);}catch{/* Presentation cannot change a native result. */}
  }});
  // Disabled creation/access never inspects runtime auth or caller predicates.
  const enabled=core.state.enabled;
  function bind({isCurrent=()=>true,onChange=()=>{}}={}) {
    const methods={};
    for(const name of ['capabilities','status','read','reconcile','cleanup'])methods[name]=async(...args)=>{
      if(!enabled)return core[name](...args);
      if(active)return refusal('OCR_BUSY');
      const captured=scope();
      const lease={scope:captured,onChange,current:()=>isCurrent()&&authenticated(captured)};
      if(!lease.current())return refusal('OCR_STALE');
      active=lease;
      try{
        const result=await core[name](...args);
        if(!lease.current())return refusal('OCR_STALE');
        remember(result,lease,name);return result;
      }finally{if(active===lease){last=lease;active=null;}}
    };
    return Object.freeze({...methods,enabled,get state(){
      const value=core.state;
      if(!enabled)return value;
      return isCurrent()&&(active||last)?.current()?value:Object.freeze({...value,capabilities:null,snapshot:null,outcome:null});
    },outcome(noteId,fileId){
      if(!enabled||!isCurrent())return null;
      const captured=scope();if(!authenticated(captured))return null;
      return outcomes.get(JSON.stringify([key(captured),noteId,fileId]))||null;
    }});
  }
  return Object.freeze({bind});
}
export function basketOcrFor({rt=globalThis.window?.KPTURuntime,...options}={}) {
  let runtime=runtimes.get(rt);
  if(!runtime){runtime=createBasketOcrRuntime({rt});runtimes.set(rt,runtime);}
  return runtime.bind(options);
}

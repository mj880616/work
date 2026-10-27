import {effectiveOcrText, OCR_LIMITS} from './basket-ocr-text.mjs';

// Source-controlled only. Production callers never supply enabled:true.
export const BASKET_OCR_ENABLED = true;
const RESPONSE_BYTES = 4194304, REQUEST_BYTES = 266240;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const stamp = value => typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,255}$/.test(value);
const safeCode = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value);
const mimes = ['image/jpeg','image/png'];
const cleanups = ['none','create_pending','create_unknown','created','delete_pending','deleted','delete_failed'];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, required, optional=[]) => object(value) && required.every(key => Object.hasOwn(value,key)) && Object.keys(value).every(key => [...required,...optional].includes(key));
const invalid = () => { throw Object.assign(Error('OCR_RESPONSE_INVALID'),{code:'OCR_RESPONSE_INVALID'}); };
function attachment(value) {
  if (!exact(value,['drive_file_id','file_name','mime_type','size_bytes'],['ocr']) || !id(value.drive_file_id) ||
      typeof value.file_name !== 'string' || value.file_name.includes('\0') || [...value.file_name].length < 1 || [...value.file_name].length > 255 ||
      typeof value.mime_type !== 'string' || !/^[^/\s]{1,127}\/[^/\s]{1,127}$/u.test(value.mime_type) || value.mime_type.includes('\0') ||
      !Number.isSafeInteger(value.size_bytes) || value.size_bytes < 1 || value.size_bytes > 104857600) invalid();
  try { effectiveOcrText(value); } catch { invalid(); }
  return value;
}
function statusBody(value,noteId) {
  if (!exact(value,['ok','note_id','updated_at','attachments']) || value.ok !== true || value.note_id !== noteId || !stamp(value.updated_at) ||
      !Array.isArray(value.attachments) || value.attachments.length > 20) invalid();
  const ids = new Set();
  for (const file of value.attachments) { attachment(file); if (ids.has(file.drive_file_id)) invalid(); ids.add(file.drive_file_id); }
  return value;
}
function capabilityBody(value) {
  if (!exact(value,['ok','protocol_version','db','supported_mime_types','limits']) || value.ok !== true ||
      value.protocol_version !== 1 || !['supported','unsupported'].includes(value.db) ||
      !exact(value.limits,['characters','utf8_bytes']) || value.limits.characters !== OCR_LIMITS.characters || value.limits.utf8_bytes !== OCR_LIMITS.utf8Bytes ||
      !Array.isArray(value.supported_mime_types) || value.supported_mime_types.some(mime => !mimes.includes(mime)) ||
      new Set(value.supported_mime_types).size !== value.supported_mime_types.length) invalid();
  return value;
}
const sameSource = (a,b) => ['drive_file_id','file_name','mime_type','size_bytes'].every(key => a[key] === b[key]);
function writeBody(value, httpOk, noteId, source, action) {
  const success = value?.ok === true;
  const required = success ? ['ok','note_id','updated_at','attachment','ocr_saved','text_changed','cleanup_state'] :
    ['ok','code','retryable','result_unknown','ocr_saved','text_changed'];
  const optional = success ? [] : ['cleanup_state','attachment','note_id','updated_at','attempt_id','temp_document_id'];
  if (!exact(value,required,optional) || (success ? !httpOk : value.ok !== false || httpOk || !safeCode(value.code) || value.retryable !== false || typeof value.result_unknown !== 'boolean') ||
      typeof value.ocr_saved !== 'boolean' || typeof value.text_changed !== 'boolean' ||
      (Object.hasOwn(value,'note_id') && value.note_id !== noteId) || (Object.hasOwn(value,'updated_at') && !stamp(value.updated_at)) ||
      (Object.hasOwn(value,'cleanup_state') && !cleanups.includes(value.cleanup_state)) ||
      (Object.hasOwn(value,'attempt_id') && !uuid(value.attempt_id)) || (Object.hasOwn(value,'temp_document_id') && (!id(value.temp_document_id) || value.temp_document_id === source.drive_file_id))) invalid();
  if (action !== 'ocr-read' && Object.hasOwn(value,'attempt_id') && value.attempt_id !== source.ocr?.attempt_id) invalid();
  if (Object.hasOwn(value,'attachment')) {
    attachment(value.attachment);
    const o = value.attachment.ocr;
    if (!sameSource(value.attachment,source) || (success && !o) ||
        value.ocr_saved !== ['done','empty'].includes(o?.state) ||
        (o && value.cleanup_state !== o.cleanup_state) || (!o && Object.hasOwn(value,'cleanup_state')) ||
        (Object.hasOwn(value,'attempt_id') && value.attempt_id !== o?.attempt_id) ||
        (Object.hasOwn(value,'temp_document_id') && value.temp_document_id !== o?.temp_document_id) ||
        (action !== 'ocr-read' && o?.attempt_id !== source.ocr?.attempt_id) ||
        (success && value.text_changed !== (effectiveOcrText(value.attachment) !== effectiveOcrText(source)))) invalid();
  } else if (value.ocr_saved || value.text_changed || Object.hasOwn(value,'cleanup_state') || Object.hasOwn(value,'temp_document_id')) invalid();
  return value;
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const copy = value => value == null ? value : structuredClone(value);
const refusal = code => freeze({ok:false,code,retryable:false,result_unknown:false,status:0});

/** No DOM or raw-editor writes. Each write reads a fresh CAS snapshot of its explicit note. */
export function createBasketOcr({rt=globalThis.window?.KPTURuntime,fetcher=globalThis.fetch,isCurrent=()=>true,onChange=()=>{},enabled=BASKET_OCR_ENABLED,waitMs=90000}={}) {
  enabled = enabled === true;
  const records = new Map();
  let capability=null, snapshot=null, outcome=null, stateScope=null, flight=null, generation=0;
  const capture = () => {
    const context=rt?.context?.read?.();
    return {owner:context?.user?.id,workspace:context?.workspace?.id,epoch:rt?.session?.epoch?.()};
  };
  const scopeKey = scope => JSON.stringify([scope.owner,scope.workspace,scope.epoch]);
  const current = scope => {
    if (!isCurrent() || scopeKey(capture()) !== scopeKey(scope)) return false;
    // Cross-tab storage changes can precede this document's context/epoch update.
    const session=rt.session.read();
    return typeof session?.access_token === 'string' && session.access_token.length > 0 && session?.user?.id === scope.owner;
  };
  const recordKey = (scope,noteId,fileId) => JSON.stringify([scopeKey(scope),noteId,fileId]);
  function state() {
    const visible = enabled && stateScope && current(stateScope);
    return freeze({enabled,busy:!!flight,capabilities:visible?copy(capability):null,snapshot:visible?copy(snapshot):null,outcome:visible?copy(outcome):null});
  }
  function notify(scope) { if (current(scope)) { try { onChange(state()); } catch { /* Observers cannot change operation results. */ } } }
  function setSnapshot(value,scope) { snapshot=freeze(copy(value));stateScope=scope; }

  // Deadline covers fetch AND reader.read. It limits client waiting, never aborts/replays POST.
  async function transport(scope,path,body) {
    let timer,reader,responseStatus=0,finished=false;
    const release = () => {
      if (!reader) return;
      try { Promise.resolve(reader.cancel()).catch(()=>{}); } catch {}
      try { reader.releaseLock(); } catch {}
      reader=null;
    };
    const request = (async()=>{
      const session=rt.session.read();
      if (!session?.access_token || session?.user?.id !== scope.owner || !current(scope)) throw Object.assign(Error(),{code:'OCR_STALE'});
      const headers={apikey:rt.config.key,Authorization:'Bearer '+session.access_token};
      if (body !== undefined) headers['Content-Type']='application/json';
      const response=await fetcher(rt.config.url+'/functions/v1/basket-files'+path,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body}),cache:'no-store'});
      responseStatus=response.status;
      if (finished) { try { Promise.resolve(response.body?.cancel()).catch(()=>{}); } catch {} return; }
      reader=response.body?.getReader();if (!reader) invalid();
      const parts=[];let size=0;
      while (!finished) {
        const chunk=await reader.read();if (finished) return;if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) invalid();
        size+=chunk.value.byteLength;if (size>RESPONSE_BYTES) invalid();parts.push(chunk.value);
      }
      const bytes=new Uint8Array(size);let offset=0;
      for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
      let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{invalid();}
      return {data,status:response.status,httpOk:response.ok};
    })();
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error(),{code:'OCR_DEADLINE'})),Math.min(90000,Math.max(1,Number.isFinite(waitMs)?waitMs:90000)));});
    try{return await Promise.race([request,deadline]);}
    catch(error){throw Object.assign(Error(),{code:error?.code==='OCR_STALE'?'OCR_STALE':error?.code==='OCR_RESPONSE_INVALID'?'OCR_RESPONSE_INVALID':'OCR_UNAVAILABLE',status:responseStatus});}
    finally{finished=true;clearTimeout(timer);release();}
  }
  async function start(run) {
    if (!enabled) return refusal('OCR_DISABLED');
    if (flight) return refusal('OCR_BUSY');
    const scope=capture(),token=++generation;
    if (!scope.owner || !scope.workspace || !Number.isSafeInteger(scope.epoch)) return refusal('SESSION_REQUIRED');
    flight={token,scope};
    try {
      if (!await rt.session.ensure()) return refusal('SESSION_REQUIRED');
      const session=rt.session.read();if (!session?.access_token || session?.user?.id !== scope.owner) return refusal('SESSION_REQUIRED');
      if (!current(scope) || flight?.token !== token) return refusal('OCR_STALE');
      if (!stateScope || scopeKey(stateScope)!==scopeKey(scope)) {capability=null;snapshot=null;outcome=null;stateScope=scope;}
      notify(scope);
      return await run(scope,token);
    } catch(error) { return freeze({...refusal(['OCR_RESPONSE_INVALID','OCR_STALE'].includes(error?.code)?error.code:'OCR_UNAVAILABLE'),status:error?.status||0}); }
    finally {if(flight?.token===token){flight=null;notify(scope);}}
  }
  async function freshStatus(scope,noteId) {
    const response=await transport(scope,'?action=ocr-status&note_id='+encodeURIComponent(noteId));
    if (!current(scope)) throw Object.assign(Error(),{code:'OCR_STALE'});
    if (!response.httpOk) throw Object.assign(Error(),{code:'OCR_UNAVAILABLE',status:response.status});
    const value=statusBody(response.data,noteId);setSnapshot(value,scope);
    // A negative status never removes an owned lost-write marker.
    for (const file of value.attachments) {
      const record=records.get(recordKey(scope,noteId,file.drive_file_id));
      if(record?.unknown && file.ocr?.attempt_id && (record.attemptId===file.ocr.attempt_id || (!record.attemptId && file.ocr.attempt_id!==record.previousAttemptId))) record.attemptId=file.ocr.attempt_id;
    }
    return value;
  }
  async function capabilities() {
    return start(async scope=>{
      capability=null;
      const response=await transport(scope,'?action=ocr-capabilities');if(!current(scope))return refusal('OCR_STALE');
      if(!response.httpOk)return freeze({...refusal('OCR_UNAVAILABLE'),status:response.status});
      const value=capabilityBody(response.data);
      if(value.db!=='supported'||!value.supported_mime_types.length)return refusal('OCR_UNSUPPORTED');
      capability=freeze(copy(value));stateScope=scope;return freeze({...copy(value),status:response.status});
    });
  }
  async function status(noteId) {
    if (!enabled) return refusal('OCR_DISABLED');
    if (!uuid(noteId)) return refusal('OCR_REQUEST_INVALID');
    return start(async scope=>{
      try {return freeze({...copy(await freshStatus(scope,noteId)),status:200});}
      catch(error){if(error.code==='OCR_STALE')return refusal('OCR_STALE');throw error;}
    });
  }
  async function write(action,noteId,fileId,options={}) {
    if (!enabled) return refusal('OCR_DISABLED');
    if (!uuid(noteId)||!id(fileId)||!exact(options,[],action==='ocr-reconcile'?['confirmCurrentNoteVersion']:[])) return refusal('OCR_REQUEST_INVALID');
    return start(async scope=>{
      if (!capability) return refusal('OCR_UNSUPPORTED');
      const key=recordKey(scope,noteId,fileId),previous=records.get(key);
      if(action==='ocr-read'&&previous?.unknown)return refusal('OCR_ATTEMPT_UNRESOLVED');
      // The caller's explicit action names the attempt displayed by its last status.
      // Lifecycle changes do not necessarily advance the raw timestamp; never switch attempts.
      const expectedAttempt=snapshot?.note_id===noteId?snapshot.attachments.find(file=>file.drive_file_id===fileId)?.ocr?.attempt_id:null;
      if(action!=='ocr-read'&&!uuid(expectedAttempt))return refusal('OCR_ATTEMPT_UNRESOLVED');
      const fresh=await freshStatus(scope,noteId),matches=fresh.attachments.filter(file=>file.drive_file_id===fileId);
      if(matches.length!==1)return refusal('ATTACHMENT_CHANGED');
      const source=matches[0],o=source.ocr;
      if(!capability.supported_mime_types.includes(source.mime_type))return refusal('OCR_SOURCE_UNSUPPORTED');
      if(action==='ocr-read') {
        if(!['unread','done','empty','failed'].includes(o?.state??'unread')||!['none','deleted'].includes(o?.cleanup_state??'none'))return refusal('OCR_ATTEMPT_UNRESOLVED');
      } else {
        if(o?.attempt_id!==expectedAttempt || (previous?.unknown && (!previous.attemptId || previous.attemptId!==o.attempt_id)))return refusal('OCR_ATTEMPT_UNRESOLVED');
        if(action==='ocr-reconcile'&&previous?.attemptId===o.attempt_id&&previous?.sourceChanged)return refusal('OCR_SOURCE_CHANGED');
        if(action==='ocr-reconcile'&&previous?.attemptId===o.attempt_id&&previous?.noteChanged&&!Object.hasOwn(options,'confirmCurrentNoteVersion'))return refusal('NOTE_CHANGED');
      }
      if(Object.hasOwn(options,'confirmCurrentNoteVersion')&&options.confirmCurrentNoteVersion!==fresh.updated_at)return refusal('NOTE_CHANGED');
      const body={action,note_id:noteId,note_updated_at:fresh.updated_at,expected_attachment:source,...(action==='ocr-read'?{}:{attempt_id:o.attempt_id}),
        ...(Object.hasOwn(options,'confirmCurrentNoteVersion')?{confirm_current_note_version:options.confirmCurrentNoteVersion}:{})};
      const serialized=JSON.stringify(body);if(new TextEncoder().encode(serialized).byteLength>REQUEST_BYTES)return refusal('OCR_REQUEST_TOO_LARGE');
      const sameAttempt=action!=='ocr-read'&&previous?.attemptId===o.attempt_id;
      const record={unknown:previous?.unknown??false,attemptId:action==='ocr-read'?null:o.attempt_id,previousAttemptId:o?.attempt_id??null,requestStartUpdatedAt:fresh.updated_at,
        sourceChanged:sameAttempt&&previous.sourceChanged,noteChanged:sameAttempt&&previous.noteChanged};
      records.set(key,record);
      let response,result;
      try {
        if(!current(scope))return refusal('OCR_STALE');
        response=await transport(scope,'',serialized);
        result=writeBody(response.data,response.httpOk,noteId,source,action);
      } catch(error) {
        record.unknown=true;
        const value=freeze({ok:false,code:'OCR_RESULT_UNKNOWN',retryable:false,result_unknown:true,status:response?.status||error?.status||0,note_id:noteId,drive_file_id:fileId,requestStartUpdatedAt:fresh.updated_at,text:effectiveOcrText(source)});
        if(!current(scope))return refusal('OCR_STALE');
        outcome=value;stateScope=scope;return value;
      }
      record.attemptId=result.attachment?.ocr?.attempt_id??result.attempt_id??record.attemptId;
      record.sourceChanged ||= result.code==='OCR_SOURCE_CHANGED';
      record.noteChanged ||= result.code==='NOTE_CHANGED';
      record.unknown=result.result_unknown===true || (record.unknown && !result.ok);
      // Only a validated success of this same persisted attempt resolves a lost-write record.
      if(result.ok)record.unknown=false;
      if(!current(scope)) {record.unknown=true;return refusal('OCR_STALE');}
      if(result.attachment && result.updated_at) setSnapshot({...fresh,updated_at:result.updated_at,attachments:fresh.attachments.map(file=>file.drive_file_id===fileId?result.attachment:file)},scope);
      outcome=freeze({...copy(result),status:response.status,result_unknown:record.unknown,note_id:noteId,drive_file_id:fileId,requestStartUpdatedAt:fresh.updated_at,text:effectiveOcrText(result.attachment??source)});
      return outcome;
    });
  }
  return Object.freeze({get state(){return state();},capabilities,status,
    read:(noteId,fileId)=>write('ocr-read',noteId,fileId),
    reconcile:(noteId,fileId,options={})=>write('ocr-reconcile',noteId,fileId,options),
    cleanup:function(noteId,fileId){return arguments.length>2?Promise.resolve(refusal(enabled?'OCR_REQUEST_INVALID':'OCR_DISABLED')):write('ocr-cleanup',noteId,fileId);}});
}

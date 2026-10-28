// Synthetic model of how supabase-js turns .contains(column, value) into the PostgREST query (cs.<value>), and of how
// PostgREST/Postgres then answer for a jsonb column. Used by fake DB harnesses so they see the same text the real server sees.
// Serialization follows @supabase/postgrest-js 2.x PostgrestFilterBuilder.contains:
//   string -> cs.<string>        (passed through as is)
//   array  -> cs.{a,b}           (a Postgres ARRAY literal: elements joined with ",", objects become "[object Object]")
//   object -> cs.<JSON>
export function containsParam(value){
  if(typeof value==='string')return 'cs.'+value;
  if(Array.isArray(value))return `cs.{${value.join(',')}}`;
  return 'cs.'+JSON.stringify(value);
}

// Postgres jsonb @> (containment): arrays contain when every needle element is contained by some element; objects by key.
function contained(hay,needle){
  if(Array.isArray(needle)){
    if(!Array.isArray(hay))return false;
    return needle.every(n=>hay.some(h=>contained(h,n)));
  }
  if(needle&&typeof needle==='object'){
    if(!hay||typeof hay!=='object'||Array.isArray(hay))return false;
    return Object.entries(needle).every(([k,v])=>k in hay&&contained(hay[k],v));
  }
  return hay===needle;
}

// What the server does with `column=cs.<text>` on a jsonb column. A non-JSON text (e.g. the array literal "{[object Object]}")
// is a request error, like PostgREST's 22P02 "invalid input syntax for type json".
export function jsonbContains(rows,column,param){
  if(typeof param!=='string'||!param.startsWith('cs.'))return {error:{code:'PGRST100',message:'synthetic bad filter'}};
  let needle;
  try{needle=JSON.parse(param.slice(3));}catch{return {error:{code:'22P02',message:'invalid input syntax for type json'}};}
  return {rows:rows.filter(r=>contained(r[column]??null,needle))};
}

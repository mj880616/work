import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
// User-authored content palettes remain free-form; UI token themes define the approved colors.
export const excluded=['theme-tokens.css','page-design-core.js','public-page-editor.js'];
export function countColors(name,source){
 if(excluded.includes(name))return 0;
 let text=source.replace(/\/\*[\s\S]*?\*\//g,'');
 if(name==='base-ui.css')text=text.replace(/:root\s*\{[^}]*\}/g,'');
 if(name.endsWith('.css'))text=text.replace(/[^{};]*\{/g,'{'); // Selectors such as #abc are not color values.
 return [...text.matchAll(/#[0-9a-f]{8}\b|#[0-9a-f]{6}\b|#[0-9a-f]{4}\b|#[0-9a-f]{3}\b|\brgba?\s*\([^)]*\)/gi)].length;
}
export function scanColors(root){
 if(root instanceof URL)root=fileURLToPath(root);
 return Object.fromEntries(readdirSync(root).filter(name=>/\.(css|js)$/.test(name)&&!excluded.includes(name)).sort().map(name=>[name,countColors(name,readFileSync(join(root,name),'utf8'))]));
}
export function compareColors(actual,baseline){
 const errors=[],reduced=[];
 for(const [name,count] of Object.entries(actual)){
  const limit=baseline[name]??0;
  if(count>limit)errors.push(name+': '+count+' > '+limit);
  else if(count<limit)reduced.push(name+': '+limit+' -> '+count);
 }
 for(const [name,count] of Object.entries(baseline))if(!(name in actual)&&count)reduced.push(name+': '+count+' -> 0');
 return {errors,reduced};
}
export function checkBaseline(){
 const baseline=JSON.parse(readFileSync(new URL('./hardcoded-colors-baseline.json',import.meta.url),'utf8'));
 const result=compareColors(scanColors(new URL('../app/',import.meta.url)),baseline);
 if(result.reduced.length)console.info('Direct colors decreased; update tests/hardcoded-colors-baseline.json in D-3b:\n'+result.reduced.join('\n'));
 return result;
}

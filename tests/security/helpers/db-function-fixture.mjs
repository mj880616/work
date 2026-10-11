export const version = '20261011130000';
export const name = 'ops_function_example';
export const signature = 'public.ops_example(integer)';
export const history = `insert into supabase_migrations.schema_migrations(version,name) values('${version}','${name}');`;
export const removal = `delete from supabase_migrations.schema_migrations where version='${version}' and name='${name}';`;
export const wrap = (commands, rollback = false) => `begin;\n${commands}\n${rollback ? removal : history}\ncommit;\n`;
export const definition = ({ schema = 'public', functionName = 'ops_example', args = 'p_value integer',
  language = 'sql', searchPath = "''", security = 'security invoker', body = 'select p_value + 1;', tag = '$body$' } = {}) =>
  `create or replace function ${schema}.${functionName}(${args}) returns integer\nlanguage ${language} ${security} set search_path = ${searchPath}\nas ${tag}${body}${tag};`;
export const revoke = (sig = signature, privilege = 'all', roles = 'public, anon') => `revoke ${privilege} on function ${sig} from ${roles};`;
export const grant = (sig = signature, role = 'authenticated') => `grant execute on function ${sig} to ${role};`;
export const migration = wrap(`${definition()}\n${revoke()}\n${grant()}`);
export const rollback = wrap(`drop function if exists ${signature};`, true);

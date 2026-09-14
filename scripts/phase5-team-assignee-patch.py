from pathlib import Path
import re

team = Path('app/team.js')
text = team.read_text(encoding='utf-8')
old = """    if(actionRows.some(x=>!x.title||!x.assignee_id))throw new Error('후속 할 일과 담당자를 모두 입력해 주세요.');
    if(assignments.length)await api('/rest/v1/app_tasks',{method:'POST',body:assignments.map(a=>({workspace_id:workspace.id,project_id:projectId,title:a.title,description:'회의 역할분담 · '+title,assignee_id:a.assignee_id,status:'todo',priority:'normal',due_at:a.due?new Date(a.due+'T18:00:00+09:00').toISOString():null,source_type:'meeting',source_id:meeting.id,created_by:user.id}))});"""
new = """    if(actionRows.some(x=>!x.title||!x.assignee_id))throw new Error('후속 할 일과 담당자를 모두 입력해 주세요.');
    assignments=assignments.flatMap(a=>a.assignee_id==='__team__'?members.map(m=>({...a,assignee_id:m.user_id})): [a]);
    if(assignments.length)await api('/rest/v1/app_tasks',{method:'POST',body:assignments.map(a=>({workspace_id:workspace.id,project_id:projectId,title:a.title,description:'회의 역할분담 · '+title,assignee_id:a.assignee_id,status:'todo',priority:'normal',due_at:a.due?new Date(a.due+'T18:00:00+09:00').toISOString():null,source_type:'meeting',source_id:meeting.id,created_by:user.id}))});"""
if text.count(old) != 1:
    raise SystemExit(f'team assignment block match={text.count(old)}')
team.write_text(text.replace(old, new), encoding='utf-8')

picker = Path('app/meeting-assignee-picker.js')
text = picker.read_text(encoding='utf-8')
pattern = r"  const originalFetch=window\.fetch\.bind\(window\);if\(!window\.__KPTU_MEETING_TEAM_FETCH_V3__\).*?(?=  document\.addEventListener\('click')"
text, count = re.subn(pattern, '', text, count=1, flags=re.S)
if count != 1:
    raise SystemExit(f'picker fetch interception match={count}')
picker.write_text(text, encoding='utf-8')

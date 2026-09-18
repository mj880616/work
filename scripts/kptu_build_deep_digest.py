import json
from pathlib import Path

ROOT=Path("analysis/kptu-corpus")
deep=json.loads((ROOT/"deep-sample-48.json").read_text(encoding="utf-8"))
ids={x["idx"] for x in deep["items"]}
rows={}
for p in (ROOT/"text").glob("*.json"):
    d=json.loads(p.read_text(encoding="utf-8"))
    for x in d.get("items",[]):
        if x["idx"] in ids:
            rows[x["idx"]]=x

outdir=ROOT/"deep"
outdir.mkdir(parents=True,exist_ok=True)
by={}
for x in deep["items"]:
    key=f'{x["kind"]}-{x["date"][:4]}'
    if x["idx"] in rows:
        by.setdefault(key,[]).append(rows[x["idx"]])

for key,items in by.items():
    items.sort(key=lambda x:(x["date"],x["idx"]),reverse=True)
    parts=[f"# {key} 심층독해 표본\n"]
    for i,x in enumerate(items,1):
        parts.append(f"## {i}. {x['title']}\n")
        parts.append(f"- idx: {x['idx']}\n- 날짜: {x['date']}\n- 작성: {x.get('author') or '미상'}\n- 추출원: {x.get('text_source')} / {x.get('text_chars')}자\n- 우선분야: {x.get('priority_topic')}\n")
        parts.append("\n### 본문\n\n"+x.get("text","").strip()+"\n\n---\n")
    (outdir/f"{key}.md").write_text("\n".join(parts),encoding="utf-8")

summary={"requested":len(ids),"found":len(rows),"groups":{k:len(v) for k,v in sorted(by.items())}}
(ROOT/"deep-summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps(summary,ensure_ascii=False))

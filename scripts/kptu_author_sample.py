import json,re
from pathlib import Path
from collections import defaultdict,Counter

ROOT=Path("analysis/kptu-corpus")
CONTACT=ROOT/"contact-authors-2023-2026.json"
OUT=ROOT/"author-sample-summary.json"
OUTDIR=ROOT/"authors"

contact=json.loads(CONTACT.read_text(encoding="utf-8"))
cmap={x["idx"]:[c for c in x.get("contacts",[]) if c.get("name")] for x in contact["items"]}

docs=[]
for p in (ROOT/"text").glob("*.json"):
    d=json.loads(p.read_text(encoding="utf-8"))
    docs.extend(d.get("items",[]))

authors=defaultdict(list)
unmapped=[]
for d in docs:
    cs=cmap.get(d["idx"],[])
    names=[]
    for c in cs:
        n=c["name"]
        if n and n not in names:names.append(n)
    if not names:
        unmapped.append({"idx":d["idx"],"kind":d["kind"],"date":d["date"],"title":d["title"]})
        continue
    for n in names:
        authors[n].append(d)

OUTDIR.mkdir(parents=True,exist_ok=True)
summary=[]
for name,rows in authors.items():
    kinds=Counter(x["kind"] for x in rows)
    years=Counter(x["date"][:4] for x in rows)
    summary.append({"name":name,"count":len(rows),"kinds":dict(kinds),"years":dict(years),"ids":[x["idx"] for x in rows]})
    if len(rows)>=2:
        parts=[f"# {name} — 180건 표본 내 담당자료 {len(rows)}건\n"]
        for x in sorted(rows,key=lambda z:(z["date"],z["idx"]),reverse=True):
            parts.append(f"## {x['date']} · {x['kind']} · {x['title']}\n\n{x.get('text','')}\n\n---\n")
        (OUTDIR/(re.sub(r"[^가-힣A-Za-z0-9_-]","_",name)+".md")).write_text("\n".join(parts),encoding="utf-8")

summary.sort(key=lambda x:(-x["count"],x["name"]))
OUT.write_text(json.dumps({
    "mapped_documents":len(docs)-len(unmapped),
    "unmapped_documents":len(unmapped),
    "authors":summary,
    "unmapped":unmapped
},ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps({"docs":len(docs),"mapped":len(docs)-len(unmapped),"authors":summary[:30]},ensure_ascii=False))

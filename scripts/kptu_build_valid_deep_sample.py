import json
from pathlib import Path
from collections import defaultdict

ROOT=Path("analysis/kptu-corpus")
VAL=json.loads((ROOT/"validation-summary.json").read_text(encoding="utf-8"))
vmap={x["idx"]:x for x in VAL["suspicious"]}
# include non-suspicious defaults too by rebuilding from validation full? summary only suspicious.
# read all extracted rows and compute acceptance; suspicious entries require checks.
rows=[]
for p in (ROOT/"text").glob("*.json"):
    d=json.loads(p.read_text(encoding="utf-8"))
    rows.extend(d.get("items",[]))

def is_valid(x):
    if x.get("text_source")!="hwp": return False
    if x.get("text_chars",0)<500: return False
    v=vmap.get(x["idx"])
    if not v: return True
    if v.get("author_mismatch"): return False
    if v.get("overlap_ratio",1)<0.10: return False
    return True

valid=[x for x in rows if is_valid(x)]
groups=defaultdict(list)
for x in valid: groups[(x["kind"],x["date"][:4])].append(x)

def spread(rows,n):
    rows=sorted(rows,key=lambda x:(x["date"],x["idx"]),reverse=True)
    if len(rows)<=n:return rows
    return [rows[round(i*(len(rows)-1)/(n-1))] for i in range(n)]

sel=[]
cells={}
for kind in ["보도자료","취재요청","성명"]:
    for year in ["2023","2024","2025","2026"]:
        pool=groups[(kind,year)]
        pri=[x for x in pool if x.get("priority_topic")]
        gen=[x for x in pool if not x.get("priority_topic")]
        chosen=spread(pri,3)+spread(gen,1)
        seen={x["idx"] for x in chosen}
        if len(chosen)<4:
            rest=[x for x in pool if x["idx"] not in seen]
            chosen+=spread(rest,4-len(chosen))
        chosen=chosen[:4]
        sel+=chosen
        cells[f"{kind}-{year}"]={"pool_valid":len(pool),"ids":[x["idx"] for x in chosen]}
sel={x["idx"]:x for x in sel}.values()
sel=sorted(sel,key=lambda x:(x["kind"],x["date"],x["idx"]),reverse=True)
out={"summary":{"total":len(sel),"cells":cells,"priority_topic":sum(1 for x in sel if x.get("priority_topic"))},"items":[{k:v for k,v in x.items() if k!="text"} for x in sel]}
(ROOT/"deep-sample-valid-48.json").write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding="utf-8")

# build readable digests from full rows
by=defaultdict(list)
for x in sel: by[f'{x["kind"]}-{x["date"][:4]}'].append(x)
outdir=ROOT/"deep-valid"; outdir.mkdir(parents=True,exist_ok=True)
for key,items in by.items():
    parts=[f"# {key} 검증 심층독해 표본\n"]
    for i,x in enumerate(sorted(items,key=lambda z:(z["date"],z["idx"]),reverse=True),1):
        parts.append(f"## {i}. {x['title']}\n\n- idx: {x['idx']}\n- 날짜: {x['date']}\n- 작성: {x.get('author')}\n- 본문: {x.get('text_chars')}자\n- 우선분야: {x.get('priority_topic')}\n\n### 본문\n\n{x.get('text','')}\n\n---\n")
    (outdir/f"{key}.md").write_text("\n".join(parts),encoding="utf-8")
print(json.dumps(out["summary"],ensure_ascii=False))

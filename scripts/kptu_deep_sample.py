import json
from pathlib import Path
from collections import defaultdict

SRC=Path("analysis/kptu-corpus/selected-180.json")
OUT=Path("analysis/kptu-corpus/deep-sample-48.json")

data=json.loads(SRC.read_text(encoding="utf-8"))
items=data["items"]
groups=defaultdict(list)
for x in items:
    groups[(x["kind"],x["date"][:4])].append(x)

def spread_pick(rows,n):
    rows=sorted(rows,key=lambda x:(x["date"],x["idx"]),reverse=True)
    if len(rows)<=n: return rows
    if n==1: return [rows[len(rows)//2]]
    idxs=[]
    for i in range(n):
        j=round(i*(len(rows)-1)/(n-1))
        if j not in idxs: idxs.append(j)
    return [rows[j] for j in idxs[:n]]

selected=[]
cells={}
for key,rows in sorted(groups.items()):
    pr=[x for x in rows if x.get("priority_topic")]
    ge=[x for x in rows if not x.get("priority_topic")]
    chosen=spread_pick(pr,3)+spread_pick(ge,1)
    # fill if needed
    seen={x["idx"] for x in chosen}
    if len(chosen)<4:
        rest=[x for x in rows if x["idx"] not in seen]
        chosen+=spread_pick(rest,4-len(chosen))
    chosen=chosen[:4]
    selected+=chosen
    cells[f"{key[0]}-{key[1]}"]=[x["idx"] for x in chosen]

uniq={x["idx"]:x for x in selected}
selected=list(uniq.values())
selected.sort(key=lambda x:(x["kind"],x["date"],x["idx"]),reverse=True)
summary={"total":len(selected),"cells":cells,"priority_topic":sum(1 for x in selected if x.get("priority_topic"))}
OUT.write_text(json.dumps({"summary":summary,"items":selected},ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps(summary,ensure_ascii=False,indent=2))

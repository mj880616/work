import json,re
from pathlib import Path
from collections import Counter

ROOT=Path("analysis/kptu-corpus")
OUT=ROOT/"contact-authors-hwp-180.json"
PHONE_RE=re.compile(r"(?:02|0[3-6][1-5]|01[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}")
ROLE_SUFFIX=r"(?:사무국장|정책국장|조직국장|사업국장|노안국장|본부장|위원장|국장|부장|팀장|실장|차장|간사)"
# Personal name + up to 8 org/department tokens + title, immediately before phone.
NAME_ROLE_RE=re.compile(r"([가-힣]{2,4})\s+(?:(?:[가-힣A-Za-z0-9·()]+)\s+){0,8}?[가-힣A-Za-z0-9·()]*"+ROLE_SUFFIX+r"\s*[\(\[]?\s*$")
DIRECT_RE=re.compile(r"(?:문의(?:\s*및\s*담당)?|담당|취재문의|보도문의)\s*[:：.#*·\-☛]*\s*(?:공공운수노조\s+|민주노총\s+|전국공공운수사회서비스노조\s+|전국철도노동조합\s+){0,2}([가-힣]{2,4})")
STOP={"공공기관","공공철도","미디어소","조직쟁의","정책기획","전국공공","공공운수","민주노총","전국철도","서울본부","관리자","문의사항","담당기자"}

docs=[]
for p in (ROOT/"text").glob("*.json"):
    d=json.loads(p.read_text(encoding="utf-8"))
    docs.extend(d.get("items",[]))

rows=[];counts=Counter()
for d in docs:
    t=d.get("text","")
    contacts=[];seen=set()
    for pm in PHONE_RE.finditer(t):
        pre=t[max(0,pm.start()-180):pm.start()]
        phone=re.sub(r"[.\s]+","-",pm.group())
        name=None
        # Try contact marker nearest the phone.
        marker=max(pre.rfind("문의"),pre.rfind("담당"))
        if marker>=0:
            seg=pre[marker:]
            m=DIRECT_RE.search(seg)
            if m:name=m.group(1)
        # Try name + org + role pattern nearest phone.
        if not name:
            m=NAME_ROLE_RE.search(pre)
            if m:name=m.group(1)
        if name in STOP:name=None
        if name:
            key=(name,phone)
            if key in seen:continue
            seen.add(key);counts[name]+=1
            contacts.append({"name":name,"phone":phone,"snippet":re.sub(r"\s+"," ",pre[-140:]+" "+pm.group()).strip()})
    rows.append({"idx":d["idx"],"date":d["date"],"kind":d["kind"],"title":d["title"],"contacts":contacts})

summary={"documents":len(rows),"with_named":sum(bool(x["contacts"]) for x in rows),"name_counts":counts.most_common()}
OUT.write_text(json.dumps({"summary":summary,"items":rows},ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps(summary,ensure_ascii=False))
for r in rows:
    if r["contacts"]:
        print(r["idx"],r["date"],r["kind"],[c["name"] for c in r["contacts"]],r["title"])

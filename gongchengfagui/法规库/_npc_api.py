#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Client for 国家法律法规数据库 (flk.npc.gov.cn) API."""
import json, urllib.request, urllib.parse, sys

BASE = "https://flk.npc.gov.cn"

def _post(path, data):
    req = urllib.request.Request(BASE + path,
        data=json.dumps(data, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json;charset=utf-8",
                 "User-Agent": "Mozilla/5.0",
                 "Referer": "https://flk.npc.gov.cn/"},
        method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))

def _get(path, params):
    url = BASE + path + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0","Referer":"https://flk.npc.gov.cn/"}, method="GET")
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="ignore")

def search(keyword, page=1, size=10):
    # condition-based payload
    data = {"conditions":[{"fieldName":"title","values":[keyword],"searchType":0}],
            "pageNum":page,"pageSize":size,
            "orderByParam":{"order":"DESC","sort":"gbrq"},
            "flfgCodeId":[],"zdjgCodeId":[]}
    return _post("/law-search/search/list", data)

if __name__ == "__main__":
    kw = sys.argv[1] if len(sys.argv) > 1 else "建筑法"
    res = search(kw)
    print(json.dumps(res, ensure_ascii=False, indent=2)[:2000])

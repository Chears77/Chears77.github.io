#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
校验法规库中所有 revise_date 的逻辑合理性，防止出现：
  1) revise_date 早于 publish_date（逻辑不可能：修订不能早于颁布）
  2) revise_date 为占位式日期 *年01月01日 / *年1月1日（录入占位错误）
  3) revise_date == effective_date（多半是把"施行日"误当"修订通过日"占位，需人工核实修订通过日）
  4) 标题无 修订/修正/修改 字样却有 revise_date（多数为"修改决定/修正案"，合法；仅提示供人工确认）

用法：python check_revise.py [法规库路径，默认 ../法规库 或 ./法规库]
"""
import os, re, sys, datetime

def norm(s):
    return (s or '').strip().strip('"').strip("'").strip()

def to_date(s):
    s = norm(s)
    if not s:
        return None
    d = re.sub(r'[^0-9]', '', s)
    if len(d) >= 8:
        try:
            return datetime.date(int(d[:4]), int(d[4:6]), int(d[6:8]))
        except Exception:
            return None
    return None

def collect(lib):
    out = []
    for root, _, files in os.walk(lib):
        for fn in files:
            if not fn.endswith('.md'):
                continue
            p = os.path.join(root, fn)
            t = open(p, encoding='utf-8').read()
            m = re.match(r'^---\r?\n.*?\r?\n---\r?\n', t, re.S)
            if not m:
                continue
            fm = {}
            for line in m.group(0).split('\n'):
                if ':' in line:
                    k, v = line.split(':', 1)
                    fm[k.strip()] = v.strip()
            out.append((fn, fm))
    return out

def main():
    lib = sys.argv[1] if len(sys.argv) > 1 else None
    if not lib:
        here = os.path.dirname(os.path.abspath(__file__))
        for cand in (os.path.join(here, '法规库'), os.path.join(here, '..', '法规库')):
            if os.path.isdir(cand):
                lib = cand
                break
    if not lib or not os.path.isdir(lib):
        print('未找到法规库目录')
        sys.exit(1)
    rows = collect(lib)
    err_early, err_place, warn_eq, note_no_rev = [], [], [], []
    for fn, fm in rows:
        rd = norm(fm.get('revise_date', ''))
        if not rd:
            continue
        pd = to_date(fm.get('publish_date', ''))
        ed = to_date(fm.get('effective_date', ''))
        rdate = to_date(rd)
        title = fm.get('title', '')
        # 1) 修订早于颁布（硬错误）
        if rdate and pd and rdate < pd:
            err_early.append((fn, rd, fm.get('publish_date', '')))
        # 2) 占位式 *-01-01 / *-1-1
        if re.search(r'(01-01|1-1)$', rd) or rd.endswith('0101'):
            err_place.append((fn, rd))
        # 3) 修订日 == 施行日（疑似占位）
        if rdate and ed and rdate == ed:
            warn_eq.append((fn, rd, fm.get('effective_date', '')))
        # 4) 标题无修订/修正/修改 字样
        if not any(k in title for k in ['修订', '修正', '修改']):
            note_no_rev.append((fn, rd, title[:40]))
    print('=== 法规库 revise_date 逻辑校验 ===')
    print('扫描文件（含 revise_date）:', len(err_early) + len(err_place) + len(warn_eq) + len(note_no_rev)
          if False else '（共 %d 个文件带 revise_date）' % (
          len(err_early) + len(err_place) + len(set([x[0] for x in warn_eq]))
          + len(set([x[0] for x in note_no_rev]))))
    print()
    print('【硬错误】修订早于颁布（必须修）:', len(err_early))
    for x in err_early:
        print('   ', x[0], '| revise=', x[1], '| publish=', x[2])
    print('【硬错误】占位式 *-01-01（必须修）:', len(err_place))
    for x in err_place:
        print('   ', x[0], '| revise=', x[1])
    print('【需核实】修订日==施行日（多为占位，应改为修订通过日）:', len(set([x[0] for x in warn_eq])))
    for x in warn_eq:
        print('   ', x[0], '| revise=', x[1], '| eff=', x[2])
    print('【供确认】标题无修订字样但有 revise_date（多数合法"修改决定"）:', len(set([x[0] for x in note_no_rev])))
    for x in note_no_rev:
        print('   ', x[0], '| revise=', x[1], '|', x[2])
    print()
    if not err_early and not err_place:
        print('>>> 无硬错误（修订早于颁布 / 占位日期 均为 0）')
    else:
        print('>>> 存在硬错误，需修正后再发布')

if __name__ == '__main__':
    main()

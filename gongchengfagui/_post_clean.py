# -*- coding: utf-8 -*-
"""收尾清洗：合并正文里残留的 CJK-CJK 单字间隔（PDF 换行/字距所致）。
不改变法律含义，仅删除两个汉字之间的横向空格；不触碰 FrontMatter。
"""
import re, sys

def main():
    p = sys.argv[1]
    t = open(p, encoding='utf-8').read()
    t = re.sub(r'(?<=[\u4e00-\u9fff])[ \t]+(?=[\u4e00-\u9fff])', '', t)
    # 同时合并中文标点(，。、；：)后的多余空格
    t = re.sub(r'(?<=[\u4e00-\u9fff\u3001\uff0c\u3002\uff1b\uff1a\u002c\u002e])[ \t]+(?=[\u4e00-\u9fff])', '', t)
    open(p, 'w', encoding='utf-8').write(t)
    print('cleaned', p)

if __name__ == '__main__':
    main()

# -*- coding: utf-8 -*-
"""HTML 来源预处理：在喂给 _fill_law.py 前，剔除脚本/样式/导航UI噪声，
避免这些噪声被当成条文前的"通过/公布信息"误入 preamble。
不改变法律条文内容。
"""
import re, sys

def prep(html_path):
    t = open(html_path, encoding='utf-8', errors='ignore').read()
    t = re.sub(r'<script.*?</script>', ' ', t, flags=re.S | re.I)
    t = re.sub(r'<style.*?</style>', ' ', t, flags=re.S | re.I)
    t = re.sub(r'<noscript.*?</noscript>', ' ', t, flags=re.S | re.I)
    # 常见栏目/工具条噪声
    t = re.sub(r'【\s*字号[：:][^】]*】', ' ', t)
    t = re.sub(r'分享到[：:][\s\S]*?收藏打印', ' ', t)
    t = re.sub(r'人大资料[\s\S]{0,80}?规章', ' ', t)
    t = re.sub(r'首页\s*>\s*', ' ', t)
    t = re.sub(r'function\s*\(\)\s*\{[^}]*\}', ' ', t)
    # 剔除"官方文书头"之前的全部栏目/导航噪声（人民政府令 / 人大常委会公告）
    t = re.sub(r'^[\s\S]*?(?=人民政府令|常务委员会公告|人大常委会公告)', '', t)
    # 中国政府网(gov.cn)等：合并被 <span> 拆开的"第X条"（如 第三十</span><span>条）
    t = re.sub(r'</span>\s*<span[^>]*>', '', t)
    # 中国政府网导航条：首页 | 简 | 繁 ... 视频下载 打印（标签可能夹在中间）
    t = re.sub(r'首页[\s\S]*?视频下载[\s\S]*?打印', ' ', t)
    # gov.cn "来源：XXX网站" 与栏目工具条
    t = re.sub(r'浙江省人民政府网站', ' ', t)
    t = re.sub(r'【\s*字体[：:][^】]*】', ' ', t)
    t = re.sub(r'来源：[^（\n]*', ' ', t)
    t = re.sub(r"'\s*/>", ' ', t)
    # 去掉 gov.cn 头部属性残片（自"人民政府令"到"自YYYY年M月D日起施行）"）
    t = re.sub(r'^[\s\S]*?自[0-9]{4}年[0-9]{1,2}月[0-9]{1,2}日起施行）', '', t)
    # 去掉 gov.cn 文末页脚（国家规章库 / 相关稿件链接 之后全是站点导航）
    t = re.sub(r'(国家规章库|相关稿件链接)[\s\S]*$', '', t)
    open(html_path, 'w', encoding='utf-8').write(t)
    print('prepped', html_path)

if __name__ == '__main__':
    prep(sys.argv[1])

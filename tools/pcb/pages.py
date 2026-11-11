#!/usr/bin/env python3
"""design.py 데이터로 docs/pcb/schematic.html, docs/pcb/pcb-floorplan.html 생성 (사전에 design.py 실행)."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
import design as d

HERE = os.path.dirname(__file__)
OUT = d.OUT
css = open(os.path.join(HERE, 'page.css'), encoding='utf-8').read()
enc = open(os.path.join(OUT, 'enclosure.svg'), encoding='utf-8').read()
sch = d.schematic_svg()
fp = d.floorplan_svg()
head = lambda t: f'<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{t}</title><style>{css}</style></head><body>'

legend = ''.join(f'<span class="k" style="background:{c}">{n}</span>' for n, c in [('GND', '#6b645a'), ('+3V3', '#B8860B'), ('+5V / VBUS_IN', '#D9402B'), ('+9V / VIN', '#C2410C'), ('I2C', '#E0662C'), ('리드·진동', '#6D5BD0'), ('버튼', '#2C8A47'), ('LED', '#D9402B'), ('NC', '#b0a99c')])
unused = [p[1] for p in d.P['U1']['pins'] if p[2] == 'NC' and p[1] != 'VBUS']

s_html = head('캐리어 PCB 회로도') + f'''
<h1>⚡ 캐리어 PCB 회로도 v0.2</h1>
<p class="sub">넷 라벨 방식(같은 이름의 라벨은 연결됨) · 데이터 원본 <code>tools/pcb/design.py</code> · ERC 0건 · 배치 겹침 0건</p>
<div style="max-width:1180px;margin:0 auto">
<div class="warn"><b>전원 설계 변경:</b> Nano ESP32 의 <code>VBUS</code> 는 USB 연결 시에만 5V 가 나오는 <b>출력 전용 핀</b>이라 외부 5V 를 넣을 수 없습니다. USB-C 5V 를 <b>MT3608 로 9V 승압(Vout=0.6×(1+100k/7.15k)=8.99V)</b> 해 <code>VIN</code>(허용 6~21V)으로 공급하고, <code>VBUS</code> 는 <b>NC</b> 입니다. 부스트 고장 시 보호용 TVS(SMAJ15A)를 VIN 에 둡니다.</div>
<div class="card"><div style="margin-bottom:8px">{legend}</div><div class="schw">{sch}</div></div>
<div class="note" style="margin:14px 0 0;max-width:none"><b>Nano 미사용 핀(NC):</b> {", ".join(unused)} — 확장 시 사용. <b>펌웨어 핀:</b> SDA=A4, SCL=A5, 진동=D2, 리드=D3, 버튼=D4~D6, LED=D7. <b>I2C 주소:</b> 케이블 프로브 0x44, 온보드 U3(선택) 0x45.</div>
</div></body></html>'''
open(os.path.join(OUT, 'schematic.html'), 'w', encoding='utf-8').write(s_html)

f_html = head('캐리어 PCB 배치도') + f'''
<h1>🔧 캐리어 PCB 배치도 v0.2 (50 × 70 mm)</h1>
<p class="sub">전 부품 배치 · 겹침/안테나/장착 구멍 검사 통과 · 개념 배치이며 KiCad 단계에서 확정</p>
<div class="wrap">
<div class="card"><h2>① 보드 배치 (위 = Nano USB-C 방향)</h2>{fp}
<div class="lg"><span>점선 = DNP(선택 부품)</span><span>빗금 = 안테나 금지(확인 필요)</span><span>✕ = VBUS 미연결</span></div></div>
<div style="display:grid;gap:18px;align-content:start">
<div class="card"><h2>② 사육장 센서 위치</h2>{enc}
<table><tr><th>#</th><th>센서</th><th>위치</th><th>커넥터</th></tr>
<tr><td>1</td><td>SHT31 방수 프로브</td><td>중단 높이, 분무 노즐 직사 회피</td><td>J2</td></tr>
<tr><td>2</td><td>리드 스위치 + 자석</td><td>문 래치 쪽 문틀 / 문</td><td>J3</td></tr>
<tr><td>3</td><td>진동 센서</td><td>측면 외벽(바닥 직접 접촉 금지)</td><td>J4</td></tr></table></div>
<div class="card"><h2>③ 확인 필요 항목</h2>
<table><tr><th>항목</th><th>영향</th></tr>
<tr><td>헤더 핀 순서·GPIO 번호</td><td>좌/우열 배정</td></tr>
<tr><td>안테나 위치·금지 구역 범위</td><td>배치</td></tr>
<tr><td>소켓 간격·모듈 외형</td><td>풋프린트</td></tr>
<tr><td>MT3608 외 승압 IC 대체 필요 시 OVP 내장품</td><td>전원 신뢰성</td></tr></table></div>
</div></div></body></html>'''
open(os.path.join(OUT, 'pcb-floorplan.html'), 'w', encoding='utf-8').write(f_html)
print('pages ok')

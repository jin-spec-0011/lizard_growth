#!/usr/bin/env python3
"""캐리어 PCB 설계 데이터 (회로도·부품·배치의 단일 원본).
사용법:
  python3 tools/pcb/design.py --check   # ERC + 배치 겹침 검사만
  python3 tools/pcb/design.py           # 검사 후 docs/pcb/ 에 bom.csv, netlist.csv, schematic.svg, floorplan.svg 생성
"""
import csv, math, os, sys
from collections import defaultdict

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'docs', 'pcb')
BOARD_W, BOARD_H = 50.0, 70.0

# ---------------------------------------------------------------- Nano 헤더
LEFT = ['D13', '3V3', 'B0', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'VBUS', 'B1', 'GND', 'VIN']
RIGHT = ['D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'GND', 'RST', 'D0', 'D1']
NANO_NETS = {  # 사용하는 핀만. 나머지는 NC
    ('L', '3V3'): '+3V3', ('L', 'A4'): 'SDA', ('L', 'A5'): 'SCL', ('L', 'VBUS'): 'NC', ('L', 'GND'): 'GND', ('L', 'VIN'): 'VIN',
    ('R', 'D7'): 'LED_D7', ('R', 'D6'): 'BTN3', ('R', 'D5'): 'BTN2', ('R', 'D4'): 'BTN1', ('R', 'D3'): 'REED', ('R', 'D2'): 'VIB', ('R', 'GND'): 'GND',
}
def nano_pins():
    pins = []
    for i, n in enumerate(LEFT):
        pins.append((f'L{i+1}', n, NANO_NETS.get(('L', n), 'NC'), 'L'))
    for i, n in enumerate(RIGHT):
        pins.append((f'R{i+1}', n, NANO_NETS.get(('R', n), 'NC'), 'R'))
    return pins

# ---------------------------------------------------------------- 부품
# ref: dict(value, fp, mpn, kind, asm, section, pins[(pin,name,net[,side])], note)
P = {}
def part(ref, value, fp, mpn, asm, section, pins, note='', kind=None):
    P[ref] = dict(ref=ref, value=value, fp=fp, mpn=mpn, asm=asm, section=section, pins=pins, note=note, kind=kind or ref.rstrip('0123456789'))

R0603, C0603 = 'R_0603', 'C_0603'
# --- 전원 입력
part('J1', 'USB-C 6P', 'USB_C_Receptacle_6P_SMD', 'USB Type-C 6P 전원 전용 리셉터클(VBUS/GND/CC1/CC2/SHIELD)', 'SMT', 'in',
     [('A4B9', 'VBUS', 'VBUS_IN'), ('A1B12', 'GND', 'GND'), ('CC1', 'CC1', 'CC1'), ('CC2', 'CC2', 'CC2'), ('SH', 'SHIELD', 'GND')])
part('R1', '5.1k', R0603, '5.1kΩ 1% 0603', 'SMT', 'in', [('1', '1', 'CC1'), ('2', '2', 'GND')], 'USB-C CC1 풀다운')
part('R2', '5.1k', R0603, '5.1kΩ 1% 0603', 'SMT', 'in', [('1', '1', 'CC2'), ('2', '2', 'GND')], 'USB-C CC2 풀다운')
part('F1', 'PTC 0.75A', 'F_1206', 'PTC 리셋 퓨즈 1206, 유지 0.75A, ≥6V (예: Bourns MF-NSMF075-2)', 'SMT', 'in', [('1', '1', 'VBUS_IN'), ('2', '2', '+5V_F')])
part('TVS1', 'SMAJ5.0A', 'D_SMA', 'TVS 5V 단방향 SMA (SMAJ5.0A)', 'SMT', 'in', [('K', 'K', '+5V_F'), ('A', 'A', 'GND')])
part('C1', '22uF/10V', 'C_0805', '22µF 10V X5R 0805', 'SMT', 'in', [('1', '1', '+5V_F'), ('2', '2', 'GND')], '부스트 입력')
part('C2', '100nF', C0603, '100nF 16V X7R 0603', 'SMT', 'in', [('1', '1', '+5V_F'), ('2', '2', 'GND')])
part('LED2', 'RED', 'LED_0603', 'LED 0603 적색', 'SMT', 'in', [('A', 'A', 'LED2_A'), ('K', 'K', 'GND')], '5V 전원 표시')
part('R18', '1k', R0603, '1kΩ 1% 0603', 'SMT', 'in', [('1', '1', '+5V_F'), ('2', '2', 'LED2_A')])
# --- 부스트 5V → 9V
part('U2', 'MT3608', 'SOT-23-6', 'MT3608 승압 컨버터 SOT-23-6 (Vref 0.6V)', 'SMT', 'boost',
     [('1', 'SW', 'SW'), ('2', 'GND', 'GND'), ('3', 'FB', 'FB'), ('4', 'EN', '+5V_F'), ('5', 'IN', '+5V_F'), ('6', 'NC', 'NC')])
part('L1', '22uH', 'L_4x4', '22µH 파워 인덕터, Isat ≥ 1.5A, 차폐형 4×4~5×5', 'SMT', 'boost', [('1', '1', '+5V_F'), ('2', '2', 'SW')])
part('D2', 'SS34', 'D_SMA', 'SS34 쇼트키 3A 40V SMA', 'SMT', 'boost', [('A', 'A', 'SW'), ('K', 'K', '+9V')])
part('R15', '100k 1%', R0603, '100kΩ 1% 0603', 'SMT', 'boost', [('1', '1', '+9V'), ('2', '2', 'FB')], 'Vout = 0.6×(1+100k/7.15k) ≈ 9.0V')
part('R16', '7.15k 1%', R0603, '7.15kΩ 1% 0603', 'SMT', 'boost', [('1', '1', 'FB'), ('2', '2', 'GND')])
part('C3', '22uF/25V', 'C_1206', '22µF 25V X5R 1206', 'SMT', 'boost', [('1', '1', '+9V'), ('2', '2', 'GND')], '출력 (DC 바이어스 손실 고려 2개)')
part('C4', '22uF/25V', 'C_1206', '22µF 25V X5R 1206', 'SMT', 'boost', [('1', '1', '+9V'), ('2', '2', 'GND')])
part('R17', '0R', R0603, '0Ω 0603 (VIN 분리 점퍼)', 'SMT', 'boost', [('1', '1', '+9V'), ('2', '2', 'VIN')], 'Nano VIN 연결. 필요 시 제거')
part('TVS2', 'SMAJ15A', 'D_SMA', 'TVS 15V 단방향 SMA (SMAJ15A)', 'SMT', 'boost', [('K', 'K', 'VIN'), ('A', 'A', 'GND')], '부스트 과전압 고장 시 Nano VIN(최대 21V) 보호')
# --- 센서 I/O
part('J2', 'JST-PH 4P', 'JST_S4B-PH-SM4', 'JST S4B-PH-SM4-TB (측면 SMD 4핀)', 'SMT', 'io', [('1', '3V3', '+3V3'), ('2', 'SDA', 'SDA_J'), ('3', 'SCL', 'SCL_J'), ('4', 'GND', 'GND')], 'SHT31 프로브')
part('U4', 'USBLC6-2SC6', 'SOT-23-6', 'USBLC6-2SC6 ESD 어레이', 'SMT', 'io',
     [('1', 'IO1', 'SDA_J'), ('6', 'IO1', 'SDA_J'), ('3', 'IO2', 'SCL_J'), ('4', 'IO2', 'SCL_J'), ('2', 'GND', 'GND'), ('5', 'VBUS', '+3V3')], 'I2C ESD')
part('R5', '33R', R0603, '33Ω 1% 0603', 'SMT', 'io', [('1', '1', 'SDA_J'), ('2', '2', 'SDA')])
part('R6', '33R', R0603, '33Ω 1% 0603', 'SMT', 'io', [('1', '1', 'SCL_J'), ('2', '2', 'SCL')])
part('R3', '4.7k', R0603, '4.7kΩ 1% 0603', 'SMT', 'io', [('1', '1', '+3V3'), ('2', '2', 'SDA')], 'I2C 풀업')
part('R4', '4.7k', R0603, '4.7kΩ 1% 0603', 'SMT', 'io', [('1', '1', '+3V3'), ('2', '2', 'SCL')])
part('C6', '100nF', C0603, '100nF 16V X7R 0603', 'SMT', 'io', [('1', '1', '+3V3'), ('2', '2', 'GND')], 'J2 전원 디커플링')
part('J3', 'JST-PH 2P', 'JST_S2B-PH-SM4', 'JST S2B-PH-SM4-TB (측면 SMD 2핀)', 'SMT', 'io', [('1', 'SIG', 'REED_J'), ('2', 'GND', 'GND')], '리드 스위치')
part('J4', 'JST-PH 3P', 'JST_S3B-PH-SM4', 'JST S3B-PH-SM4-TB (측면 SMD 3핀)', 'SMT', 'io', [('1', '3V3', '+3V3'), ('2', 'GND', 'GND'), ('3', 'SIG', 'VIB_J')], '진동 센서')
part('U5', 'USBLC6-2SC6', 'SOT-23-6', 'USBLC6-2SC6 ESD 어레이', 'SMT', 'io',
     [('1', 'IO1', 'REED_J'), ('6', 'IO1', 'REED_J'), ('3', 'IO2', 'VIB_J'), ('4', 'IO2', 'VIB_J'), ('2', 'GND', 'GND'), ('5', 'VBUS', '+3V3')], '리드·진동 ESD')
part('R7', '1k', R0603, '1kΩ 1% 0603', 'SMT', 'io', [('1', '1', 'REED_J'), ('2', '2', 'REED')])
part('R8', '1k', R0603, '1kΩ 1% 0603', 'SMT', 'io', [('1', '1', 'VIB_J'), ('2', '2', 'VIB')])
part('R9', '10k', R0603, '10kΩ 1% 0603', 'SMT', 'io', [('1', '1', '+3V3'), ('2', '2', 'REED')], '외부 풀업')
part('R10', '10k', R0603, '10kΩ 1% 0603', 'SMT', 'io', [('1', '1', '+3V3'), ('2', '2', 'VIB')], '외부 풀업')
part('C7', '100nF', C0603, '100nF 16V X7R 0603', 'SMT', 'io', [('1', '1', 'REED'), ('2', '2', 'GND')], '디바운스')
part('C8', '100nF', C0603, '100nF 16V X7R 0603', 'SMT', 'io', [('1', '1', 'VIB'), ('2', '2', 'GND')], '디바운스')
part('U3', 'SHT31-DIS-B', 'DFN-8_2.5x2.5', 'Sensirion SHT31-DIS-B (온보드 주변 온습도, 주소 0x45)', 'DNP', 'io',
     [('1', 'SDA', 'SDA'), ('2', 'ADDR', '+3V3'), ('3', 'ALERT', 'NC'), ('4', 'SCL', 'SCL'), ('5', 'nRESET', 'NC'), ('6', 'R', 'GND'), ('7', 'VSS', 'GND'), ('8', 'VDD', '+3V3')],
     '선택(DNP). 핀 배열은 데이터시트로 최종 확인')
part('C12', '100nF', C0603, '100nF 16V X7R 0603', 'DNP', 'io', [('1', '1', '+3V3'), ('2', '2', 'GND')], 'U3 디커플링')
# --- UI
for i, d in enumerate(['D4', 'D5', 'D6'], 1):
    part(f'SW{i}', 'TACT', 'SW_SMD_5.1x5.1', 'SMD 택타일 스위치 5.1×5.1 (예: TS-1187A-B-A-B)', 'SMT', 'ui', [('1', '1', f'BTN{i}'), ('2', '2', 'GND')], f'{d}')
    part(f'C{8+i}', '100nF', C0603, '100nF 16V X7R 0603', 'SMT', 'ui', [('1', '1', f'BTN{i}'), ('2', '2', 'GND')], '디바운스')
part('LED1', 'GREEN', 'LED_0603', 'LED 0603 녹색', 'SMT', 'ui', [('A', 'A', 'LED1_A'), ('K', 'K', 'GND')], '상태 LED (D7)')
part('R11', '330R', R0603, '330Ω 1% 0603', 'SMT', 'ui', [('1', '1', 'LED_D7'), ('2', '2', 'LED1_A')])
part('J6', 'JST-PH 2P', 'JST_S2B-PH-SM4', 'JST S2B-PH-SM4-TB (측면 SMD 2핀)', 'DNP', 'ui', [('1', 'A', 'EXT_A'), ('2', 'GND', 'GND')], '외부 LED(선택)')
part('R12', '330R', R0603, '330Ω 1% 0603', 'DNP', 'ui', [('1', '1', 'LED_D7'), ('2', '2', 'EXT_A')])
# --- Nano 소켓 + 테스트포인트 (회로도상 U1)
part('U1', 'Arduino Nano ESP32', 'Nano_2x15', 'Arduino Nano ESP32 (ABX00083) — 소켓에 장착', 'MODULE', 'nano', nano_pins(), '', kind='U')
part('SK1', '1x15 F 2.54', 'PinSocket_1x15_P2.54', '1×15 2.54mm 암 소켓, 높이 8.5mm (THT)', 'THT', 'nano', [], 'Nano 좌열', kind='SK')
part('SK2', '1x15 F 2.54', 'PinSocket_1x15_P2.54', '1×15 2.54mm 암 소켓, 높이 8.5mm (THT)', 'THT', 'nano', [], 'Nano 우열', kind='SK')
for i, (n, net) in enumerate([('5V_F', '+5V_F'), ('9V', '+9V'), ('3V3', '+3V3'), ('GND', 'GND')], 1):
    part(f'TP{i}', 'TP', 'TestPoint_D1.5', f'SMD 테스트 패드 Ø1.5 ({n})', 'PAD', 'nano', [('1', n, net)], '', kind='TP')

# ---------------------------------------------------------------- 배치 (x, y, w, h) mm, 좌상단 원점
PL = {
    'SK1': (16.11, 2.73, 2.54, 38.1), 'SK2': (31.35, 2.73, 2.54, 38.1),
    'J2': (0, 13, 5.5, 10), 'U4': (7.0, 13.0, 3.0, 3.0), 'R5': (7.0, 17.0, 2.2, 1.2), 'R6': (7.0, 19.0, 2.2, 1.2), 'C6': (7.0, 21.0, 2.2, 1.2),
    'R3': (9.8, 24.5, 1.2, 2.2), 'R4': (11.6, 24.5, 1.2, 2.2), 'U3': (11.0, 6.0, 3.0, 3.0), 'C12': (11.0, 9.8, 2.2, 1.2),
    'TVS2': (9.0, 35.0, 5.2, 2.7), 'R17': (9.0, 39.0, 2.2, 1.2),
    'J4': (44.5, 24.0, 5.5, 8.0), 'J3': (44.5, 35.0, 5.5, 6.0), 'U5': (38.0, 26.0, 3.0, 3.0),
    'R7': (37.0, 30.5, 2.2, 1.2), 'R8': (40.0, 30.5, 2.2, 1.2), 'R9': (36.0, 21.5, 1.2, 2.2), 'R10': (38.0, 21.5, 1.2, 2.2),
    'C7': (36.5, 33.5, 2.2, 1.2), 'C8': (40.0, 33.5, 2.2, 1.2),
    'J6': (44.5, 44.0, 5.5, 6.0), 'R12': (40.5, 45.5, 2.2, 1.2), 'LED1': (23.0, 44.5, 2.2, 1.2), 'R11': (26.2, 44.5, 2.2, 1.2),
    'SW1': (9.5, 49.0, 6.2, 6.2), 'SW2': (21.9, 49.0, 6.2, 6.2), 'SW3': (34.4, 49.0, 6.2, 6.2),
    'C9': (6.5, 51.0, 2.2, 1.2), 'C10': (18.7, 51.0, 2.2, 1.2), 'C11': (31.2, 51.0, 2.2, 1.2),
    'J1': (20.5, 62.5, 9.0, 7.5), 'R1': (30.2, 67.2, 2.2, 1.2), 'R2': (32.8, 67.2, 2.2, 1.2),
    'F1': (31.0, 65.0, 3.8, 1.8), 'TVS1': (31.0, 61.5, 5.2, 2.7), 'C1': (36.0, 65.0, 2.4, 1.5), 'C2': (38.8, 65.0, 2.2, 1.2),
    'LED2': (31.0, 58.5, 2.2, 1.2), 'R18': (33.6, 58.5, 2.2, 1.2),
    'L1': (8.0, 58.0, 4.5, 4.5), 'U2': (13.5, 58.5, 3.0, 3.0), 'D2': (8.0, 63.5, 5.2, 2.7), 'C3': (14.0, 63.0, 3.8, 1.8), 'C4': (14.0, 65.6, 3.8, 1.8),
    'R15': (17.5, 58.0, 1.2, 2.2), 'R16': (19.2, 58.0, 1.2, 2.2),
    'TP1': (44.0, 53.0, 1.6, 1.6), 'TP2': (44.0, 55.5, 1.6, 1.6), 'TP3': (44.0, 58.0, 1.6, 1.6), 'TP4': (44.0, 60.5, 1.6, 1.6),
}
FIDS = [(8.0, 1.2), (41.5, 1.2), (40.5, 67.6)]
HOLES = [(3.5, 3.5), (46.5, 3.5), (3.5, 66.5), (46.5, 66.5)]
NANO_BODY = (16.11, -1.0, 17.78, 43.2)
ANT_KEEP = (16.11, 33.8, 17.78, 8.4)

# ---------------------------------------------------------------- 검사
def erc():
    errs, warns = [], []
    nets = defaultdict(list)
    for r, p in P.items():
        seen = set()
        for pin in p['pins']:
            if pin[0] in seen: errs.append(f'{r}: 핀 {pin[0]} 중복')
            seen.add(pin[0])
            nets[pin[2]].append((r, pin[1]))
    for n, pins in nets.items():
        if n == 'NC': continue
        if len(pins) < 2: errs.append(f'넷 {n}: 연결 핀이 {len(pins)}개 ({pins})')
    for need in ['GND', '+3V3', '+5V_F', '+9V', 'VIN', 'SDA', 'SCL', 'REED', 'VIB', 'BTN1', 'BTN2', 'BTN3', 'LED_D7']:
        if need not in nets: errs.append(f'필수 넷 없음: {need}')
    if len(P['U1']['pins']) != 30: errs.append('Nano 핀 수 != 30')
    # 전원 규칙: VBUS(Nano) 는 반드시 NC
    for pin in P['U1']['pins']:
        if pin[1] == 'VBUS' and pin[2] != 'NC': errs.append('Nano VBUS 는 출력 전용 → NC 여야 함')
        if pin[1] == 'VIN' and pin[2] != 'VIN': errs.append('Nano VIN 연결 누락')
    # 부스트 출력 전압
    v = 0.6 * (1 + 100e3 / 7.15e3)
    if not (8.5 <= v <= 9.5): errs.append(f'부스트 출력 {v:.2f}V 가 9V 목표에서 벗어남')
    # 선택 부품 표기
    for r in ['U3', 'C12', 'J6', 'R12']:
        if P[r]['asm'] != 'DNP': errs.append(f'{r} 은 DNP 여야 함')
    # 배치 대상 누락
    for r, p in P.items():
        if p['asm'] in ('MODULE',): continue
        if r not in PL: errs.append(f'배치 누락: {r}')
    return errs, warns, nets, v

def rect_overlap(a, b, m=0.0):
    return not (a[0] + a[2] + m <= b[0] or b[0] + b[2] + m <= a[0] or a[1] + a[3] + m <= b[1] or b[1] + b[3] + m <= a[1])

def placement_check():
    errs = []
    items = list(PL.items())
    for r, b in items:
        if r.startswith('SK'): continue
        if b[0] < -0.01 or b[1] < -0.01 or b[0] + b[2] > BOARD_W + 0.01 or b[1] + b[3] > BOARD_H + 0.01:
            errs.append(f'{r}: 보드 밖')
        if rect_overlap(b, NANO_BODY): errs.append(f'{r}: Nano 모듈 아래/겹침')
        if rect_overlap(b, ANT_KEEP): errs.append(f'{r}: 안테나 금지 구역')
        for hx, hy in HOLES:
            if rect_overlap(b, (hx - 3, hy - 3, 6, 6)): errs.append(f'{r}: 장착 구멍 간섭 ({hx},{hy})')
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            (ra, ba), (rb, bb) = items[i], items[j]
            if ra.startswith('SK') and rb.startswith('SK'): continue
            if rect_overlap(ba, bb, 0.2): errs.append(f'{ra} ↔ {rb}: 겹침/간격 0.2mm 미만')
    for fx, fy in FIDS:
        fb = (fx, fy, 1.6, 1.6)
        for r, b in items:
            if rect_overlap(fb, b, 0.5): errs.append(f'피듀셜({fx},{fy}) ↔ {r}')
        for hx, hy in HOLES:
            if rect_overlap(fb, (hx - 3, hy - 3, 6, 6)): errs.append(f'피듀셜({fx},{fy}) ↔ 구멍')
    return errs

# ---------------------------------------------------------------- 출력: BOM / 넷리스트
def write_bom():
    groups = defaultdict(list)
    for r, p in P.items():
        if p['asm'] == 'MODULE': continue
        groups[(p['value'], p['fp'], p['mpn'], p['asm'])].append(r)
    def key(k): return (k[3] == 'DNP', k[3] == 'PAD', sorted(k[2]) and k[1])
    rows = []
    for (value, fp, mpn, asm), refs in sorted(groups.items(), key=lambda kv: (kv[0][3] != 'SMT', kv[0][3], kv[0][1], kv[0][0])):
        refs = sorted(refs, key=lambda x: (x.rstrip('0123456789'), int(''.join(c for c in x if c.isdigit()) or 0)))
        note = '; '.join(sorted({P[r]['note'] for r in refs if P[r]['note']}))
        rows.append([value, ','.join(refs), fp, len(refs), mpn, asm, note, ''])
    with open(os.path.join(OUT, 'bom.csv'), 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(['Value', 'Designator', 'Footprint', 'Qty', '사양/MPN', 'Assembly', 'Note', 'JLCPCB/LCSC Part # (주문 시 확인)'])
        w.writerows(rows)
    return rows

def write_netlist(nets):
    with open(os.path.join(OUT, 'netlist.csv'), 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(['Net', 'Ref', 'Pin', 'PinName'])
        for n in sorted(nets):
            for r, nm in nets[n]:
                pin = next(x[0] for x in P[r]['pins'] if x[1] == nm and x[2] == n)
                w.writerow([n, r, pin, nm])

# ---------------------------------------------------------------- 출력: 회로도 SVG (넷 라벨 방식)
def net_color(n):
    if n == 'GND': return '#6b645a'
    if n in ('NC',): return '#b0a99c'
    if n in ('+3V3',): return '#B8860B'
    if n in ('+5V_F', 'VBUS_IN', 'LED2_A'): return '#D9402B'
    if n in ('+9V', 'VIN', 'SW', 'FB'): return '#C2410C'
    if n.startswith('SDA') or n.startswith('SCL'): return '#E0662C'
    if n.startswith('REED') or n.startswith('VIB'): return '#6D5BD0'
    if n.startswith('BTN'): return '#2C8A47'
    if n.startswith('LED') or n.startswith('EXT'): return '#D9402B'
    return '#2563EB'

def esc(s): return str(s).replace('&', '&amp;').replace('<', '&lt;')

def schematic_svg():
    sections = [('in', '① USB-C 5V 입력 · 보호'), ('boost', '② 5V→9V 승압 (Nano VIN)'), ('nano', '③ Arduino Nano ESP32'), ('io', '④ 센서 입력'), ('ui', '⑤ 버튼 · LED')]
    colx = {'in': 10, 'boost': 330, 'nano': 650, 'io': 1010, 'ui': 1330}
    BW, PIT, LAB = 150, 15, 78
    out = []
    ymax = 0
    for sec, title in sections:
        x0 = colx[sec]
        out.append(f'<text x="{x0}" y="22" class="sec">{esc(title)}</text>')
        y = 40
        for r, p in P.items():
            if p['section'] != sec or p['kind'] == 'SK': continue
            pins = p['pins']
            sided = [pn if len(pn) == 4 else pn + ('',) for pn in pins]
            if sided and sided[0][3]:
                L = [s for s in sided if s[3] == 'L']; R = [s for s in sided if s[3] == 'R']
            else:
                half = math.ceil(len(sided) / 2)
                L, R = sided[:half], sided[half:]
            if len(sided) == 1: L, R = sided, []
            rows = max(len(L), len(R), 1)
            h = rows * PIT + 26
            bx = x0 + LAB
            dnp = p['asm'] == 'DNP'
            out.append(f'<rect x="{bx}" y="{y}" width="{BW}" height="{h}" rx="3" class="box{" dnp" if dnp else ""}"/>')
            out.append(f'<text x="{bx+6}" y="{y+11}" class="ref">{r}</text><text x="{bx+BW-6}" y="{y+11}" class="val" text-anchor="end">{esc(p["value"])}{" (DNP)" if dnp else ""}</text>')
            for side, lst in (('L', L), ('R', R)):
                for i, (pin, name, net, _) in enumerate(lst):
                    py = y + 22 + i * PIT
                    if side == 'L':
                        out.append(f'<line x1="{bx-14}" y1="{py}" x2="{bx}" y2="{py}" stroke="{net_color(net)}" class="wire"/>')
                        out.append(f'<text x="{bx+4}" y="{py+3.5}" class="pin">{esc(name)}</text>')
                        out.append(f'<text x="{bx-17}" y="{py+3.5}" class="net" text-anchor="end" fill="{net_color(net)}">{esc(net)}</text>')
                    else:
                        out.append(f'<line x1="{bx+BW}" y1="{py}" x2="{bx+BW+14}" y2="{py}" stroke="{net_color(net)}" class="wire"/>')
                        out.append(f'<text x="{bx+BW-4}" y="{py+3.5}" class="pin" text-anchor="end">{esc(name)}</text>')
                        out.append(f'<text x="{bx+BW+17}" y="{py+3.5}" class="net" fill="{net_color(net)}">{esc(net)}</text>')
            y += h + 10
        ymax = max(ymax, y)
    w, hgt = 1700, ymax + 10
    head = f'<svg viewBox="0 0 {w} {hgt}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="캐리어 PCB 회로도" class="sch">'
    return head + ''.join(out) + '</svg>'

def floorplan_svg():
    o = ['<svg viewBox="-8 -5 66 82" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="50x70mm 캐리어 PCB 배치도" class="board">',
         '<defs><pattern id="hatch" width="1.2" height="1.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="1.2" stroke="#D9402B" stroke-width="0.35"/></pattern></defs>',
         f'<rect x="0" y="0" width="{BOARD_W}" height="{BOARD_H}" rx="2" class="pcb"/>']
    for x, y in HOLES:
        o.append(f'<circle cx="{x}" cy="{y}" r="3" class="keep"/><circle cx="{x}" cy="{y}" r="1.6" class="hole"/>')
    o.append(f'<rect x="{NANO_BODY[0]}" y="{NANO_BODY[1]}" width="{NANO_BODY[2]}" height="{NANO_BODY[3]}" rx="1" class="nano"/>')
    o.append('<rect x="21.9" y="-1" width="8.2" height="3.4" rx="0.5" class="usb"/><text x="26" y="1.2" class="t s c">USB-C</text>')
    o.append(f'<rect x="{ANT_KEEP[0]}" y="{ANT_KEEP[1]}" width="{ANT_KEEP[2]}" height="{ANT_KEEP[3]}" fill="url(#hatch)" opacity=".55"/><text x="25" y="38.2" class="t s c red">안테나 금지(확인)</text>')
    names = {}
    for i, n in enumerate(LEFT): names[('L', i)] = n
    for i, n in enumerate(RIGHT): names[('R', i)] = n
    used = {'A4': '#E0662C', 'A5': '#E0662C', 'D2': '#6D5BD0', 'D3': '#6D5BD0', 'D4': '#2C8A47', 'D5': '#2C8A47', 'D6': '#2C8A47', 'D7': '#D9402B', '3V3': '#B8860B', 'VIN': '#C2410C', 'GND': '#555'}
    for (side, i), n in names.items():
        x = 17.38 if side == 'L' else 32.62
        y = 4.0 + 2.54 * i
        c = '#8a8275' if n == 'VBUS' else used.get(n, '#8a8275')
        o.append(f'<circle cx="{x}" cy="{y:.2f}" r="0.62" fill="{c}"/>')
        tx = x + 1.1 if side == 'L' else x - 1.1
        o.append(f'<text x="{tx}" y="{y+0.45:.2f}" class="t p{" e" if side=="R" else ""}" fill="{c}">{n}{"✕" if n=="VBUS" else ""}</text>')
    cls = {'J': 'conn', 'S': 'btn', 'U': 'ic', 'L': 'part', 'T': 'part', 'D': 'part', 'F': 'part'}
    for r, (x, y, w, h) in PL.items():
        if r.startswith('SK'): continue
        p = P[r]
        c = 'conn' if r.startswith('J') else 'btn' if r.startswith('SW') else 'tp' if r.startswith('TP') else 'part'
        if p['asm'] == 'DNP': c += ' dnpb'
        o.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="0.3" class="{c}"/>')
        fs = 1.5 if max(w, h) >= 4 else 0.95
        if w >= h: o.append(f'<text x="{x+w/2}" y="{y+h/2+fs*0.35}" class="t c lbl{"d" if c.startswith(("conn","btn")) else ""}" style="font-size:{fs}px">{r}</text>')
        else: o.append(f'<text x="{x+w/2}" y="{y+h/2+fs*0.35}" class="t c lbl" style="font-size:{fs*0.8}px" transform="rotate(-90 {x+w/2} {y+h/2})">{r}</text>')
    for fx, fy in FIDS: o.append(f'<circle cx="{fx+0.8}" cy="{fy+0.8}" r="0.5" fill="#D9A441"/>')
    o.append('<line x1="0" y1="-3" x2="50" y2="-3" class="dim"/><text x="25" y="-3.6" class="t s c dimt">50 mm</text><line x1="53.5" y1="0" x2="53.5" y2="70" class="dim"/><text x="55" y="35" class="t s dimt" transform="rotate(90 55 35)">70 mm</text>')
    o.append('</svg>')
    return '\n'.join(o)

def main():
    errs, warns, nets, vout = erc()
    perrs = placement_check()
    print(f'부품 {len(P)}개(모듈 포함), 넷 {len([n for n in nets if n != "NC"])}개, 부스트 출력 {vout:.2f} V')
    for e in errs + perrs: print('ERROR:', e)
    if errs or perrs:
        print(f'검사 실패: ERC {len(errs)}건, 배치 {len(perrs)}건'); sys.exit(1)
    print('검사 통과: ERC 0건, 배치 겹침 0건')
    if '--check' in sys.argv: return
    os.makedirs(OUT, exist_ok=True)
    rows = write_bom(); write_netlist(nets)
    open(os.path.join(OUT, 'schematic.svg'), 'w', encoding='utf-8').write(schematic_svg())
    open(os.path.join(OUT, 'floorplan.svg'), 'w', encoding='utf-8').write(floorplan_svg())
    smt = sum(1 for p in P.values() if p['asm'] == 'SMT'); dnp = [r for r, p in P.items() if p['asm'] == 'DNP']
    print(f'BOM {len(rows)}행 / SMT {smt}점 / THT 2점(소켓) / DNP {dnp}')
if __name__ == '__main__':
    main()

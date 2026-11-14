# 구매 리스트 · PCB 제작/조립 업체 선정 (2026-11 조사)

> 가격·재고·수수료는 수시로 바뀝니다. 아래 수치는 조사 시점 검색 결과이며 **주문 전 각 견적 화면에서 재확인**하세요.
> 배선·Gerber 는 아직 없으므로(`PCB_SPEC.md` §6 B 단계) 지금은 **계획 단계**입니다.

## 1. 업체 선정

| 기준 | **JLCPCB (1순위)** | PCBWay (대안) | 국내: 디바이스마트 PCB + 실장 업체 |
|---|---|---|---|
| 제작 + 조립 한 곳 | 가능 | 가능 | 제작과 실장 업체가 분리될 수 있음 |
| THT(Nano 소켓) 조립 | 가능 — 공식 능력표에 [SMT, THT, 혼합 조립](https://www.jlcpcb.com/capabilities/smt-assembly), [LCSC FAQ](https://www.lcsc.com/faqs/pcba/pcba-support-tht-assembly)에 THT 지원 명시 | 가능 — [조립 페이지](https://www.pcbway.com/pcb-assembly.html)에 Through-Hole/Mixed 명시 | 업체별 확인 필요 |
| 부품 조달 | LCSC 라이브러리(값·패키지 일치 시 자동 매칭) | Turnkey(업체 조달)/Kitted/Combo 선택, MPN 기준 | 업체·부품 구매 대행에 따라 다름 |
| 최소 수량 | 견적 화면 기준(미확인) | PCB 5장([참고](https://hackaday.io/project/166442)) | 디바이스마트 [샘플 PCB 최소 4장](https://www.devicemart.co.kr/goods/maker?custom=pcb) |
| 비용 확인 상태 | THT 수수료 두 가지 보고(아래) | 견적 필요 | 견적 필요 (SMT 단가 미확인) |
| 주요 위험 | 해외 배송·통관 | 해외 배송·통관, 가격 | 소량 SMT+THT 수용 여부 불명 |

**선정: JLCPCB 로 시제품 1차 주문.** 이유: (1) 이 보드의 핵심 조건인 THT 2점이 포함된 SMT+THT 혼합 조립을 공식 지원, (2) 부품 라이브러리로 BOM 매핑이 쉬움, (3) 소량 시제품 사례가 많음.
**대안:** JLCPCB 에서 특정 부품 재고가 없으면 PCBWay(Combo), 빠른 납기·통관 회피가 우선이면 국내 업체 견적(디바이스마트 PCB 제작 + 국내 실장 업체, 예: [엠피게이트](https://www.mpgate.co.kr/))을 비교하세요. 국내는 THT 포함 1장 단위 수용 여부와 가격을 조사로 확인하지 못했습니다.

### THT 비용 추정 (조사된 수수료로 계산, 확정 아님)
| 출처 | 수수료 | 소켓 2개 = 30접점 |
|---|---|---|
| [LCSC FAQ](https://www.lcsc.com/faqs/pcba/pcba-support-tht-assembly) 등 | 인건비 $3.50 + 접점당 $0.0173 | 약 $4.0 |
| JLCPCB 다른 페이지(2025-04 갱신) | $7.88 + 접점당 $0.0157 | 약 $8.4 |
SMT 기본료는 보고가 엇갈립니다($8 + 접점당 $0.0016 [JLCPCB 일본어 SMT 페이지] vs. 표준 PCBA 설정비 $25~50 [TechOverflow](https://techoverflow.net/2024/04/09/jlcpcb-pcba-assembly-price-overview/)). **견적 화면의 값이 기준입니다.**

## 2. 구매 리스트

### A. 보드 주문 (JLCPCB)
| 품목 | 수량 | 비고 |
|---|---|---|
| PCB 제작 | 5장 | 50×70 mm, 2층, 1.6 mm, HASL/ENIG |
| PCBA 조립 | 견적 최소 수량 | 상면 SMT 42점 + THT 소켓 2점, DNP 4점 제외 |
| 업로드 파일 | Gerber, BOM(`bom.csv`), CPL | KiCad 단계 이후 생성 |

### B. 보드에 꽂는 부품 (별도 구매)
| 품목 | 수량 | 구매처 후보 / 참고 |
|---|---|---|
| Arduino Nano ESP32 (ABX00083, 헤더 포함) | 2 (1 + 예비) | [RS Online 한국](https://kr.rs-online.com/web/p/arduino/2686962) 조사 시 ₩30,565, 재고 표시. 해외는 리드타임 4주 사례 → 재고 확인 |

### C. 사육장 센서부
| 품목 | 수량 | 사양 / 후보 | 비고 |
|---|---|---|---|
| SHT31 방수 프로브 | 1 | 후보 ① [DFRobot SHT31 weatherproof](https://www.digitec.ch/en/s1/product/dfrobot-sht31-weatherproof-temperature-and-humidity-sensor-single-board-computer-kits-24893177) $19.90 ② [스테인리스 I2C 프로브](https://www.fruugo.co.nz/soil-digital-temperature-humidity-sensor-probe-waterproof-stainless-steel-case-sht31/p-432988950) 약 150 cm 케이블, PTFE 여부 미표기 | 케이블 ≤ 1 m 권장(150 cm 는 시험 필요). 분무 환경이라 방수 + 멤브레인 확인. Dracal M8 프로브는 [미국·캐나다 한정](https://www.transcat.com/dracal-i2c-m8-trh320-p100-i2c-temp-and-humidity-probe) → 제외 |
| 리드 스위치 + 자석 | 1~2 | 유선 마그네틱 도어 센서(MC-38 계열, NO/NC 겸용) | 펌웨어에서 극성 설정. 양면테이프로 문틀 부착 |
| 진동 센서 | 2 | SW-18010P(2단자 볼 스위치) 또는 SW-420 모듈(3V3 구동) | 모듈은 반드시 3.3V 구동 |
| JST-PH 케이블 | 4P/2P/3P 각 2 | PH 2.0mm [사전 압착 케이블](https://www.farnell.com/cad/4768142.pdf)(SPH-002T-P0.5S, AWG 24~30) | 센서 선과 연결은 납땜/커넥터 필요(보드 외 수작업 구간) |
| 전원 | 1 | USB-C 5V ≥ 1A 어댑터 + USB-C 케이블(PD 어댑터도 5V 로 동작) | 보드 USB-C 는 전원 전용 |

### D. 설치·보호
| 품목 | 수량 | 비고 |
|---|---|---|
| M3 스탠드오프(10 mm 내외) + 나사/너트 | 4세트 | 보드 장착 구멍 Ø3.2 |
| 케이블 클립/타이 | 1세트 | 사육장 입구에 **드립 루프** |
| 열수축 튜브 | 1세트 | 센서 선 연결부 |
| 컨포멀 코팅 스프레이 | 선택 | 커넥터·버튼·USB-C 마스킹 후 도포 |
| 멀티미터 | 보유 가정 | 최초 전원 전 TP2 = 8.5~9.5V 확인 |

### E. 예비 부품 (선택)
| 품목 | 수량 | 이유 |
|---|---|---|
| PTC 0.75A (F1), TVS 5V / 15V | 각 2 | 시제품 시험 중 보호부 교체 |
| MT3608 | 2 | 승압 IC 교체 |
| JST S4B/S3B/S2B-PH-SM4 | 각 2 | 커넥터 박리 시 |

## 3. 주문 순서

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | 회로도·BOM·배치 승인 | 진행 중 |
| 2 | KiCad 배선 + DRC → Gerber/BOM/CPL | **미착수** |
| 3 | JLCPCB 견적: BOM 업로드 → 재고/대체 부품 확인 → THT·DNP 설정 → 시제품 주문 | 2 이후 |
| 4 | 센서부·Nano·케이블 구매(PCB 도착 전) | 병행 가능 |
| 5 | 도착 후 TP2 전압 확인 → Nano 장착 → Wi-Fi/I2C 시험 | |

## 4. 실패 방지 체크리스트

1. **견적 단계에서 소켓(THT)이 "수작업/웨이브" 항목으로 잡히는지, DNP 4점(U3, C12, J6, R12)이 제외되는지 확인하세요.**
2. **BOM 부품이 대체 부품으로 바뀌면 값·패키지·정격(25V 커패시터, 0.75A PTC, 승압 인덕터 포화전류)을 다시 확인하세요.** 승압 회로는 부품 편차에 민감합니다.
3. **센서 프로브는 케이블 길이와 방수 등급을 받기 전에 사양으로 확인하세요.** 길이가 1 m 를 넘으면 I2C 가 불안정할 수 있습니다.

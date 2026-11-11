# 🦎 도마뱀 성장·급여 일지

체중·급여·온습도를 기록하면 일령, 체중 변화량, 권장 급여량, 다음 급여일이 자동 계산되는 개인용 웹앱입니다.
iPhone 홈 화면에 설치(PWA)해서 오프라인으로 쓰고, 원본 엑셀 템플릿과 같은 구조로 내보낼 수 있습니다.

- 체중·급여·메모 등 기록은 이 기기의 브라우저(IndexedDB)에만 저장되며 서버로 전송되지 않습니다.
- 분석·광고·CDN 없음 (CSP `default-src 'none'`, 라이브러리 자체 호스팅). 센서 연동(선택)을 켠 경우에만 Firebase 3개 호스트로 요청이 나갑니다.
- 계산 로직은 엑셀 `성장일지` 시트 수식과 동일 (LibreOffice 재계산 결과와 366행 전부 일치 확인).

## 사용

1. 설정 탭에서 출생일·급여율(기본 15%)·급여주기(기본 2일)·온습도 판정 기준을 입력합니다.
2. 중앙 **＋** 로 날짜·체중·급여(O/X/예정)·온습도·메모를 입력하면 저장 전에 일령/변화량/권장 급여량이 미리 계산됩니다.
3. 홈에서 **다음 급여일 + 권장량** 과 **현재 온습도 이모지** 를 한눈에 봅니다.
4. 일지 탭 → **엑셀 내보내기**. 같은 파일을 **가져오기** 하면 복원됩니다 (백업/기기 이전).

### 다음 급여일
마지막 `O` 날짜 + 급여주기. 오늘~미래에 `예정`이 있으면 그 날짜가 우선. 오늘 이미 급여했으면 "오늘 급여 완료"와 다음 날짜를 표시합니다.

### 온습도 이모지
온도·습도를 각각 판정(정상 😊 / 주의 / 위험)하고 더 나쁜 쪽을 대표 이모지로 표시합니다.
기본값은 일반 사육 가이드 수치(크레스티드 게코, 레오파드 게코 프리셋)이며 **개체·환경에 맞게 설정에서 조정**하세요.

## 센서 연동 (Firebase, 읽기 전용)

ESP32 센서가 Firebase Realtime Database `/sensor/latest` 에 올린 온습도를 앱이 읽어 홈·환경 화면에 이모지로 표시합니다.

- SDK/npm 없이 REST 로 연결합니다 (`js/cloud.js`): 로그인 → idToken(1시간) → 만료 전 refreshToken 으로 자동 갱신.
- 앱에는 **owner(읽기 전용) 계정**으로 로그인합니다. 비밀번호는 저장하지 않고 refreshToken 만 기기에 보관합니다.
- 설정값은 `js/config.js` (`apiKey`, `databaseURL` — 공개값). 비밀번호·토큰은 저장소에 넣지 않습니다.
- 서버 보호: `docs/firebase/database.rules.json` 템플릿의 `__OWNER_UID__` / `__DEVICE_UID__` 를 실제 UID 로 바꿔 Firebase 콘솔 → Realtime Database → 규칙에 게시합니다. (UID 가 들어간 파일은 `*.local.json` 으로 만들면 `.gitignore` 로 커밋이 막힙니다.)
- Google Cloud Console 에서 웹용 `apiKey` 는 HTTP 리퍼러(배포 도메인)와 API(`Identity Toolkit`, `Token Service`)로 제한하세요.
- 센서 값이 10분 넘게 갱신되지 않으면 "응답 없음"으로 표시하고 수동 기록값을 우선 사용합니다.

## 엑셀 호환

`assets/template.js` 는 원본 `lizard_growth_log.xlsx` 에서 입력값만 비운 템플릿(base64)입니다.
내보내기는 입력 셀(B2, B3, C·F·G 열)만 채우고 수식·서식·열 폭·조건부서식·데이터 유효성은 그대로 둡니다.
온습도는 두 번째 시트 `환경기록` 에 저장됩니다. 템플릿을 다시 만들려면:

```bash
node tools/build-template.cjs /path/to/lizard_growth_log.xlsx
```

## 배포 (GitHub Pages)

1. 저장소 **Settings → Pages → Source: GitHub Actions** 로 설정합니다.
2. `main` 브랜치에 푸시하면 `.github/workflows/pages.yml` 이 테스트 후 배포합니다.
3. iPhone Safari 에서 배포 URL 을 열고 **공유 → 홈 화면에 추가**. 설치한 앱으로 처음부터 사용하세요 (Safari 탭과 설치 앱은 저장소가 분리됩니다).

로컬 실행:

```bash
python3 -m http.server 8000   # http://localhost:8000
node --test tests/*.test.mjs  # 단위 테스트
```

## 구조

```
index.html · manifest.webmanifest · sw.js
css/app.css
js/calc.js     계산(엑셀 수식 동일) · 검증 · 상태 정화
js/env.js      온습도 판정
js/store.js    IndexedDB
js/cloud.js    Firebase REST (로그인·토큰 갱신·센서 읽기)
js/config.js   Firebase 공개 설정
js/export.js   엑셀 내보내기/가져오기 (ExcelJS 주입)
js/app.js      UI
vendor/        ExcelJS 4.4.0 (MIT, sha256 은 VENDOR.txt)
assets/        템플릿·아이콘
tools/         템플릿/아이콘 생성 스크립트
tests/         node:test
docs/          계획서·레이아웃 미리보기·Firebase 규칙 템플릿
```

## 보안 메모

- 모든 사용자 입력은 `textContent` 로만 렌더링 (innerHTML 미사용), 가져온 파일·저장소 데이터는 `sanitizeState` 로 재검증.
- 엑셀 메모는 문자열 셀로 기록되어 수식으로 실행되지 않습니다.
- 실제 일지 파일(`*.xlsx`, `*.csv`)은 `.gitignore` 로 커밋이 차단됩니다.
- CSP `connect-src` 는 `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`, 프로젝트 RTDB 호스트만 허용합니다. 다른 Firebase 프로젝트를 쓰려면 `index.html` 의 CSP 와 `js/config.js` 를 함께 수정하세요.
- 로드맵: Arduino Nano ESP32 라이브러리(MIT) → 캐리어 PCB.

## 라이선스

MIT (`LICENSE`). 번들된 ExcelJS 는 `vendor/EXCELJS-LICENSE.txt` 참고.

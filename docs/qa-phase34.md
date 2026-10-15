# Phase 3.4 — 실사용 통합 QA 결과

판정: **PASS**(실행해서 통과) / **FAIL** / **BLOCKED**(이 환경에서 실행 불가) / **NOT TESTED**(실행하지 않음).
검증 종류: **[모의]** 외부 서비스를 가짜 응답으로 대체 · **[실제 브라우저]** 실제 Chromium(Playwright) · **[실제 사전]** 실제 일본어 사전 사용 · **[실제 API]** 실제 외부 서비스.

## 1. 실제 발견한 버그와 원인 (수정함)
| # | 증상 | 원인 | 수정 |
|---|---|---|---|
| 1 | こんにちは/こんばんは → "콘니치하/콘반하" | 분석기 `reading`(ハ)을 그대로 사용. 소리는 ワ 인 인사말의 は | `pronunciation` 필드와 비교해 ハ→ワ·ヘ→エ·ヲ→オ 인 경우에만 발음 쪽을 채택 |
| 2 | 「今夜はブギー・バック」처럼 ・ 가 있으면 정상 줄이 "검토 필요" | `・`(U+30FB)를 가나로 판정해 "변환 안 된 글자"로 처리 | `isKana` 에서 ・ 제외, 읽기 검사에서 ・ 허용 |
| 3 | 一日中 → "츠이타치추우" | 숫자+단위 규칙이 1日 을 날짜(ついたち)로 읽음 | 1日 은 いちにち, 날짜 읽기(2日~)는 "읽기 확인"으로 표시 |
| 4 | ねぇ → "네" (장음 누락) | 같은 모음의 작은 글자(ぇ)를 모음 교체로 처리 | 같은 모음이면 길게 늘이는 소리로 처리 → 네에 |
| 5 | 「ありがとう」→ "「 아리가토오 」", 〜 앞 공백 | 괄호·기호가 단독 덩어리 | 여는 괄호는 다음 단어에, 그 밖의 기호는 앞 단어에 붙임 |
| 6 | 사전 18MB 첫 다운로드 동안 진행 표시 없음, 재방문 시 서버 캐시 헤더에만 의존 | 진행 콜백/캐시 없음 | 진행 문구(n/12) + Cache Storage 보관(재방문 네트워크 0건) |
| 7 | 후보 적용 버튼이 발음 생성 중에도 눌려 발음 없이 저장될 수 있음 | 로딩 중 비활성화 누락(3.3 테스트 중 재현) | 생성 중 비활성 + "발음 만드는 중..." |
| 8 | 밝은 테마에서 "현재 부분이 싱크 시작"/보정값 글씨가 연함 | amber-500 on 밝은 배경 | 밝은 배경이면 amber-700/800 |

## 2. 검증 결과
### 2-1. 실제 외부 서비스 — **BLOCKED**
- LRCLIB·MusicBrainz 는 이 샌드박스 프록시가 403 으로 차단(`CONNECT tunnel failed, response 403`). **실제 응답 검증을 했다고 말할 수 없음.**
- 대신 `tests/manual/real-api-check.ts`(자동 테스트에 포함되지 않음)를 추가: 인터넷이 되는 PC 에서 `npx tsx tests/manual/real-api-check.ts` 실행 → 앱이 쓰는 실제 provider·랭킹·발음 코드로 "너는 록을 듣지 않아 / 아이묭", "君はロックを聴かない / あいみょん", "…聞かない / Aimyon" 을 검색해 후보·일치 근거·앞 3줄 발음을 출력한다. 출력 그대로 알려 주면 실제 응답 기준으로 다시 점검할 수 있다.

### 2-2. 일본어 가사·발음
| 항목 | 판정 | 종류 |
|---|---|---|
| 한글 제목 → 일본어 원제 후보, 별칭, 聞/聴 변형, 같은 가수 다른 곡 구분, 자동 선택 방지 | PASS | [모의] 단위 + Playwright |
| 원문 미리보기, 자동 발음, 한자·조사·활용·장음 | PASS | [실제 사전] 단위 18 + [실제 브라우저] |
| 줄별 수정, 재생성, 수동 수정값 보호, 덮어쓰기 확인, 되돌리기 | PASS | [실제 브라우저]+모의 저장소 |
| 저장 후 새로고침 유지, 실패 줄은 원문만 저장 | PASS | [실제 브라우저] |
| 실제 LRCLIB/MusicBrainz 응답의 제목·아티스트 일치 | **BLOCKED** | — |
| 실제 가사 본문에서의 발음 정확도(곡 단위) | **NOT TESTED** | 저작권 가사 본문을 가져올 수 없음 → 위 스크립트로 PC 에서 확인 |

### 2-3. YouTube 재생·싱크 — 실제 YouTube **BLOCKED**
재생/일시정지/seek/버퍼링/종료/곡 전환/강조/원문+발음/±0.5/앵커/중복 누적 방지/새로고침 복원: **PASS [모의 플레이어 + 실제 브라우저]** (testSync32 38, testPhase33 A 섹션). 실제 YouTube IFrame 이벤트 타이밍(광고·버퍼링·배속 변경 시 오차)은 **NOT TESTED / 운영 확인 필요**.

### 2-4. OBS Overlay — 실제 OBS **NOT TESTED**
일반 Chromium 으로 Song/Lyrics/Queue Overlay, Overlay Studio 저장·복원·다른 브라우저 반영, 일시정지·seek·곡 변경 시 이전 가사 잔존 없음, 발음 옵션, 오래된 이벤트 무시: **PASS [실제 브라우저, 모의 Supabase/Realtime]** (testOverlay 50, testOverlaySettings 19, testObsQueue 19, testStudio 35, testSync32, server 모드 12/16). 실제 OBS CEF 환경, 실제 Supabase Realtime 재연결(네트워크 단절 실측)은 **BLOCKED/NOT TESTED**.

### 2-5. 신청 시스템
| 항목 | 판정 | 종류 |
|---|---|---|
| 비로그인 신청, 전체 곡 검색, 한글 IME, 중복 신청, 승인·거절, 순서 변경, 다음 곡 재생, OBS 대기열, 인증/권한 오류, Worker 에러 응답 형식 | PASS | [모의] 로컬 저장소 모드 32/32 + Worker 핸들러/모의 서버 모드 20/20, 단위·SQL(pglite) |
| 운영 Worker 의 `server_error` | **BLOCKED** | 실제 `reason`/로그 없음 → **원인을 추측해 수정하지 않았다** |

`server_error` 확인 방법: (1) 브라우저 개발자도구 → Network → `/api/song-requests` 응답 JSON 의 `reason` 값(예: `env_missing`, `rpc_function_missing_or_not_in_schema_cache`, `rpc_permission_denied`, `rpc_auth_rejected`, `rpc_schema_mismatch`, `rpc_db_error`, `rpc_not_json_404_wrong_url`). (2) Cloudflare 대시보드 → Workers → Logs(또는 `wrangler tail`)에서 `evt: "song_request_failure"` 로 찾으면 `stage`, `reason`, `status`, `pgCode` 가 한 줄 JSON 으로 남는다(키/URL 은 기록되지 않음). 재현: 비로그인 상태에서 신청 1건 제출 후 위 두 곳을 확인. 이 두 값을 알려 주면 그에 맞는 조치를 한다.

### 2-6. 성능·UX
| 항목 | 결과 | 종류 |
|---|---|---|
| 최초 사전 다운로드 | 12개 파일 200 OK, 합계 약 18MB. 로컬 서버 기준 400줄 포함 1.6초 | PASS [실제 브라우저] |
| 모바일 4G(9Mbps, 지연 170ms 에뮬레이션) | 최초 약 16.6초, 진행 문구 "(n/12) — 처음 한 번만 약 18MB" 표시 | PASS [에뮬레이션] (실기기/실망 NOT TESTED). 느린 3G 급(1.6Mbps)이면 이론상 약 90초 |
| 재방문 캐시 | 새로고침 후 사전 네트워크 요청 0건, Cache Storage 12개 | PASS |
| 다운로드 실패 후 재시도 | 일부 파일 실패 → 경고 + 한자 줄 "검토 필요"(가짜 발음 없음) → 재시도로 복구 | PASS |
| 긴 가사(400줄) | 최대 메인 스레드 정지 약 0.2초(헤드리스 데스크톱). 저사양 모바일은 수 배 가능 | PASS / 모바일 실측 NOT TESTED |
| 모바일 390px 레이아웃 | 가로 스크롤 없음 | PASS |
| 밝은/어두운 테마 | 앵커 버튼 대비 수정(위 #8). 기존 amber-500 경고 문구는 밝은 배경에서 연한 편(기존 디자인, 미변경) | PASS(수정) / 일부 개선 여지 |
| 로딩·오류·빈 상태 | 사전 로딩 문구, 실패 경고+다시 시도, API 연결 실패 안내 표시 확인 | PASS |

### 2-7. 빌드·테스트
`npx tsc -b` PASS · `npm run build` PASS(사전 12개 `dist/kuromoji-dict/` 포함, 실제 Chromium 에서 빌드 결과물로 로드 확인) · 단위 139/139 · 린트 19(기존과 동일) · Playwright 전 회귀(아래 표는 최종 보고).

## 3. 기존 기능 영향
DB/스키마/Auth/RLS/Repository/YouTube 로직 변경 없음. 가사 데이터 형식(`{발음}` 보조 줄) 유지. 신규 외부 유료 API 없음.

## 4. 배포 전 필수 확인
1. `npm install` (신규 의존성 `@patdx/kuromoji`) → `npm run build` 후 `dist/kuromoji-dict/` 12개 파일 존재 확인.
2. 운영 URL 에서 `/kuromoji-dict/base.dat.gz` 가 200 으로 내려오는지(Cloudflare Workers Assets 의 단일 파일 한도 25MiB, 최대 파일 5.9MB).
3. 실제 LRCLIB/MusicBrainz 검증 스크립트 실행, 실제 YouTube 로 앵커 싱크 1곡 확인, 실제 OBS 브라우저 소스 확인.
4. `server_error` 의 `reason` 확보.

## 5. 남은 문제와 우선순위
1. (높음) 운영 `server_error` — reason/로그 필요.
2. (중간) 실제 LRCLIB 응답 기반 점수·발음 검증(스크립트 제공).
3. (중간) 번역 제목 + 별칭 없는 곡에서 같은 가수의 다른 곡끼리 구분 불가(외래어 근거가 없을 때) — 설계상 한계.
4. (낮음) 모바일 저속망에서 18MB 최초 다운로드 — 진행 표시로만 완화.
5. (낮음) 모호한 한자(生·行 등)의 문맥별 읽기는 "읽기 확인"으로만 안내.

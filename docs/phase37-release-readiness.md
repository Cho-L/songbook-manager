# Phase 3.7 — 실사용 검증 및 출시 준비

핵심: **무엇을 실제로 확인했고, 무엇을 확인하지 못했는지.** (실제 = 실제 외부 서비스/브라우저, 모의 = 가짜 서버/가짜 플레이어)

## 1. 기능별 테스트 현황
| 기능 | 자동 테스트(모의) | 실제 외부 서비스 검증 |
|---|---|---|
| 노래책 / 검색 / 즐겨찾기 | 단위 searchAlias·listParams, PW testBrowse·testIme(IME)·testA | 해당 없음(자체 기능) |
| 플레이리스트 | PW testB·testC(모바일/이동) 등 일부, 이동 로직 미변경 | 해당 없음 |
| SongMode / ConcertMode | PW testA~F, testSync32, testLight34(수동 스크린샷) | YouTube 실제 재생 **BLOCKED** |
| YouTube / MR 재생 | 가짜 IFrame 플레이어(모의) | **BLOCKED** (실제 IFrame 불가) |
| LRCLIB / MusicBrainz 가사 검색 | 단위 lyrics-*(모의 provider), PW testLyrics31/Phase35 | **BLOCKED** (DNS 불가) |
| 다국어 제목·가수 검색 | 단위 lyrics-phase35, PW testPhase35 | **BLOCKED** |
| 아티스트별 곡 목록 | 단위/PW (모의 MB) | **BLOCKED** |
| 일본어 발음 | 단위 lyrics-phase33(실제 kuromoji 사전 사용 — 로컬 파일), PW testPhase33 | 사전 다운로드 네트워크는 모의 |
| 가사 싱크 / 앵커 / 보정값 | 단위 liveSync·warp-step, PW testSync32/testC | 실제 YouTube 시계 **BLOCKED** |
| 신청 / 승인 / 대기열 | 단위 songRequest*, PW testRequests·testPhase36, SQL(pglite) tests/sql | 실제 Supabase/Worker **NOT TESTED**(운영 금지) |
| OBS Overlay / Studio | 단위 overlay*·queueOverlay, PW testOverlay·testStudio·testObs* | 실제 OBS **BLOCKED** |
| Book Design / Preferences | PW testLight34(스크린샷), testPhase37(밝은/어두운 대비) | 해당 없음 |
| Import / Export | 신규 단위 backup-roundtrip(왕복 보존) — 이전에는 자동 테스트 없음 | — |
| 인증 / 접근 권한 | PW 에서 인증은 모의 처리(RequireOwner 우회), SQL 테스트 일부 | 실제 Supabase Auth/RLS **NOT TESTED** |

## 2. 이번 Phase 에서 확인된 실제 문제와 수정
1. **밝은 배경(밝은 테마)의 SongMode 에서 자동 가사 영역(상태 문구·후보·가수별 곡 찾기·발음 패널)이 거의 안 보임** — 영역이 부모의 기본(밝은) 글자색을 그대로 써서 흰 배경에 흰 글씨. 수정: 밝은 배경일 때만 어두운 글자색을 주는 래퍼(`SongModePage.tsx`). 어두운 배경은 그대로. 대비 실측 5.7:1 이상.
2. 실제 API 검증 스크립트가 요청 주소/상태/단계별 판정/"가사 없음 vs API 오류" 구분/User-Agent·요청 간격/결과 파일을 제공하지 않았음 → `tests/manual/real-api-check.ts` 개선, `npm run check:real-api`, `check:real-api:selftest` 추가.
3. Import/Export 가 자동 테스트 없이 방치 → 왕복(JSON/CSV) 보존 테스트 추가(로직 미변경).

그 밖의 항목(390px/1100px 가로 스크롤 10개 화면, 키보드 조작, 오류 안내)은 점검 결과 문제 없어 수정하지 않았다.

## 3. 실제 API 검증 결과
이 환경에서 `npm run check:real-api` 를 **실제로 실행**했다: 모든 요청이 `NETWORK_ERROR (ENOTFOUND)` — 외부 도메인 DNS 조회 불가 → **BLOCKED**. 우회하지 않았다. 6개 입력의 실제 응답은 확인하지 못했다. Windows 에서 실행하는 방법은 `docs/windows-real-test-guide.md`.
(모의 점검 모드 `--selftest` 는 스크립트 로직 확인용이며 실제 검증이 아니다.)

## 4. 배포 준비 상태
- 코드/빌드/자동 테스트: 통과 (아래 검증).
- 배포 차단 요인(확인 전까지 "배포 가능"이라 말할 수 없음):
  1. 실제 LRCLIB/MusicBrainz 결과 미확인 (사용자 PC 에서 `check:real-api`)
  2. 실제 YouTube 재생·싱크, 실제 OBS 장시간/재연결 미확인 (체크리스트)
  3. 실제 Supabase Auth/RLS·신청 서버(Worker) 조합 미확인(이번 Phase 에서 변경 없음, 이전 Phase 에서 해결된 server_error 는 재작업하지 않음)
- 배포 전 최종 체크리스트: 위 1~3 확인 → `npx tsc -b` / `npm run build` / 단위·PW 재실행 → 운영 Supabase·Cloudflare 반영은 별도 승인 후 사용자가 직접.

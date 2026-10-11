# 방송 기능 2~6단계 설계 및 변경안 (승인 전 — 아무것도 적용되지 않음)

> DB 스키마/RLS/Worker/Netlify Functions/package.json/환경변수 변경이 모두 필요하므로, 아래 변경안과 마이그레이션 계획을 먼저 보고하고 승인을 받은 뒤 진행합니다.
> 운영 DB·배포 환경은 건드리지 않았고, 이 문서의 SQL/코드는 적용되지 않은 제안입니다.

## 1. 단계 계획
| 단계 | 내용 | 승인 필요한 변경 |
|---|---|---|
| 1 | OBS 오버레이 개선 (**완료**) | 없음 (프런트만) |
| 2 | 통합 신청곡 큐: 테이블 + 관리자 큐 화면 + 오버레이 신청자 연동 | DB 스키마, RLS |
| 3 | 공개 웹 신청 페이지 | Worker 또는 Netlify Function(서버 경유 INSERT), 레이트리밋 |
| 4 | CHZZK 채팅 연동 (`!신청 / !대기열 / !취소`) | 서버 프로세스(토큰 보관), 환경변수(Client Secret) |
| 5 | SOOP 연동 | 공식 API 확인 전까지 보류 |
| 6 | 안정화·스팸/중복 방지·운영 점검 | - |

## 2. 통합 큐 데이터 모델 (제안)
`song_requests`
- `id uuid pk`, `book_id uuid`(노래책 owner), `song_id uuid null`(노래책 곡 매칭 시), `title text`, `artist text`(곡을 못 찾았을 때 원문 보관)
- `requester_name text`(표시명, 30자), `requester_key text`(중복·스팸 판단용 해시: 플랫폼 id 또는 IP 해시. 원문 IP 저장 금지)
- `source text` check in (`web`,`chzzk`,`soop`,`admin`), `platform_user_id text null`
- `status text` check in (`pending`,`approved`,`playing`,`done`,`rejected`,`canceled`)
- `position int`(관리자 정렬), `requested_at`, `approved_at`, `done_at`
- 인덱스: `(book_id, status, position)`, 중복 방지용 partial unique `(book_id, requester_key, song_id) where status in ('pending','approved')`
오버레이용 `LiveSong.requester` / `LiveQueueItem.requester`는 **1단계에서 이미 선택 필드로 추가·표시 지원** (발신 쪽만 2단계에서 연결).

## 3. RLS 초안 (적용 안 됨)
- 노래책 소유자/super_admin: `select/update/delete` 전부.
- 익명 사용자: **직접 INSERT 금지**. 공개 신청은 서버 함수가 service role로 INSERT (레이트리밋·길이·금칙어·중복 검증 후). 익명 SELECT는 `status in ('approved','playing')`의 `id,title,artist,requester_name`만 노출하는 view.
- 관리자 인증 토큰은 오버레이/공개 페이지에 절대 전달하지 않음 (오버레이는 기존처럼 추측 불가한 liveKey 채널만 사용).

## 4. 신청 흐름
1. 시청자: 웹/채팅 신청 → 서버 검증(길이, 레이트리밋, 중복, 차단 목록) → `pending`.
2. 관리자 큐 화면: 승인/거절/순서변경/재생 → `approved`/`playing`/`done`.
3. SongMode/ConcertMode가 현재 곡의 requester를 `LiveSong.requester`로 발행 → 오버레이 배너에 표시.
4. 채팅 명령: `!신청 곡제목 / 가수`(노래책 검색 후 매칭, 없으면 관리자 확인 대기), `!대기열`(상위 N곡 답장), `!취소`(본인 최근 pending만).

## 5. 플랫폼 조사 결과 (공식 문서 기준)
### CHZZK (공식 Open API, 확인함)
- 채팅 **수신**: Session API 사용. `GET /open/v1/sessions/auth`(유저 세션, 유저당 최대 3개) 또는 `/sessions/auth/client`(클라이언트 세션, 최대 10개)로 소켓 URL 발급 → Socket.IO 클라이언트(1.0.0~2.0.3)로 연결 → `connected`에서 `sessionKey` 수신 → `POST /events/subscribe/chat`. 세션당 이벤트 구독 최대 30개. 사용자 동의 철회/스코프 변경 시 `revoked` 수신.
- 인증: OAuth 인가 코드 흐름(`account-interlock` → `/auth/v1/token`), Access Token 1일 / Refresh Token 30일(1회용). **Client Secret과 토큰은 서버에만 보관**해야 함.
- 채팅 **전송**(`!대기열` 답장)은 Chat API의 채팅 전송으로 가능하나, 필요한 정확한 scope 목록·앱 심사 필요 여부·이용 약관 세부는 이번에 가져온 문서 범위에서 **확인하지 못함** → 승인 후 개발자센터에서 직접 확인 필요.
- 문서 자체가 "스펙·인증 흐름은 변경될 수 있음"이라고 명시.
- 비공식 라이브러리(chzzkpy 등)는 사용하지 않음.

### SOOP (**확인 못함**)
- 공식 개발자센터(developers.sooplive.co.kr) 첫 페이지는 열렸지만 API 목록/채팅 수신 API 정보를 가져오지 못했고(JS 렌더링 추정), 이후 조사 도구 사용 한도에 걸려 추가 확인도 못 했습니다.
- 따라서 **SOOP 공식 채팅 수신 API 존재 여부는 미확인**입니다. 검색에 나오는 것은 비공식 라이브러리/확장 프로그램뿐이며, 지시에 따라 비공식 수집은 구현하지 않습니다. 공식 API가 확인되지 않으면 SOOP은 "웹 신청 페이지 + 관리자 수동 입력"으로 대체하는 것을 권장합니다.

## 6. 인프라 변경안 (승인 필요)
1. **DB**: `song_requests` 테이블 + 인덱스 + RLS + 공개 view (마이그레이션 SQL은 `supabase/migrations/…` 로 별도 제출, 롤백 SQL 포함).
2. **서버 경유 신청 엔드포인트**: 현재 Worker는 YouTube 검색 프록시 전용 → 별도 라우트 추가 또는 Netlify Function 신설. 레이트리밋(IP 해시·분당 N회), 입력 검증.
3. **CHZZK 채팅 수신 서버**: 브라우저에서 Socket.IO를 직접 열면 Client Secret/토큰이 노출되므로 서버 상주 프로세스(예: Cloudflare Durable Object 또는 별도 소형 서버)가 필요. 상시 연결이므로 Worker 단독으로는 부적합할 수 있어 **인프라 선택(비용 포함)을 승인 요청**.
4. **환경변수**: `CHZZK_CLIENT_ID`, `CHZZK_CLIENT_SECRET`, 토큰 암호화 키 — 서버 전용(프런트 `VITE_*` 금지).
5. **package.json**: 서버 쪽 Socket.IO 클라이언트(1.x~2.0.3 호환 버전) 추가 가능성. 프런트 번들에는 넣지 않음.

## 7. 남은 위험
- 큐 상태 경쟁(관리자 두 명이 동시 조작) → `updated_at` 비교 후 조건부 UPDATE (MR 저장에서 쓴 방식 재사용).
- 채팅 스팸/도배 → 사용자별 쿨다운, 대기 중 최대 N건, 같은 곡 중복 차단.
- CHZZK 스펙 변경/토큰 만료 → 자동 refresh, 실패 시 관리자 화면 경고.
- SOOP 공식 경로 미확인.

# 2단계 신청곡(웹 접수 + 관리자 대기열) 운영 적용 절차

> 이 저장소의 코드는 **운영 DB/배포에 자동으로 적용되지 않습니다.** 아래 순서대로 직접 적용하세요.
> 적용 전에는 앱의 기존 기능이 그대로 동작하고, 신청곡 기능만 "서버가 설정되지 않았어요"로 안내됩니다.

## 0. 무엇이 추가되나
| 구분 | 변경 | 비고 |
|---|---|---|
| DB | `song_request_settings`, `song_requests` 테이블, RLS, RPC 2개 | **추가만**. 기존 테이블/정책 수정 없음 |
| Worker | `/api/song-requests` 라우트 1개 (`workers/worker.js` → `src/server/songRequestHandler.ts`) | 기존 YouTube 프록시/정적 서빙은 그대로 |
| Worker 비밀 환경변수 | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, (선택) `REQUEST_HASH_SALT` | 브라우저에는 절대 노출되지 않음 (`VITE_` 접두사 금지) |
| 프런트 | `/books/:id/request`(공개), `/books/:id/requests`(관리자) | `package.json` 변경 없음 |
| 새 유료 서버 | **없음** (기존 Supabase + Cloudflare Worker) | |

## 1. 사전 백업
Supabase 대시보드 → Database → Backups 에서 백업을 확인하거나 `pg_dump` 로 스키마를 받아 둡니다.

## 2. DB 적용 (Supabase → SQL Editor)
1. `supabase/migrations/20261011_song_requests.sql` 전체를 붙여넣고 실행. 여러 번 실행해도 안전합니다.
2. 확인 쿼리:
   ```sql
   select count(*) from public.song_requests;            -- 0
   select has_function_privilege('anon', 'public.submit_song_request(uuid,uuid,text,text)', 'execute');      -- false 여야 함
   select has_function_privilege('service_role', 'public.submit_song_request(uuid,uuid,text,text)', 'execute'); -- true
   select has_table_privilege('anon', 'public.song_requests', 'select');  -- false 여야 함
   ```
3. 문제가 생기면 `supabase/migrations/20261011_song_requests_rollback.sql` 실행 (신청곡 데이터만 삭제, songs 등은 영향 없음).

## 3. Worker 환경변수 (Cloudflare 대시보드 → Workers → Settings → Variables and Secrets, 또는 CLI)
```
wrangler secret put SUPABASE_URL                  # 예: https://xxxx.supabase.co  (VITE_SUPABASE_URL 과 같은 값)
wrangler secret put SUPABASE_SERVICE_ROLE_KEY     # Supabase → Project Settings → API → service_role (절대 공유/커밋 금지)
wrangler secret put REQUEST_HASH_SALT             # 임의의 긴 문자열(선택). 없으면 service role 키를 salt 로 사용
```
- service_role 키는 RLS 를 우회하는 키입니다. 이 키는 Worker 비밀 변수로만 두세요. `.env`, 프런트 코드, 로그에 넣지 마세요.
- 이 키가 유출되면 Supabase에서 키를 재발급(rotate)하고 Worker 비밀 변수도 교체하세요.

## 4. 배포
`npm run build` 후 평소처럼 Cloudflare 에 배포합니다. (Netlify 배포에는 이 API 가 없습니다 — Cloudflare Worker 배포에서만 시청자 신청이 동작합니다.)

## 5. 적용 후 확인 체크리스트
1. 관리자로 로그인 → 노래책 홈 → **신청곡 대기열** → "시청자 신청곡 받기" 체크 → **설정 저장**
2. 표시된 주소(`/books/<내 id>/request`)를 **로그아웃한 다른 브라우저/휴대폰**에서 열기
3. 이름 입력 → 곡 검색 → 신청 → "신청했어요!"
4. 관리자 화면에 새 신청이 보이는지, 승인/거절/순서 변경/재생/완료가 되는지
5. 같은 곡을 다시 신청하면 "이미 대기열에 있는 곡", 20초 안에 또 신청하면 "20초 뒤에" 안내가 나오는지
6. 접수를 끄면 시청자 화면에 "지금은 신청곡을 받지 않아요"가 나오는지
7. (선택) Cloudflare → Security → WAF → Rate limiting 에서 `/api/song-requests` 에 IP당 분당 N회 규칙을 추가하면 DB 앞단에서 한 번 더 막을 수 있습니다. 필수는 아닙니다.

## 6. 동작 방식 요약 (보안)
- 시청자 브라우저는 DB 에 직접 쓰지 못합니다 (anon 에게는 테이블 권한/정책/RPC 실행권이 없음).
- Worker 가 형식(UUID/길이/제어문자/크기 2KB), Origin(같은 사이트만), 허니팟을 검사하고, 신청자 식별 해시(SHA-256, IP 원본 미저장)를 만든 뒤 DB RPC 를 호출합니다.
- RPC 가 한 트랜잭션에서(노래책별 잠금) 접수 여부, 곡이 이 노래책 소속인지, 20초 쿨다운·시간당 10회, 같은 곡 중복, 1인 동시 한도(기본 2), 대기열 상한(기본 30)을 검사합니다.
- 관리자는 로그인 세션 + RLS(소유자/super_admin)로 자기 노래책의 신청만 읽고 수정합니다.

## 7. 알려진 한계
- 같은 공유기/모바일 데이터(NAT)를 쓰는 여러 시청자는 같은 IP 해시로 묶여 한도를 같이 쓸 수 있습니다 (1인 2곡·20초 간격).
- IP 해시는 기기를 바꾸거나 VPN을 쓰면 우회할 수 있습니다. 의도적 도배는 관리자 "접수 끄기"와 Cloudflare Rate limiting 으로 대응하세요.
- 관리자 화면은 5초마다 새로고침하는 방식입니다(실시간 구독 아님).
- 오버레이의 "신청자" 표시는 대기열의 **재생** 버튼으로 노래 부르기 화면을 연 곡에만 나옵니다 (플레이리스트로 연속 재생 중인 다음 곡의 신청자 표시는 3단계 이후 과제).


---

## 추가 (2단계 보강, 2026-10-12)

### SQL 적용 순서 (운영 DB — 직접 실행, 자동 적용 안 됨)
1. `supabase/migrations/20261011_song_requests.sql` (이미 적용했다면 건너뜀)
2. `supabase/migrations/20261012_request_queue_v2.sql` — 신청 대기 곡 공개(`pendingSongIds`, `songId`), `start_song_request`(재생 시작 원자화), "노래책당 재생 중 1곡" 인덱스
3. `supabase/migrations/20261012_song_aliases.sql` — 곡 별칭 컬럼 (별칭을 쓸 때만 필요)

각 파일은 여러 번 실행해도 안전합니다. 2번을 적용하기 전에도 앱은 동작합니다(신청 페이지는 제목+가수로 대기열 상태를 비교, 재생 시작은 예전 2단계 방식으로 대체).
롤백: 같은 이름 + `_rollback.sql`. 주의: `song_aliases` 롤백은 컬럼과 그 안의 별칭 데이터를 지웁니다.

### OBS 대기열 화면
- 주소: `https://<사이트>/overlay/queue?book=<노래책 id>` (관리자 → 신청곡 대기열 화면에서 옵션을 고르고 "주소 복사")
- OBS → 소스 추가 → 브라우저 → URL 붙여넣기. 너비/높이는 OBS 에서 조절 (예: 800×400). 배경은 투명.
- 로그인/키가 필요 없고, 읽는 데이터는 시청자 신청 페이지와 같은 공개 API 응답(승인/재생 중 곡의 제목·가수·신청자 표시명)뿐입니다.
- 갱신: 4초마다 조회. 같은 브라우저에서 관리자 화면이 열려 있으면 즉시. 연결이 끊기면 마지막 목록 유지 + 우상단 주황 점, 복구되면 자동 재동기화.
- 옵션: `n`(대기 곡 수 1~12) `fs`(글자 px) `al`(left/center/right) `bg`(배경 불투명도 0~100) `tc`/`ac`(글자/강조색, # 없이 6자리 hex) `req=0`(신청자 숨김) `head=0`(제목 줄 숨김)

### "신청 서버에 문제가 생겼어요" 진단
Worker 는 이제 실패를 분류해 (1) Cloudflare 로그 한 줄(`evt: song_request_failure`)과 (2) 응답 JSON 의 `reason` 으로 남깁니다. 키·URL·IP·요청 본문은 포함되지 않습니다.
브라우저 개발자도구 → Network → `song-requests` 응답의 `reason`, 또는 `wrangler tail` / 대시보드 Workers Logs 에서 확인하세요.

| reason | 의미 | 조치 |
|---|---|---|
| `env_missing` (503, not_configured) | SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 비어 있음 | Worker **런타임** 변수/시크릿 확인 (빌드 변수 아님) |
| `config_url_invalid` | SUPABASE_URL 형식 오류 | `https://<프로젝트>.supabase.co` 형태인지 |
| `rpc_function_missing_or_not_in_schema_cache` | `submit_song_request` 없음 | 20261011 SQL 미적용(또는 적용 후 스키마 캐시 갱신 대기) |
| `rpc_permission_denied` | service_role 에 실행 권한 없음 | SQL 의 마지막 `grant execute … to service_role` 실행 |
| `rpc_auth_rejected` | 키가 거부됨 (401/403) | service_role 키가 맞는지, 다른 프로젝트 키가 아닌지 |
| `rpc_not_json_404_wrong_url` | URL 이 Supabase REST 가 아님 | SUPABASE_URL 이 프로젝트 API URL 인지 |
| `rpc_schema_mismatch` | 함수/컬럼 불일치 | 마이그레이션이 일부만 적용됨 |
| `rpc_timeout` / `rpc_network` | DB 응답 없음 / 네트워크 | Supabase 프로젝트 일시중지·장애 여부 |
| `rpc_db_error` | DB 내부 오류 (5xx) | Supabase 로그 확인 |
| `rpc_unexpected_result` | 함수가 예상 밖 코드를 반환 | 함수 버전 확인 |

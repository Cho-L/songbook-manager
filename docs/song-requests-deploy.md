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

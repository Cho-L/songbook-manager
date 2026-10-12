# OBS Overlay Studio (Phase 3) — 적용/배포/사용 안내

> 이 문서의 SQL과 배포는 **직접** 진행하세요. 개발 과정에서 운영 Supabase / Cloudflare / GitHub 에는 아무것도 적용하지 않았습니다.

## 1. SQL 적용 순서 (운영 Supabase SQL Editor, 위에서 아래로)

| 순서 | 파일 | 내용 | 필수? |
|---|---|---|---|
| 0 | `supabase/schema.sql` | 기존 기본 스키마 (이미 적용돼 있음) | — |
| 1 | `migrations/20261011_song_requests.sql` | Phase 2: 신청곡 테이블/RLS/RPC | 신청 기능에 필수 |
| 2 | `migrations/20261012_request_queue_v2.sql` | Phase 2 보강: 신청 대기 상태 공개, 재생 시작 원자화, 재생 중 1곡 제약 | 권장 (없어도 동작) |
| 3 | `migrations/20261012_song_aliases.sql` | 곡 별칭 컬럼 | 별칭을 쓸 때만 |
| 4 | **`migrations/20261013_overlay_configs.sql`** | **Phase 3: Overlay Studio 설정 저장 + 공개 조회 RPC** | Studio 설정을 서버에 저장/다른 기기 OBS 에 쓰려면 |

- 각 파일은 재실행해도 안전합니다. 4번은 1~3번에 의존하지 않고 기본 스키마(`profiles`)만 필요합니다.
- **Phase 2 SQL 까지만 적용된 상태**: 앱은 정상 동작합니다. Studio 는 설정을 "이 브라우저"에만 저장하고 그 사실을 화면에 안내합니다. OBS 용으로는 Studio 의 **독립형 주소**(설정이 주소 안에 모두 들어 있음)를 쓰면 서버 저장 없이 어느 기기에서나 같은 모습입니다.
- **롤백**: `20261013_overlay_configs_rollback.sql` (저장된 Studio 설정만 삭제, 곡/신청 데이터 영향 없음). 이후 앱은 URL 설정/기본값으로 계속 동작합니다.

## 2. Cloudflare 배포

1. 새 환경변수/시크릿은 **없습니다.** 기존 Worker 런타임 변수 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`(시크릿)를 그대로 씁니다.
2. 이 프로젝트를 평소처럼 빌드·배포하면 `workers/worker.js` 가 `/api/overlay-config` 를 추가로 처리합니다.
3. 배포 후 확인 (모두 로그인 없이):
   - `https://<사이트>/api/overlay-config?book=<노래책 id>&kind=queue` → `{"config":null,"rev":0}` 또는 저장된 설정 JSON. (502 + `reason` 이 보이면 4번 SQL 미적용 / 권한 문제 — `docs/song-requests-deploy.md` 의 reason 표 참고)
   - Studio 에서 저장 → 같은 주소 응답의 `rev` 가 증가.
4. 서버 로그: 실패 시 `evt: overlay_config_failure` 한 줄 (키/URL/IP 없음).

## 3. OBS 설정 방법

관리자 홈 → **Overlay Studio** (또는 신청곡 대기열 화면의 "Overlay Studio 에서 꾸미기").
1. 탭에서 종류 선택: **현재 곡 / 가사 / 신청곡 대기열** (종류마다 따로 저장).
2. 스타일·글자·색·배경·테두리·반경·여백·표시 항목을 고르고 미리보기 확인 → **저장**.
3. "OBS 주소" 복사 → OBS → 소스 추가 → **브라우저** → URL 붙여넣기, 너비/높이는 화면에 표시된 권장 크기로.
4. 이후 Studio 에서 다시 저장하면 OBS 가 새로 열지 않아도 15초 안에(같은 브라우저면 즉시) 바뀝니다.

| 종류 | 주소 | 데이터 |
|---|---|---|
| 현재 곡 | `/overlay/song?book=<id>&cfg=1&lk=<방송키>` | 실시간 방송 채널(SongMode 가 보냄) |
| 가사 | `/overlay/lyrics?book=<id>&cfg=1&lk=<방송키>` | 실시간 방송 채널 (현재 가사 줄 + 싱크 여부) |
| 신청곡 대기열 | `/overlay/queue?book=<id>&cfg=1` | 공개 API 4초 폴링 |

- 현재 곡/가사의 **다른 브라우저(OBS ↔ 노래 부르는 Chrome) 동기화는 Supabase Realtime** 에 의존합니다(방송 키 `lk` 필요, 방송 오버레이 화면에서 연결 상태 확인). Realtime 이 막혀 있으면 같은 브라우저 안에서만 동작합니다 — 이 샌드박스에서는 Realtime 을 검증할 수 없어 **운영 확인 필요**.
- 기존 `/overlay?...`(11개 스타일 + 배너), `/overlay/queue?book=..&n=..`(Phase 2) 주소는 그대로 동작합니다. `cfg=1` 이 없으면 저장 설정을 읽지도 않습니다.

## 4. 운영 배포 체크리스트

- [ ] (선택) 별칭을 쓸 거면 SQL 3번
- [ ] Phase 2: SQL 1 → 2 적용 확인 (`select proname from pg_proc where proname in ('submit_song_request','get_public_request_queue','start_song_request');` → 3행)
- [ ] Phase 3: SQL 4 적용 후 `select to_regclass('public.overlay_configs');` → `overlay_configs`
- [ ] Cloudflare 배포 후 `/api/overlay-config?...` 200 확인
- [ ] Studio 에서 대기열 설정 저장 → 다른 기기/브라우저의 OBS(`cfg=1` 주소)가 15초 안에 바뀌는지
- [ ] 신청 → 승인 → OBS 대기열에 반영(최대 4초), 건너뛰기/취소/완료
- [ ] 현재 곡/가사: 노래 부르기 화면을 연 Chrome 과 OBS 가 다른 브라우저일 때 실시간 연결 상태(🟢)와 가사 줄 이동 확인
- [ ] OBS 에서 주소를 열었을 때 버튼/입력창 등 관리자 UI 가 전혀 안 보이는지

# Issue #7: 1단계 코드 감사·오프라인 회귀 계약

기준: `main` **6a9125d**, 조사일 2026-10-26. [이슈 #7](https://github.com/Cho-L/songbook-manager/issues/7).
지원 목표는 **CHZZK와 SOOP 두 플랫폼만**이다. 이번 변경은 문서와 테스트뿐이며 서비스 코드, API 응답, 인증, Worker/배포 설정, DB/마이그레이션, 의존성·lockfile을 변경하지 않는다.

## 1. 확인 범위와 상태 구분

**치지직 개발자 앱 등록과 채팅 조회·전송 권한 선택은 사용자가 완료했다. 송북매니저 실제 API 연동은 아직 적용하지 않았다.** 앱을 다시 만들 필요가 있다는 결론이 아니다. 앱의 권한 선택은 개별 방송자의 OAuth 동의·유효 토큰·활성 세션·배포 성공을 증명하지 않는다. 키/토큰/계정 정보/실제 앱 설정을 조회하지 않았다.

`구현됨`은 저장소 코드가 있다는 뜻이다. `설계만`과 테스트 모델은 서비스 기능이 아니다. `미적용`은 사용자 확인 또는 코드 부재에 근거하며, `운영 미검증`은 성공/실패 어느 쪽도 단정하지 않는다는 뜻이다.

| 대상 | 코드/설계 증거 | 구현 완료 범위 | 서비스 미적용/운영 상태 |
|---|---|---|---|
| CHZZK 앱 | 사용자 전제, 이슈 #7 | 앱 등록·권한 선택 완료(사용자 제공 사실) | 실제 서비스 연결 미적용. 토큰/심사/권한 유효성 미검증 |
| CHZZK 인증 | `docs/broadcast-stage2-6-design.md` §5 | OAuth 흐름 제안만 있음 | callback/토큰 저장·갱신·철회 코드 없음. Supabase `authService.ts`는 앱 관리자 인증이며 CHZZK 인증이 아님 |
| CHZZK 채팅 수신 | 같은 설계 §5~6 | Session/Socket.IO 연결 제안만 있음 | 세션 발급·구독·상주 수신·재연결·replay 처리 없음. package.json에도 Socket.IO 의존성 없음 |
| CHZZK 전송 | 같은 설계 §4~5 | `!대기열` 답장 구상 | 전송 API·채널별 제한·봇 자기응답 방지 구현 없음 |
| SOOP 공식 연결 | 같은 설계 §5 | 공식 경로 조사 보류 기록 | 인증/수신/전송 adapter 없음. 지원·권한·파트너 심사·비용·이용 조건 미확인. 실제 연결 보류 |
| 양 플랫폼 명령/취소 | 이번 `tests/fixtures/chatRequestModel.ts` | 테스트 전용 계약 모델만 추가 | src/Worker에서 import하지 않음. 플랫폼 연결·사용자 검증·실제 큐 취소 기능이 아님 |
| 웹 신청곡/관리자 큐 | `songRequestHandler.ts`, `songRequestRepository.ts`, `songRequest.ts`, `RequestQueuePage.tsx`, SQL 20261011/12 | 입력 제한, RPC 신청/조회, 관리자 승인·거절·순서·재생·취소/완료, 중복·쿨다운, 공개 큐 구현 | 운영 DB에 어느 마이그레이션이 적용됐는지는 조회하지 않음. 운영 Auth/RLS·큐 미검증 |
| 가사 검색 | `searchPlan.ts`, `pipeline.ts`, `providers/*`, `songAliases.ts` | 기존 별칭/가수·후보 점수/수동 선택/기본 사전/로마자 metadata 경로 구현 | 외부 LRCLIB/MusicBrainz 정확도·권리 검증은 수행하지 않음. 아래 결함 재현됨 |
| LRC/MR/OBS | `lrc.ts`, `warp.ts`, `lyricOffset.ts`, `liveClock.ts`, `useLivePublisher.ts` | 파싱/줄 정렬/영상별 자동 warp/수동 offset/재생 시계/오버레이 전송 구현 | 실제 YouTube·Supabase Realtime·OBS 브라우저 동기화 미검증 |

과거 `broadcast-stage2-6-design.md`의 “아무것도 적용되지 않음”, “Worker는 YouTube 전용”, “새 테이블 필요”는 당시 제안이다. 현재는 웹 큐 테이블·source 허용 값·웹 라우트가 존재한다. 이 문서대로 다시 만들지 않는다. 반대로 `RequestSource`의 `chzzk/soop` 값이나 DB 열 존재만으로 채팅이 연결됐다고 보지 않는다. 과거 싱크 문서의 offset 범위/폴링 간격도 현 코드와 다를 수 있으므로 이번 감사에서는 코드를 우선했다.

## 2. 공식 API 조사: 새 확인과 과거 주장을 구분

공개 문서만 조회했다. 로그인/OAuth/API endpoint/운영 서비스/계정은 호출하지 않았다.

| 공개 문서 조회 | 이번 결과 | 결론의 한계 |
|---|---|---|
| [CHZZK 공식 문서](https://chzzk.gitbook.io/chzzk), Session markdown 문서 | 403, 일부 CONNECT tunnel 403 | 최신 스펙을 읽지 못했다. 과거 설계의 숫자·경로를 최신 확인 완료로 인용하지 않음 |
| [CHZZK 개발자센터](https://developers.chzzk.naver.com/) | CONNECT tunnel 403 | 등록된 앱의 상태/심사/권한/redirect URI를 열거나 확인하지 않음 |
| [SOOP 개발자센터](https://developers.sooplive.co.kr/), 과거 공식 개발자센터 주소 `developers.afreecatv.com` | 403 / CONNECT tunnel 403 | 공식 채팅 수신·전송이 지원되는지, 대상 계정/권한/심사/한도/비용을 확인할 수 없음 |

403은 이 환경의 문서 접근 차단이다. 플랫폼 API가 폐지됐거나 앱 권한이 없거나 유료라는 증거가 아니다. 비공식 라이브러리·스크래핑·역공학·인증 우회는 사용하지 않았다.

### CHZZK: 과거 설계와 현재 코드의 차이

아래 API/숫자는 **과거 저장소 설계의 인용**이며 이번에 최신 공식 문서로 재확인하지 못했다. 구현 시 그대로 하드코딩하면 안 된다.

| 항목 | 과거 설계의 주장 | 현재 서비스 코드와 남은 확인 |
|---|---|---|
| 인증 | `account-interlock` → `/auth/v1/token`, access 1일 / refresh 30일·1회용 | CHZZK callback/state 검증·토큰 암호화/회전/철회 없음. 최신 인가 URL, grant/scopes, 재동의·갱신 규칙 재확인 |
| 세션 | `/open/v1/sessions/auth`, `/sessions/auth/client`, 사용자 3개/클라이언트 10개 | 발급·정리 없음. 현재 인증 헤더/요청 규격, 세션·사용자·앱 제한, 권한 조건 재확인 |
| 수신 | Socket.IO 1.0.0~2.0.3, `connected`의 sessionKey, `/events/subscribe/chat`, 세션당 30 구독, `revoked` | dependency/adapter/구독/heartbeat/종료/재연결 모두 없음. 최신 protocol, 구독 경로·payload, message ID·작성자·채널 식별자, 재전송·철회 규칙 재확인 |
| 전송 | Chat API로 답장 가능하다는 제안, 정확한 scope/심사 미확인 | send 함수 없음. 현재 필수 scope, 방송자/봇 발화 주체, 전송/길이/빈도 제한, reply 기능·금지행위 확인 필요 |
| 인프라·비용 | 상주 서버 또는 Durable Object 후보 | 현재 request/response Worker에 Socket.IO 클라이언트를 켜는 구현 없음. 어느 기존 런타임에서 수신 가능한지·수명·재시작·무료 범위·요금·약관 모두 미검증. 앱 준비 완료가 상주 연결 인프라 준비를 의미하지 않음 |

### SOOP 연결 판단

공식 문서의 채팅 API 지원 범위를 확인하지 못했으므로 **미확인/보류**다. “지원하지 않는다”, “무료다”, “파트너만 가능하다” 중 어느 것도 확정하지 않는다. 확인할 항목은 공식 수신·전송 규격, OAuth/앱·채널별 권한과 동의, 파트너 신청·심사 여부, 제3자 봇 허용 범위, 사용자 ID·message ID 제공 여부, 연결/메시지 제한, 보관·삭제 의무, 무료/유료 비용이다. 이 단계에서는 SOOP 실연결 코드를 만들지 않는다. 공식 허용 경로가 확인되지 않으면 기존 웹 신청 페이지와 관리자 수동 입력을 이용한다. SOOP용 모의 이벤트 테스트가 공식 API 사용 가능성을 입증하지 않는다.

## 3. 이번 공통 채팅 계약 테스트의 의미

공통 파서가 기존 src에 없으므로 **test-only 모델**을 작성했다. `tests/fixtures/chatRequestModel.ts`는 제품 코드가 아니며 이후 CHAT-01의 검토 가능한 계약 초안이다. 현재 보안 경계/운영 스팸 방어로 계산하지 않는다.

- 입력: 미래 공식 adapter가 검증한 `platform/channelId/userId/eventId/displayName/text` envelope를 가정한다. 파서는 진위·서명·권한을 검증하지 않는다. 서버 관리의 플랫폼+채널→book 매핑만 사용한다. 임의 헤더/표시명/사용자가 쓴 bookId를 신뢰하지 않는다.
- 명령: CHZZK/SOOP 동일 `!신청 제목 / 가수`, `!대기열`, `!취소`. NFKC/공백 정규화, 길이/제어문자 제한, 빈 제목/가수·여러 `/`·다른 사용자 취소 인자 거부. `/`가 실제 곡명/가수명에 있는 경우와 기타 이스케이프 문법은 이번 계약에서는 자동 처리하지 않고 웹/수동 선택으로 넘긴다.
- 검색: 기존 `searchSongs`, `getSongAliases`, `normalizeForSearch` 재사용. UI 검색은 부분 일치를 허용하므로 첫 결과를 곧바로 신청하지 않고 제목·가수의 정확한 정규화 별칭을 모두 확인한다. 미등록 로마자를 임의로 번역하지 않는다. 동일 곡이 여러 개면 `needs_choice`, 없으면 미등록. 실제 미매칭을 임의 INSERT하지 않는다.
- 큐: 기존 `evaluateSubmit`의 중복 곡(두 플랫폼 공통 book 큐), 20초 쿨다운, 시간당 10회, 사용자·전체 큐 한도 재사용. 닉네임을 바꿔도 소유권이 바뀌지 않으며 같은 닉네임의 다른 ID는 취소할 수 없다. `!취소`는 본인의 가장 최근 pending만; approved/playing/타 플랫폼/다른 채널·book은 제외한다.
- 모델의 제안값: 이벤트 중복은 플랫폼+채널+eventId로 10분, 최대 1000건을 보관하며 가득 차면 fail closed. 전체 명령(조회·취소 포함)은 주체별 20초당 5회. 공개 큐 답장은 approved/playing 최대 5곡과 pending 수만 포함, 내부 ID/키/원문 사용자 식별자 제외. 자기 봇 이벤트는 무시한다. 이 수치들은 **공식 플랫폼 한도가 아니라 미배포 제안**이다.
- 한계: 단일 메모리 모델이다. 재시작/다중 인스턴스/지역/동시 트랜잭션/공식 계정 검증/메시지 전달은 검증하지 않는다. 채널 매핑·취소 범위 및 주체별 제한 정책은 실제 adapter/RPC 구현 전에 확정해야 한다.

### 기존 DB/권한/동시성에서 재사용할 것과 없는 것

`20261011_song_requests.sql`에는 이미 source(`web/chzzk/soop/admin`), nullable platform_user_id, active song unique index, book별 advisory lock, service-role 전용 submit/public-queue RPC가 있다. `20261012_request_queue_v2.sql`에는 재생 시작 RPC·playing 유일성·공개 pendingSongIds가 있다. source 허용 값/기존 웹 테이블을 새로 만들 필요가 없다.

현재 공개 POST는 `bookId/songId/name`만 받아 IP+salt로 키를 만들고, submit RPC는 **source='web'을 고정**한다. 정상 UUID 곡을 찾아야 하므로 설계의 “없는 곡 원문을 pending 저장”도 이 경로에는 없다. platform_user_id를 검증·저장하는 경로, 공식 채널↔book 연결, durable event idempotency, 채팅 작성자 자신만의 원자적 취소 RPC가 없다. 관리자 setStatus의 canceled 전환은 채팅 소유권 검증이 아니다.

최소 변경 후보는 기존 웹 API를 바꾸지 않는 내부 서비스 경로/RPC다. 서버 검증 platform ID의 namespace+book 및 비밀 salt 기반 주체 키, source/채널·주체 연결, 메시지 ID의 원자적 중복 방지를 설계하고 DB 변경이 필요하면 별도 승인용 마이그레이션/롤백을 제출한다. 취소는 본인+book+platform+pending 조건을 한 트랜잭션에서 검사하고 관리자 승인과 경쟁하면 조건부 update 실패로 처리해야 한다. in-memory dedupe만으로 보장하지 않는다. 익명/브라우저에 service role을 넘기거나 공개 POST에 임의 source/userId를 추가해 신뢰하지 않는다.

## 4. 다국어 가사·매칭 감사와 재현된 결함

기존 `getSongAliases`의 seed/직접 별칭, NFKC/가나·악센트 정규화, 가수 분리·비교, MusicBrainz의 metadata 경로를 사용한다. `searchPlan`은 단계적 후보 수집·검색 중복 제거·LRCLIB 요청 상한 14, MusicBrainz metadata 확장을 갖는다. LRCLIB provider에는 메모리 요청 공유/5분 캐시, MusicBrainz는 앱에서 1000ms 간격을 설정한다. 실제 약관 준수/서비스 응답 정확도를 검증한 것은 아니다. 로마자↔일본어가 모두 자동 음역되는 구조는 아니며 확인된 별칭이 없으면 자동 선택을 보류할 수 있다.

다음 `KNOWN GAP` 테스트는 **현재 결함을 재현해 통과**하는 characterization 테스트다. 초록색 결과는 안전한 자동선택이나 결함 수정을 뜻하지 않는다. 후속 수정 PR에서 원하는 거부/선택 동작의 assertion으로 바꿔야 한다.

| ID | 재현 | 원인·최소 후속 변경 |
|---|---|---|
| CHAT-MATCH | 부분 제목 검색으로 Live 곡도 UI 결과에 나옴 | browse 검색을 자동 큐 선택으로 쓰지 말고 정확한 제목+가수·버전 계약 적용 |
| LYR-VERSION / LYR-REVERSE | 원곡 요청에 Live/Cover/MR 후보가 자동 `synced`, 반대로 Live 요청에 원곡도 자동 선택. 일본어 ライブ/カバー/伴奏도 재현 | 괄호 제거로 제목 일치, 버전 mismatch는 -0.15 감점뿐이라 0.85로 자동 기준 0.75 통과. 검사 방향도 후보 쪽에만 치우치고 일본어 버전 단어 누락. 버전 분류·양방향 비교를 명시적 자동선택 gate로 만들고 애매하면 needs-choice |
| LYR-DEDUPE | 같은 제목/가수의 180초·300초 녹음이 하나로 합쳐짐 | dedupe key가 duration/recording ID/버전을 제외. 다른 녹음은 후보로 남겨 사람이 선택하도록 변경 검토 |
| LYR-CACHE | 제목을 `Offline Song`→`Offline Song (Live)`로 바꿔도 이전 항목이 유효 | cache titleKey도 괄호를 제거. 버전/별칭/metadata provenance를 포함한 무효화 설계. 단순 점수 수정만으로 이미 저장된 캐시 문제가 해결되지 않음 |
| LRC-PARSERS | offset=1000ms, [00:10][00:20]는 provider parseLrc에서 9/19초, 직접 저장한 앱 parseLyrics에서는 10초 한 줄로 해석 | parseLyrics는 단일 timestamp/보조 줄 중심이고 LRC meta·다중 태그 미지원. 저장/표시 경계를 호환되게 정규화하거나 두 파서 책임을 통합. 기존 발음·번역·평문 줄 보존 필요 |

정상 방어도 재확인했다: KO/EN/JA/로마자 등록 별칭으로 같은 곡 연결, 다른 가수의 동명곡 자동선택 거부, 가수만 맞는 cross-script는 사용자 선택, metadata 없는 임의 번역 안 함, plain lyrics의 시간 조작 안 함, 매칭되지 않은 줄은 time=null, 낮은 coverage 싱크 거부. 예제 가사는 전부 synthetic 문자열이다.

## 5. LRC → MR/YouTube → OBS 구조와 한계

1. `ProviderLyricsSynchronizer`는 실제 제공된 LRC만 쓴다. 자체 forced alignment는 `RemoteAlignmentSynchronizer` 인터페이스/선택적 호출 클래스만 있고 여기서 운영 backend를 확인하거나 호출하지 않았다. 균등 분배로 시간을 만들지 않는다.
2. 자동 결과는 SyncEntry(localStorage)의 기준 타임라인이고 `warps[videoId]`의 offset+ratio로 MR별 변환한다. 한 점은 intro offset, 두 점은 제한된 선형 tempo 보정이다. 편집/구간 삭제/비선형 tempo·다른 녹음까지 보장하지 않는다. duration 차이는 미리보기/일부 안내이며 후보 자동선택의 강제 gate가 아니다.
3. 직접 저장된 LRC는 `useLyricOffset(songId)`의 곡별 브라우저 offset을 사용한다(현재 ±120초). 자동 warp는 ±60초, ratio 0.8~1.25. 직접 저장 가사 offset은 video별이 아니므로 MR 교체 시 재검토 필요. 자동 결과에는 이 offset을 다시 적용하지 않는다.
4. LRC `[offset:+1000]`은 1초 앞당기지만 사용자가 주는 `+1초`는 1초 늦추는 방향이다. 이 부호 차이, 영상별 warp 분리, 잘못된 anchor 거부를 테스트했다.
5. `useYouTubePlayer`의 실제 재생 위치/상태/속도를 기준으로 화면 줄을 계산한다. `buildLiveLyrics`가 untimed 줄을 빼면서 원문·발음 같은 인덱스와 이미 보정된 times를 보낸다. SongMode/ConcertMode→BroadcastChannel/localStorage 또는 Supabase Realtime Broadcast→OBS. 이 앱 내부 Realtime은 방송 플랫폼 채팅 수신이 아니다.
6. `useLivePublisher`가 재생 중 2초 위치 갱신, 기본 5초 heartbeat. `liveClock`은 수신 시각 기준으로 playing만 외삽, pause/buffering은 고정, 새 pos로 seek 반영, 12초 후 외삽 제한이다. 편도 지연은 보상하지 않으며 live stale 처리는 별도다. 시계 필드 없는 구버전은 lineIndex fallback이다. 오디오 분석·YouTube 다운로드·OBS 플레이어 제어 기능이 아니다.

## 6. 실제 연동 우선순위와 최소 변경 순서

1. **P0 / 문서·권리 확인**: 공개 공식 문서 접근을 확보해 CHZZK scopes/동의·token 회전·session/Socket.IO·구독/전송 quota 및 약관을 재확인한다. 이미 등록된 앱을 재사용하고 등록 절차를 반복하지 않는다. SOOP은 공식 사용 허용/접근 조건·비용 확인 전 연결을 계속 보류한다. 가사 검색·보관·OBS 재표시의 출처·허용 범위·귀속 표시·삭제/철회 요구도 함께 확인한다. 가사 API 공개라는 사실만으로 재배포 권리를 추정하지 않는다.
2. **P0 / LYRICS-01**: 재현된 버전 gate·녹음별 후보 유지·캐시 무효화를 소규모 수정으로 먼저 해결한다. 기존 provider/검색 UI는 재작성하지 않고 확인 필요 후보를 수동 선택으로 보낸다. 버전 무시 캐시를 포함한 회귀 assertion을 안전 동작으로 교체한다.
3. **P1 / CHAT-01**: 테스트 전용 파서를 실제 순수 모듈로 승격하는 별도 PR. 프로토콜 envelope 정규화·검증 책임, slash 있는 곡 처리, 미등록/중복 후보 응답, 제한/취소 범위를 확정한다. 기존 검색/큐 규칙을 재사용하고 공식 adapter나 DB와는 아직 연결하지 않는다.
4. **P1 / 내부 큐 신뢰 경계**: 기존 source·테이블·RLS를 재사용하고 trusted channel mapping, event idempotency, source별 주체 키, 자기 pending 원자 취소를 설계한다. 필요 최소 마이그레이션은 별도 검토·승인·롤백 대상이다. 공개 웹 API 응답은 유지한다.
5. **P2 / CHZZK OAuth**: 공식 문서 확인 후 callback/state(CSRF), 필요한 경우 공식 PKCE 요건, 소유자↔채널 연결, 최소 scope, 서버 전용 암호화 token 저장/회전·철회·삭제를 구현한다. 앱 권한 선택을 실제 방송자 grant로 간주하지 않는다. 브라우저/VITE/공개 overlay에 token을 넣지 않는다. 값은 이 채팅에서 요구하지 않고 별도 승인된 보안 설정 흐름으로 처리한다.
6. **P2 / CHZZK 세션·수신·전송**: 기존 자원에서 protocol/연결 수명/재시작이 가능한지 먼저 확인한다. 상주 수신·재구독·backoff·revoked·replay 처리, 검증된 envelope→명령→내부 큐 순서로 연결한 뒤 전송 quota/봇 자기응답 방지/최대 답장 길이를 구현한다. 요금·제약이 확인되지 않으면 중단한다. 새 호스팅/구독/DO 등 인프라를 임의 추가하지 않는다.
7. **P2 / LYRICS-02**: 직접 저장 LRC 경계 정규화와 영상별 offset 정책을 호환성 테스트와 함께 수정한다. OBS 메시지 포맷·기존 fallback을 유지하고 새 sync 엔진은 만들지 않는다.
8. **P3 / 검토 후 별도 승인**: 실제 방송자 동의·계정 연결·비밀 설정·운영 데이터/배포·제한된 실연동 검증은 전부 이번 범위 밖이다. 실제 검증 시나리오는 두 플랫폼 각각 수신→신청→본인 취소/다른 사람 거부→큐 답장, 철회/재연결/replay·관리자 승인 경쟁, 영상/MR 변경·OBS 지연을 구분한다. SOOP 공식 경로가 확인되지 않으면 웹 신청 대체를 유지한다. main 병합·배포는 자동 실행하지 않는다.

## 7. 검증·미검증·위험·롤백

실행 명령/최종 결과는 아래에 기록한다. 신규 테스트는 test-only 계약(채팅)과 기존 코드 결함 재현/안전 방어 확인(가사)을 분리한다. 전체 테스트 통과를 플랫폼 연결 완료나 결함 수정으로 표현하지 않는다.

위험도: 제품 동작 변경 위험은 낮음(문서·테스트만). 하지만 현재 가사 자동 매칭 결함과 채팅 신뢰 경계 미구현 위험은 남아 있다. 실제 공식 API 최신 스펙/약관/가격, OAuth grant, 배포, 운영 DB/RLS, 실제 YouTube/OBS·Realtime는 미검증이다. 운영 계정/사용자 데이터/환경변수·token은 조회하지 않았다.

롤백: 이 감사 커밋을 `git revert`하면 문서·테스트만 제거된다. DB/설정/데이터 롤백이나 배포는 필요 없다. 이번 작업에서 main 병합·Cloudflare 배포는 하지 않는다.


최종 로컬 검증 결과:

| 검증 | 결과 |
|---|---|
| `npm ci` | 성공, lockfile 변경 없음 |
| `npm run lint` | 성공, 오류 0 / 기존 경고 13 |
| `npm run typecheck` | 성공(저장소의 src/Vite 검사 범위) |
| `npm run build` | 성공, 기존 큰 번들 경고 |
| `/workspace/onboarding-tools/node_modules/.bin/tsx --test tests/*.test.ts` | 304개 통과(기존 241 + 신규 63), 실패/취소/건너뜀/todo 0 |
| 신규 테스트 해석 | 63개 중 11개는 `KNOWN GAP` 현행 위험 재현, 나머지는 제안 계약/기존 안전 동작 확인. 실제 플랫폼 연동은 0건 |
| PGlite 오프라인 SQL/API 5개 | 34/34 + 15/15 + 5/5 + 19/19 + 33/33 = 106개 통과 |
| `git diff --check` | 성공 |

신규 파일은 이 보고서, `tests/chatRequestContract.test.ts`, `tests/fixtures/chatRequestModel.ts`, `tests/lyricsPhaseOneAudit.test.ts` 네 개뿐이다. SQL 검사는 기존 in-memory PGlite 스크립트이며 운영 DB가 아니다. 수동 REAL API 스크립트는 실행하지 않았다. 실제 CHZZK/SOOP/Google/Supabase/Cloudflare 운영 요청·OAuth·token 사용·새 인프라·유료 API·배포는 수행하지 않았다.

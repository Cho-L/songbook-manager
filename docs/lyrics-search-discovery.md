# Issue #10: 가사 발견 경로 개선

## 기반과 목표

최신 main `6a9125d`와 [Issue #10](https://github.com/Cho-L/songbook-manager/issues/10), Draft [PR #9](https://github.com/Cho-L/songbook-manager/pull/9)를 확인했다. main에는 아직 LYRICS-01이 없으므로, 새 로컬 브랜치 `feat/lyrics-search-discovery`에 기존 PR #9 커밋 `3fcf262`를 선행 기반으로 그대로 재사용했다. main이나 PR #9 브랜치를 수정/병합하지 않았다.

목표는 오매칭 차단만이 아니라 **연결된 제공자에 이미 있는 가사를 검색·별칭·조회 경로 때문에 놓치는 경우의 발견율 개선**이다. 실제 LRCLIB 등록 여부를 확인하기 위한 운영 API 호출은 하지 않았다. 핵심 곡의 표기/2019 싱글 246초와 Live in Okinawa 251초는 이슈가 제공한 메타데이터이며, LRCLIB 레코드 존재나 가사 이용 권한의 증거가 아니다.

## 원인과 변경

1. 기존 queryTitle은 일부 ASCII 기호와 괄호만 정리해 ♡/Unicode 기호·공백 변형을 놓쳤다. 새 `lyricsQueryVariants`는 원문을 먼저 시도하고 NFKC/공백 및 기호를 공백으로 바꾸거나 제거한 표기를 최대 4개 생성한다. 영어 apostrophe의 `Don't`→`Dont`도 검색 가능하다. 버전 문자열을 쿼리에서 정리하더라도 적용 여부는 PR #9의 실제 입력·후보 버전 gate로 판단한다.
2. browse 검색에서 동등하게 정규화되는 제목은 검색 별칭에서도 제거돼 하트 유/무의 정확한 provider 표기를 복원할 수 없었다. `getSongAliases`는 provider용 기호 표기를 보존하되 기존 browse 검색 정규화는 유지한다. 神宿/Kamiyado/카미야도 및 원제/하트 없는 제목/한국어/Grizzly ni Osowaretara는 이슈에서 제공한 대응만 seed에 추가했다. 다른 가수의 동명곡에 이 제목 별칭을 적용하지 않는다.
3. 느슨한 쿼리로 예산을 소진하기 전에 원문·기호 변형·등록된 원어/로마자/가수 별칭의 targeted 검색을 수행한다. 6회 이내 첫 단계 뒤 MusicBrainz metadata를 조회하고 갱신된 별칭 쿼리를 우선한다. 기호만 다른 별칭이 모든 자리를 차지하지 않게 다른 문자 표기를 먼저 배치한다. 영어/일본어도 자유 검색(q), 제목 단독 및 가수 탐색 fallback을 사용할 수 있다. 확실한 첫 결과는 여전히 1회에서 조기 종료한다.
4. `/api/search`가 비었더라도 DB metadata 조회인 `/api/get`이 레코드를 찾을 수 있도록 최대 2개 exact pair를 시도한다. search/get 모두 기존 LRCLIB 곡당 총 상한 **14회**를 공유하고, 동일 endpoint·인수는 중복 호출하지 않는다. get 404는 해당 조회의 miss, 429/5xx/네트워크/잘못된 응답은 오류로 구분한다. 서비스 장애/제한에서는 추가 호출을 중단한다.
5. get은 단일 레코드 응답을 기존 LyricsCandidate로 바꾸고 동일 요청 공유·5분 캐시를 재사용한다. 명시적 reference recording duration/album만 전달한다. 일반 곡에는 길이를 지어 넣지 않으며 YouTube MR 길이를 원곡 길이로 사용하지 않는다. MusicBrainz 곡 목록에서 사용자가 선택한 녹음의 length는 reference duration으로 사용할 수 있다. 취소된 공유/캐시 요청의 caller가 성공 처리되지 않으며, 이미 취소된 새 요청도 네트워크를 시작하지 않는다.
6. MusicBrainz artist/alias 검색 후 정확한 가수만 채택한다. 제목 자체뿐 아니라 **등록된 recording alias**가 입력과 일치해도 원어 제목을 찾는다. 한국어 별칭도 허용한다. 다른 artist-credit/다른 버전은 제외한다. 첫 browse 페이지로 찾는 fallback은 유지하지만, 단순 앨범 이름을 같은 곡 제목이라고 추측하지 않는다. 새 번역/무작위 음역/가사 사이트 수집은 없다.

이 변경은 seed 한 곡에만 의존하지 않는다. seed에 없는 로마자→원어 곡(MusicBrainz 등록 별칭으로 확인), 영어 구두점·공백 및 q-only 응답으로만 발견되는 곡도 별도 회귀 테스트로 검증했다. 기존 꽃길/IU/YOASOBI/Vaundy/Aimyon 및 PR #9의 버전 회귀를 유지한다.

## 제공자 부재·검색 miss·오류 구분

`SyncEntry`에 선택적인 searchRevision/discovery 요약을 추가했다(기존 저장 형식 v1/API/Song 필드 유지). 요청 수, 고유 레코드, 사용 가능한 가사 레코드, 실패 수, 검색 상한을 기록한다. 개인정보/키/가사 원문/요청 URL을 진단 로그로 출력하지 않는다.

| 관측 | 의미/안내 |
|---|---|
| search 빈 배열, get 404 | 시도한 인수에서 결과 없음. LRCLIB 전체 미등록을 입증하지 못함 |
| 반환 레코드 있지만 plain/synced 본문 없음 | provider가 반환한 곡 정보에서 가사를 받지 못함. 다른 사이트의 가사 존재와 별개 |
| 가사는 받았지만 제목/가수 점수 낮음·버전 차이 | 데이터 부재가 아니라 매칭/선택 문제. 후보를 보여 주거나 안전하게 보류 |
| 429/5xx/연결·응답 오류/조회 상한 | 일부/전체 조회 미완료. 가사 부재로 단정하지 않고 재시도 안내 |
| plainLyrics만 있음 | 가사만 표시하며 timestamp를 생성하지 않음 |

실패 화면은 “현재 연결된 가사 제공자에서 찾지 못했어요”와 구체적 근거를 안내한다. 편집 권한이 있는 사람에게 기존 곡 수정 화면의 **가사·LRC 직접 입력** 링크를 제공한다. 권한 없는 사람에게 편집 링크를 노출하지 않는다. 사용 권한이 있는 가사/LRC를 입력하고 기존 timestamp 편집·수동 offset/앵커 보정을 쓰도록 안내한다. Uta-Net/UtaTen/Shazam은 데이터 존재의 다른 예시일 뿐, 이번에 읽거나 크롤링하거나 가사를 저장·재배포하지 않았다. 새 제공자·유료 API·호스팅은 추가하지 않았다.

이전 검색 알고리즘의 negative cache만 다시 확인한다. 양성 cache의 PR #9 titleKey, 저장 가사·영상별 warp는 유지한다. 완결된 새 negative 결과의 24시간 TTL은 유지하고, 조회 상한 때문에 불완전한 결과는 1분 뒤 재확인, 실패가 섞인 결과는 오래 붙잡지 않는다. provider 요청 공유/5분 메모리 캐시는 별도다.

## 오프라인 개선 비교

동일한 synthetic 제공자 fixture를 **PR #9 실제 소스(3fcf262를 임시 디렉터리에 git archive)**와 새 소스에서 각각 실행했다. 실가사는 쓰지 않았다. 원문/한국어/로마자 표기를 넣고 “데이터는 존재하지만 로마자 structured 검색만 응답”, “기호 없는 검색만 응답”, “search는 비고 get만 응답”하는 7개 조건을 비교했다.

| 입력·제공자 조건 | 이전 발견/요청 | 새 발견/요청 |
|---|---|---|
| 원제♡ / 神宿 → 로마자 레코드 | 실패 / 2 | 성공 / 5 |
| 하트 없는 제목 / 神宿 → 로마자 레코드 | 실패 / 2 | 성공 / 5 |
| 한국어 제목 / 카미야도 → 로마자 레코드 | 실패 / 3 | 성공 / 8 |
| 원제♡ / Kamiyado → 로마자 레코드 | 실패 / 2 | 성공 / 6 |
| Grizzly ni Osowaretara / Kamiyado → 로마자 레코드 | 성공 / 1 | 성공 / 1 |
| 원제♡ / 神宿 → 기호 없는 search만 응답 | 실패 / 2 | 성공 / 2 |
| 원제♡ / 神宿 → metadata get만 응답 | 실패 / 2 | 성공 / 9 |

**동일 모의 데이터의 발견은 1/7→7/7이다. 실제 LRCLIB 발견율/수록 여부·속도 측정이 아니다.** 어려운 입력에서 더 많은 검색을 수행해 가사를 찾는 것이며 모든 요청 수가 줄었다는 주장이 아니다. 신규 offline fixture는 `tests/fixtures/lyricsDiscovery.ts`, 안전한 기대 동작은 `tests/lyrics-discovery.test.ts`에 있다.

## 공식 API 확인 범위와 남은 한계

`https://lrclib.net/docs` 공개 문서는 이 환경에서 403이었다. 공식 공개 [LRCLIB 소스](https://github.com/tranxuanthang/lrclib)의 ARCHITECTURE.md, server/src/routes/get_lyrics_by_metadata.rs, router.rs를 읽었다. 해당 소스에서는 search가 검색 인덱스이고 get이 DB metadata 조회이며 track_name/artist_name 필수, album_name/duration 선택(길이 1~3600초)이다. **운영 배포가 해당 소스와 동일한 버전인지 미검증**이다. get이 다른 인수를 요구하는 400/422 같은 인수 오류를 반환하면 검색 fallback을 계속하며, 오류를 가사 없음으로 숨기지 않는다. 실제 LRCLIB/MusicBrainz 응답·CORS·정책·core 곡 등록 여부는 운영 호출 금지에 따라 미검증이다.

MusicBrainz lookup은 기존 구조대로 최대 가수/recording/browse 3회이고 기본 앱 간격 1000ms를 유지한다. LRCLIB 상한 14는 MusicBrainz 호출을 포함하지 않는다. 여러 녹음의 길이·별칭/표기 또는 제공자 metadata가 불완전하면 일부 곡을 여전히 못 찾을 수 있다. 원곡 246초/Live 251초는 제목 버전 gate와 recording 후보로 구분하며, 길이만으로 같은 녹음이라고 단정하지 않는다. PR #9의 gate/explicit choice/캐시 정책과 OBS/MR 시계·백업·DB 구조는 재작성하지 않았다.

## 검증·롤백·제출 범위

실제 운영 API·계정·사용자 데이터·Supabase/Cloudflare는 접근하지 않는다. SQL 검증은 기존 in-memory PGlite로만 수행한다. 롤백은 이번 검색 개선 커밋만 `git revert`하면 PR #9의 버전 안전 검사로 돌아간다. DB/설정 마이그레이션은 없다. 사용자의 최신 지시대로 로컬 커밋까지만 수행하며 GitHub 푸시/PR 생성·main 병합·Cloudflare 배포는 하지 않는다.

최종 로컬 검증 결과:

| 검증 | 결과 |
|---|---|
| `npm ci` | 성공, package.json/lockfile 변경 없음 |
| `npm run lint` | 통과, 오류 0 / 기존 경고 13 |
| `npm run typecheck` | 통과 |
| `npm run build` | 통과, 기존 큰 번들 경고 |
| `tsx --test tests/*.test.ts` | 326개 통과(PR #9 기반 296 + 신규 30), 실패/취소/건너뜀/todo 0 |
| 기존 PGlite SQL/API 5개 | 34/34 + 15/15 + 5/5 + 19/19 + 33/33 = 106개 통과 |
| `git diff --check` | 통과 |

기존 provider mock은 새 get의 단일 object/404 계약을 반영했다. 기존 metadata 테스트는 등록된 recording alias와 단순 앨범명의 구분, metadata 실패 표시를 검증하도록 갱신했다. 요청 상한은 search/get 합산 14회로 검사하며 assertion을 끄지 않았다. 새 UI 테스트는 편집 권한자에게만 기존 edit 링크가 보이는지 서버 렌더링으로 확인한다. 실제 브라우저/실제 제공자 통합·core 곡의 LRCLIB 수록 여부는 미검증이다.

이번 커밋의 변경 파일:
- `src/components/song/ArtistSongBrowser.tsx`, `src/components/song/AutoLyricsBar.tsx`
- `src/data/aliasSeed.ts`, `src/utils/songAliases.ts`
- `src/hooks/useAutoLyrics.ts`, `src/lyrics/cache.ts`, `src/lyrics/pipeline.ts`
- `src/lyrics/providers/lrclib.ts`, `src/lyrics/providers/musicbrainz.ts`
- `src/lyrics/searchPlan.ts`, `src/lyrics/text.ts`, `src/lyrics/types.ts`
- `tests/lyrics-korean.test.ts`, `tests/lyrics-phase35.test.ts`, `tests/lyrics-discovery.test.ts`, `tests/fixtures/lyricsDiscovery.ts`
- `docs/lyrics-search-discovery.md`

PR #9의 `versions.ts`/`matching.ts` gate·dedupe는 바꾸지 않았다. DB/Worker 설정/시크릿/송북 저장 형식/OBS·MR 프로토콜/백업 코드/의존성 선언은 변경하지 않았다. negative cache만 새 검색 revision으로 재확인하고 양성 cache와 보정은 유지한다. MusicBrainz metadata 오류도 미등록과 구분하며 실패를 오래 캐시하지 않는다.

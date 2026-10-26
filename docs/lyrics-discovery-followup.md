# 가사 발견 경로 후속 검증

## 범위와 기반

로컬 브랜치 `fix/lyrics-discovery-version-context`를 `23cee6f5325a080d78f8da3fb24eb579565f8058`에서 만들었다. 시작 시 작업 트리는 깨끗했다. PR #9의 `3fcf262`는 버전 gate, 녹음별 dedupe와 자동 캐시 무효화를 도입했으며 검색 발견율 개선은 포함하지 않았다. `23cee6f`에는 이미 원문 우선/기호·공백 변형, 원어·한국어·로마자 제목과 가수 별칭, MusicBrainz 등록 별칭, LRCLIB search/get 및 제한된 fallback이 구현돼 있다. 기존 구현은 재사용하고 아래 차이만 추가했다.

## 추가 변경

- `src/lyrics/versions.ts`: `Live Forever`, `Cover Me`, `라이브 포에버`처럼 제목 앞의 일반 단어 자체는 버전 표시로 단정하지 않는다. 괄호·구분자 뒤의 버전과 끝의 `Song Live`·`Song ライブ`·`Song MR` 표기는 계속 보수적으로 처리한다. `Live Song`과 `Song`처럼 접두어를 제거하면 상대 제목과 정확히 같아지는 쌍도 차단한다. 장소 등 추가 괄호 설명을 보존한다. 분류는 제목 metadata 휴리스틱이며 제목 중간의 모호한 단어/버전은 여전히 사용자 확인을 요구할 수 있다. 실제 오디오를 식별하는 기능은 아니다.
- `src/lyrics/searchPlan.ts`: 명시적 기준 녹음 길이를 넣은 get이 후보를 못 찾으면 원문 제목·가수로 길이 조건 없는 get을 한 번 추가한다. 원곡 길이를 MR 길이로 대체하지 않는다. 후보는 같은 제목·가수·버전 gate와 다중 녹음 선택을 통과해야 한다. 서비스 장애/429/잘못된 응답에서 반복 요청하지 않으며 기존 search/get 총 14회 상한과 중복 요청 억제를 유지한다. 제공자의 길이/검색 인덱스 metadata 차이가 반드시 데이터 부재를 뜻하지 않기 때문이다.
- `src/lyrics/types.ts`: 검색 revision을 2로 올려 이전 실패·선택 대기 등 negative cache를 재검사한다. 양성 캐시 키·v1 저장 형식·영상별 warp 보정은 유지한다.
- `tests/lyrics-discovery-followup.test.ts`: 일반 제목의 다국어 별칭 정상 적용, 명시된 Live/Cover/MR 및 일본어 버전 양방향 차단, 접두·접미 버전/장소 구분, metadata 길이 fallback, 이전 양성 캐시·warp 보존을 27개 오프라인 테스트로 검증한다. 실제 fetch를 금지하고 주입된 합성 제공자만 쓴다.

♡/기호를 제거한 검색어와 별칭은 후보를 찾는 수단이다. 실제 후보 적용은 원래 제목·가수를 기준으로 검증한다. 등록된 별칭만 사용하며 임의 번역·가사 크롤링·타임스탬프 생성은 하지 않는다. 정확한 structured search, metadata get, 자유 검색은 서로 다른 조회이며 어느 한 경로의 빈 결과도 전체 LRCLIB 미등록의 증거로 사용하지 않는다.

## 실제 호출과 합성 검증 구분

LRCLIB에 공개 제목 `グリズリーに襲われたら♡` / 가수 `神宿`로 `/api/search` 실제 호출을 시도했다. curl은 **CONNECT tunnel failed, response 403**, HTTP **000**으로 종료됐다. 프록시에서 차단되어 LRCLIB API 응답을 받지 못한 것이다. 실제 성공률/수록 여부/오매칭률은 **측정 불가**이며 0% 또는 미등록으로 해석하지 않는다. MusicBrainz·Google·Cloudflare·Supabase 운영 API, 계정·사용자 데이터는 호출하지 않았다. 다른 가사 사이트도 접근하지 않았다.

PR #9와 `23cee6f`의 실제 소스를 `/tmp`에 git archive로 추출해 현재 소스와 동일한 synthetic fixture로 비교했다. 가사는 합성 두 줄뿐이며 실제 제공자의 레코드 존재를 주장하지 않는다.

| 합성 조건 | PR #9 | 23cee6f | 후속 수정 |
|---|---:|---:|---:|
| 원제♡/神宿 → 로마자 레코드 | 실패 | 성공 | 성공 |
| 기호 없는 원제/神宿 → 로마자 레코드 | 실패 | 성공 | 성공 |
| 한국어 제목/카미야도 → 로마자 레코드 | 실패 | 성공 | 성공 |
| 원제♡/Kamiyado → 로마자 레코드 | 실패 | 성공 | 성공 |
| Grizzly ni Osowaretara/Kamiyado → 로마자 레코드 | 성공 | 성공 | 성공 |
| 원제♡/神宿 → 기호 없는 search만 응답 | 실패 | 성공 | 성공 |
| 원제♡/神宿 → metadata get만 응답 | 실패 | 성공 | 성공 |
| 기준 길이 있는 get은 404, 길이 없는 get만 응답 | 실패 | 실패 | 성공 |
| 리브 포에버 + 확인된 Live Forever 제목 별칭 | 선택 필요 | 선택 필요 | 성공 |
| 자동 싱크 발견 합계 | **1/9** | **7/9** | **9/9** |

마지막 두 조건은 기존 7개 발견 benchmark에 새로 더한 회귀 사례다. 실제 서비스 발견율이나 모든 검색의 지연 감소를 주장하지 않는다. 명시된 다른 버전은 합성 테스트에서 자동 적용하지 않았고, 같은 제목·가수의 여러 녹음은 PR #9의 선택 정책을 유지한다. 가사가 없거나 조회가 불완전하면 `23cee6f`의 구체적 안내·기존 수동 가사/LRC 입력 경로를 그대로 사용한다.

## 호환성·검증

기존 titleKey/artistKey/lyricsHash·영상별 warp를 유지하며 revision 1 양성 cache의 offset 3, ratio 1.1을 적용한 10초→14초 출력을 새 테스트로 확인했다. revision 1 negative만 재조회한다. 기존 저장 LRC·MR 영상 ID·다국어 별칭 백업 왕복, OBS clock/가사 출력 및 PR #9 안전 회귀도 전체 테스트에서 유지됐다. DB 스키마·Worker·인증·설정·시크릿·의존성·실제 사용자 저장소는 변경하지 않았다. 실제 브라우저/OBS/운영 통합 검증은 수행하지 않았다.

| 검사 | 결과 |
|---|---|
| npm ci | 성공, 의존성 선언/lockfile 변경 없음 |
| npm run lint | 통과, 기존 경고 13개 |
| npm run typecheck | 통과 |
| npm run build | 통과, 기존 큰 번들 경고 |
| tsx --test tests/*.test.ts | **353/353 통과**, 실패/취소/skip/todo 0 |
| 오프라인 PGlite SQL/API 5개 | **106/106 통과** (34+15+5+19+33) |
| git diff --check | 통과 |

주요 위험은 제목 metadata가 불완전하면 여전히 선택이 필요하거나 못 찾을 수 있다는 점이다. 길이 없는 fallback은 최대 요청 수를 늘리지 않지만 기존 예산 안에서 뒤쪽 broad search 한 번을 대신할 수 있다. 실패 캐시가 새 revision으로 재조회되는 동안 요청이 증가할 수 있다. 양성 보정 cache는 그대로 유지된다.

후속 변경의 커밋 대상은 코드 3개, 테스트 1개, 이 보고서까지 총 5개 파일이다. 로컬 기반 `23cee6f`와 diff로 검토할 수 있다. 복구 시 이번 후속 커밋만 되돌리면 되며, DB 마이그레이션은 없다. 기존 사용자 변경을 함께 버리는 명령은 사용하지 않는다.

## 제출 전 배포 트리거 점검

사용자는 Cloudflare의 Builds for non-production branches를 해제했고 production branch는 main이라고 확인했다. 이 확인을 유지하며 설정을 변경하지 않았다. `.github/workflows/quality-check.yml`과 `sql-regression.yml`은 main 대상 PR/수동 실행에서 검사만 수행하며 배포 단계가 없다.

다만 PR #9 공개 페이지에는 커밋 `3fcf262`에 대한 Netlify 자동 Deploy Preview 기록(`6adf10467750d2cb04a48e68`)이 있다. 현재 Netlify/Cloudflare 앱의 브랜치·PR 트리거 설정이나 preview 환경이 운영 credentials/DB와 분리됐는지 독립 조회할 수 있는 도구는 없다. GitHub hooks 및 Actions runs 조회도 API 403으로 차단됐다. 과거 미리보기 기록을 현재 운영 배포로 단정하지 않지만, 푸시/PR이 안전하다고 확인하지도 못했다.

사용자의 사전 점검 조건에 따라 로컬 커밋까지만 수행하고 push와 Draft PR 생성은 보류한다. 원격 main은 `6a9125d0fa52a9892b72a0eb5adecfabf3038478`, PR #9는 여전히 `3fcf262e72ac84a59f306e5cfa49ce5b10090095`로 확인했다. 원격 변경·워크플로 수동 실행·main 병합·운영/미리보기 배포는 수행하지 않았다. 새 PR의 GitHub Actions 실행 결과와 GitHub 병합 가능 상태는 아직 존재하지 않아 확인할 수 없다.

# YouTube 검색 입력 검증과 할당량 보호 (#5)

현재 운영 대상은 `wrangler.toml`의 `*.workers.dev` Worker다. 이 변경은 검토용 코드이며 운영 검증이나 배포를 수행하지 않는다.

## 이번 변경

- Worker와 Vite 개발 서버가 `src/server/youtubeSearchHandler.ts`를 공유한다.
- GET만 허용한다. 그 외 메서드는 405, `Allow: GET`, `{ error: string }`을 반환한다.
- `q`는 하나만 받는다. 앞뒤 공백 제거 및 연속 Unicode 공백을 ASCII 공백 하나로 정규화한다. 정규화 후 Unicode code point 기준 1~100자만 허용한다. 제어문자(C0/C1, 탭/개행 포함), 서로게이트 및 디코딩 오류의 U+FFFD는 거부한다. 검색 연산자, 한글/일본어/이모지, URL 특수문자는 보존하고 URLSearchParams로 인코딩한다.
- 정상 응답은 기존 `{ results: [{ videoId, title, channelTitle, thumbnailUrl? }] }`다. 빈 결과, 썸네일 fallback, HTML entity 제목도 기존대로 보존한다. 오류 응답은 `{ error: string }`, 키 미설정 500, upstream 오류 502를 유지한다. 입력 오류는 키 확인보다 먼저 처리한다.
- `Cache-Control: no-store`로 암묵적 데이터 보관을 피한다. 서버 결과 캐시, 동시 요청 합치기, 자동 재시도, 유료 기능은 추가하지 않는다.
- MR 안내는 프로젝트 할당량과 다른 이용자의 사용량에 따라 검색 가능 횟수가 달라진다고 설명한다. 사용자별 고정 일일 횟수나 고정 quota 비용을 약속하지 않는다.
- 과거 Netlify Function은 현재 운영 경로가 아니므로 변경하지 않았다. 이번 검증 보강은 Worker/Vite 경로에 적용된다.

## 공식 문서 확인 및 캐시 결정 (2026-10-26)

확인 대상:

- [Cloudflare Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)
- [Cloudflare rate-limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [YouTube quota](https://developers.google.com/youtube/data/determine_quota_cost)
- [YouTube search.list](https://developers.google.com/youtube/data/reference/rest/v3/search/list)
- [YouTube API developer policies](https://developers.google.com/youtube/terms/developer-policies)

이 환경에서 위 공식 문서 사이트는 HTTP 403으로 차단됐다. Google API나 운영 Cloudflare 서비스에 요청한 것은 아니며 공개 문서 조회만 시도했다.

Cloudflare 문서는 공식 GitHub 저장소의 [cache.mdx](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/workers/runtime-apis/cache.mdx), [rate-limit.mdx](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/workers/runtime-apis/bindings/rate-limit.mdx)로 읽었다. Cache 문서는 custom domain 및 Pages의 동작 조건과 dashboard/playground 미지원 조건을 설명한다. 이것만으로 현재 프로젝트의 workers.dev 운영 환경에서 Cache API가 지원·동작한다고 단정하지 않는다. `caches.default` 객체의 존재나 모의 put 성공은 실제 보관/재사용의 증거가 아니다. workers.dev에서 미지원이라고 단정하지도 않는다.

YouTube 보관·갱신·삭제 정책과 현재 운영 도메인의 Cache API 지원을 모두 확인하지 못했으므로 **캐싱을 구현하거나 절감 효과를 주장하지 않는다**. 오프라인 테스트는 Cache API가 없거나, 존재하거나, 접근 시 실패해도 검색 경로가 이를 사용하지 않으며 같은 쿼리 두 번은 upstream 두 번을 호출함을 확인한다. 실제 캐시 검증으로 해석하면 안 된다.

후속 대안은 정책 확인 후 검토한다: (1) 기존 브라우저 검색 결과 재사용 범위 확인, (2) 짧은 수명의 isolate 내 중복 요청 합치기 또는 크기/TTL 제한 메모리 캐시, (3) 지원이 확인된 custom domain Cache API. 메모리는 재시작·지역·isolate별로 분리되므로 전역 절감이나 일일 한도를 보장하지 않는다. 캐시에 API 키가 들어간 URL을 키로 사용하지 않고 정책상 보관 기간·갱신·삭제 및 사용자 데이터 제외를 명시해야 한다. 새 도메인/저장소/바인딩은 이 PR에서 만들지 않는다.

## 남은 공개 API 위험과 단계적 제안

입력 제한은 잘못된 요청만 차단한다. **정상 형식의 공개 검색 반복 요청은 여전히 프로젝트 할당량을 소진시킬 수 있다. 서버 rate limit이나 전역 quota cap은 구현하지 않았다.** 임의 `X-Forwarded-For`, 사용자 지정 ID 헤더 등을 신뢰해 제한을 우회 가능하게 만들지 않는다.

무료 범위에서 검토할 순서(이 PR에서는 활성화하지 않음):

1. Google Cloud Console에서 해당 프로젝트에 실제 적용된 검색 bucket/할당량과 사용량을 사람이 확인한다. 가능하다면 낮은 프로젝트 상한을 선택하고 유료 quota 확대는 하지 않는다. 이슈에 인용된 수치도 이 환경에서는 독립 확인하지 못했으므로 사용자별 검색 횟수로 환산하지 않는다.
2. 기존 클라이언트의 명시적 검색/중복 억제/취소 흐름을 유지하고, 별도 정책 확인 후 재사용을 개선한다. 클라이언트 개선은 직접 API 호출 공격을 막지 못한다.
3. 현재 계정의 무료 기능·한도·비용을 확인한 다음 별도 승인을 받아 제한 방식을 선택한다. Cloudflare 공식 rate-limit 문서는 바인딩 설정이 필요하며 지역별 근사 제한으로 전역 동시성/일일 quota를 보장하지 않는다고 설명한다. WAF/rate-limit 바인딩/Durable Objects/KV 등을 이번 변경에 추가하지 않는다. trusted edge가 부여한 ID나 서버 검증 세션의 신뢰 경계를 먼저 설계한다.

## 검증·위험·롤백

테스트는 가짜 키와 주입된 fetch/Worker mock만 사용한다. Google 검색, 실제 Cloudflare/Supabase/사용자 데이터 요청, 수동 실제 API 점검 스크립트는 실행하지 않는다. 전체 오프라인 검증은 `npm run lint`, `npm run typecheck`, `npm run build`, `tsx --test tests/*.test.ts`와 기존 PGlite SQL/API 시뮬레이션이다.

API 형태 변경 위험은 낮다. 의도적인 차이는 GET 외 메서드·길거나 비정상/중복 q 거부와 공백 정규화다. 캐시 미사용으로 즉각적인 중복 조회 절감은 없다. 실제 Worker 통합과 프로젝트 quota·정책·캐시 동작은 미검증이다. Worker 번들·설정·시크릿·Auth·DB 변경/배포가 검증됐다는 의미가 아니다.

롤백은 이 PR 커밋을 `git revert`하면 된다. DB/설정 마이그레이션은 없다. 운영 반영이나 롤백 배포는 소유자의 별도 승인 절차이며 자동 실행하지 않는다.

이번 브랜치의 로컬 결과: `npm ci`, lint(기존 경고 13개, 오류 0), typecheck, build(기존 큰 번들 경고), 단위 테스트 241개(신규 42개 포함) 통과. PGlite 오프라인 검사도 5개 스크립트에서 34/34, 15/15, 5/5, 19/19, 33/33으로 총 106개 통과했다. 실패/취소/건너뜀은 없다. 초기 Vite import 확장자 타입 오류는 `.ts` 경로로 수정한 뒤 typecheck/build를 다시 통과했다. 수동 REAL 외부 API 검증은 실행하지 않았다.

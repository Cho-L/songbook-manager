# 실제 API 검증 결과 — REAL(실제 LRCLIB/MusicBrainz)
실행: 2026-10-15T11:37:14.505Z

## [1] 무희 / 바운디
앱 검색 결과: not-found

요청:
- LRCLIB `/api/search?track_name=무희&artist_name=바운디` → 200 (872ms)
- LRCLIB `/api/search?track_name=무희` → 200 (845ms)
- LRCLIB `/api/search?track_name=무희&artist_name=Vaundy` → 503 (589ms)
- LRCLIB `/api/search?q=무희+바운디` → 200 (690ms)
- LRCLIB `/api/search?q=무희+Vaundy` → 200 (581ms)
- MusicBrainz `/ws/2/artist?query=artist:"Vaundy"&limit=5&fmt=json` → 200 (792ms)
- MusicBrainz `/ws/2/recording?query=arid:114b26ff-a1fe-41f3-9df8-5c093afe9c56+AND+recording:"무희"&limit=10&fmt=json` → 200 (261ms)
- LRCLIB `/api/search?q=Vaundy` → 429 (331ms)
- LRCLIB `/api/search?q=Vaundy+Engawa` → 200 (606ms)
- MusicBrainz `/ws/2/artist?query=artist:"Vaundy"+OR+alias:"Vaundy"&limit=8&fmt=json` → 200 (247ms)
- MusicBrainz `/ws/2/recording?artist=114b26ff-a1fe-41f3-9df8-5c093afe9c56&inc=aliases+artist-credits+releases&limit=100&offset=0&fmt=json` → 400 (235ms)

검사:
- **PASS** 아티스트 식별(MusicBrainz) — Vaundy [114b26ff-a1fe-41f3-9df8-5c093afe9c56] JP
- **NA** 올바른 곡 후보 표시 — 후보 0개 중 일치 없음 — 한글 제목은 '가수별 곡 찾기'로 직접 고르는 경로를 확인
- **BLOCKED** 아티스트별 곡 목록 조회 — 서비스 오류 응답: MusicBrainz 400
- **NA** 곡 선택 후 가사 조회 — 곡 목록에서 곡을 고르지 못해 건너뜀
- **NA** 싱크 가사 여부 — 가사 후보 없음
- **NA** 사용자가 곡을 선택할 수 있음 — 곡 목록 없음

## [2] 무희 / VAUNDY
앱 검색 결과: needs-choice

요청:
- LRCLIB `/api/search?track_name=무희&artist_name=VAUNDY` → 200 (582ms)
- LRCLIB `/api/search?q=무희+VAUNDY` → 503 (583ms)
- LRCLIB `/api/search?q=Vaundy` → 200 (1107ms)
- MusicBrainz `/ws/2/recording?artist=114b26ff-a1fe-41f3-9df8-5c093afe9c56&inc=aliases+artist-credits+releases&limit=100&offset=0&fmt=json` → 400 (246ms)

검사:
- **PASS** 아티스트 식별(MusicBrainz) — Vaundy [114b26ff-a1fe-41f3-9df8-5c093afe9c56] JP
- **PASS** 올바른 곡 후보 표시 — 踊り子 / Vaundy · 아티스트 일치 · 제목 확인 불가 · 후보로 표시(직접 선택)
- **BLOCKED** 아티스트별 곡 목록 조회 — 서비스 오류 응답: MusicBrainz 400
- **NA** 곡 선택 후 가사 조회 — 곡 목록에서 곡을 고르지 못해 건너뜀
- **NA** 싱크 가사 여부 — 가사 후보 없음
- **NA** 사용자가 곡을 선택할 수 있음 — 곡 목록 없음

## [3] Odoriko / Vaundy
앱 검색 결과: synced

요청:
- LRCLIB `/api/search?track_name=Odoriko&artist_name=Vaundy` → 200 (362ms)
- MusicBrainz `/ws/2/recording?artist=114b26ff-a1fe-41f3-9df8-5c093afe9c56&inc=aliases+artist-credits+releases&limit=100&offset=0&fmt=json` → 400 (238ms)

검사:
- **PASS** 아티스트 식별(MusicBrainz) — Vaundy [114b26ff-a1fe-41f3-9df8-5c093afe9c56] JP
- **PASS** 올바른 곡 후보 표시 — odoriko / Vaundy · 아티스트 일치 · 제목 일치 · 자동 선택됨
- **BLOCKED** 아티스트별 곡 목록 조회 — 서비스 오류 응답: MusicBrainz 400
- **NA** 곡 선택 후 가사 조회 — 곡 목록에서 곡을 고르지 못해 건너뜀
- **NA** 싱크 가사 여부 — 가사 후보 없음
- **NA** 사용자가 곡을 선택할 수 있음 — 곡 목록 없음

## [4] 踊り子 / Vaundy
앱 검색 결과: synced

요청:
- LRCLIB `/api/search?track_name=踊り子&artist_name=Vaundy` → 200 (336ms)
- MusicBrainz `/ws/2/recording?artist=114b26ff-a1fe-41f3-9df8-5c093afe9c56&inc=aliases+artist-credits+releases&limit=100&offset=0&fmt=json` → 400 (237ms)

검사:
- **PASS** 아티스트 식별(MusicBrainz) — Vaundy [114b26ff-a1fe-41f3-9df8-5c093afe9c56] JP
- **PASS** 올바른 곡 후보 표시 — 踊り子 / Vaundy · 아티스트 일치 · 제목 일치 · 자동 선택됨
- **BLOCKED** 아티스트별 곡 목록 조회 — 서비스 오류 응답: MusicBrainz 400
- **NA** 곡 선택 후 가사 조회 — 곡 목록에서 곡을 고르지 못해 건너뜀
- **NA** 싱크 가사 여부 — 가사 후보 없음
- **NA** 사용자가 곡을 선택할 수 있음 — 곡 목록 없음

## [5] 너는 록을 듣지 않아 / 아이묭
앱 검색 결과: API_ERROR(server)

요청:
- LRCLIB `/api/search?track_name=너는+록을+듣지+않아&artist_name=아이묭` → 503 (590ms)
- LRCLIB `/api/search?track_name=너는+록을+듣지+않아` → 503 (832ms)
- MusicBrainz `/ws/2/artist?query=artist:"あいみょん"+OR+alias:"あいみょん"&limit=8&fmt=json` → 200 (247ms)
- MusicBrainz `/ws/2/recording?artist=908d9ac2-5187-4b9e-b281-601c6afb0791&inc=aliases+artist-credits+releases&limit=100&offset=0&fmt=json` → 400 (234ms)

검사:
- **PASS** 아티스트 식별(MusicBrainz) — あいみょん [908d9ac2-5187-4b9e-b281-601c6afb0791] JP
- **BLOCKED** 올바른 곡 후보 표시 — 모든 검색 요청 실패 (503)
- **BLOCKED** 아티스트별 곡 목록 조회 — 서비스 오류 응답: MusicBrainz 400
- **NA** 곡 선택 후 가사 조회 — 곡 목록에서 곡을 고르지 못해 건너뜀
- **NA** 싱크 가사 여부 — 가사 후보 없음
- **NA** 사용자가 곡을 선택할 수 있음 — 곡 목록 없음

## [6] 君はロックを聴かない / あいみょん
앱 검색 결과: synced

요청:
- LRCLIB `/api/search?track_name=君はロックを聴かない&artist_name=あいみょん` → 200 (327ms)
- MusicBrainz `/ws/2/recording?artist=908d9ac2-5187-4b9e-b281-601c6afb0791&inc=aliases+artist-credits+releases&limit=100&offset=0&fmt=json` → 400 (236ms)

검사:
- **PASS** 아티스트 식별(MusicBrainz) — あいみょん [908d9ac2-5187-4b9e-b281-601c6afb0791] JP
- **PASS** 올바른 곡 후보 표시 — 君はロックを聴かない (Live in 阪神甲子園球場, 2022.11.05) / あいみょん · 아티스트 일치 · 제목 일치 · 자동 선택됨
- **BLOCKED** 아티스트별 곡 목록 조회 — 서비스 오류 응답: MusicBrainz 400
- **NA** 곡 선택 후 가사 조회 — 곡 목록에서 곡을 고르지 못해 건너뜀
- **NA** 싱크 가사 여부 — 가사 후보 없음
- **NA** 사용자가 곡을 선택할 수 있음 — 곡 목록 없음

요약: PASS 10 · FAIL 0 · BLOCKED 7 · NA 19
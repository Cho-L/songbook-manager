# 자동 가사 검색 + 자동 싱크 — 조사와 설계

## 1. 방식 비교 (현재 환경 기준, 정확도·비용은 일반적인 기대치이며 이 프로젝트에서 측정한 값이 아님)

| 방식 | 한국어 | 정확도(기대) | 비용 | 서버 필요 | 구현 난이도 | 라이선스/약관 |
|---|---|---|---|---|---|---|
| 외부 synced lyrics API (LRCLIB) | 곡에 따라 있음(커뮤니티 DB, 인기곡 위주) | 줄 단위, 원곡 기준 시간. 곡마다 품질 편차 | 무료, 키 없음 | 불필요(브라우저에서 직접 호출 가능, CORS는 배포 환경에서 확인 필요) | 낮음 | 서비스 이용 조건 확인 필요. 가사 저작권은 권리자에게 있음 → 서버에 모으지 않고 사용자 브라우저에만 캐시 |
| Whisper / faster-whisper (ASR) | 지원 | 말하기엔 좋지만 노래·반주 섞인 음원은 오인식 많음. 가사를 모르는 상태의 전사라 싱크용으로는 약함 | GPU/CPU 시간 | 필요 | 중간 | MIT |
| Forced alignment (알려진 가사 + 음성) | 모델 의존 (wav2vec2 계열 한국어 모델 존재, MFA 한국어 모델 존재) | 알려진 가사를 맞추는 방식이라 가장 적합. 보컬이 깨끗해야 정확 | 중간 | 필요 | 중간~높음 | 모델마다 다름 (예: MMS 계열 모델은 비상업 라이선스 제약 가능 → 사용 전 확인) |
| 보컬 분리 + 정렬 (Demucs 등 → forced alignment) | 정렬 모델 의존 | 가장 높은 기대치. 처리 시간·자원 큼 | GPU 권장 | 필요 | 높음 | 도구별 확인 필요 |
| Web Audio (브라우저) | - | YouTube iframe 오디오는 교차 출처라 접근 불가. 사용자가 올린 파일만 분석 가능 | 없음 | 불필요 | 중간 | - |

**YouTube 오디오:** 영상 오디오를 내려받아 분석하는 방식은 약관/기술 모두 가정하지 않는다. 기준(reference) 오디오는 사용자가 합법적으로 제공한 파일이어야 한다.

## 2. 1차 구현으로 선택한 것

외부 synced lyrics provider(LRCLIB) → 줄 정렬 → MR 시간 보정(수동/대응점) 입니다.
- 서버/GPU 없이 지금 실행 가능하고, 한국어 곡도 데이터가 있는 만큼 즉시 동작한다.
- 한계: 원곡 기준 시간이라 MR 의 intro/템포가 다르면 어긋난다 → 길이 차이 안내 + 보정 UI.

## 3. MR 처리
MR 오디오만으로는 가수가 언제 부르는지 알 수 없다. 그래서
`제목+가수 → 원곡 기준 싱크 → (길이 비교 안내) → 전체 이동(offset) / 비율(ratio) 보정 → MR 타임라인`.
균등 분배·임의 시간은 만들지 않는다. 자동으로 offset/ratio 를 추정하려면 보컬 포함 기준 오디오 + 정렬 백엔드가 필요하다(아래 4).

## 4. 장기: 정렬 백엔드 계약 (RemoteAlignmentSynchronizer)
`POST VITE_LYRICS_ALIGN_URL`
요청 `{ title, artist, lyrics, language, referenceAudioUrl }`
응답 `{ status: "synced"|"partially-synced"|"unsynced"|"failed", confidence?, lines: [{ time|null, text, matched, confidence?, words?: [{ time, text }] }] }`
응답은 `validateLines`(NaN/음수/역순/너무 적은 줄)로 검증하고, 실패하면 결과를 쓰지 않는다. 설정/기준 오디오가 없으면 호출하지 않는다.

## 5. 데이터 구조 (단어/글자 단위 확장 대비)
`SyncedLyricLine { time|null, text, matched, confidence?, words?: [{ time, text }] }`
Enhanced LRC(`<mm:ss.xx>`)는 파싱해서 words 로 보존한다. 현재 화면은 줄 단위만 사용한다(기존 파서와 호환).

## 6. 캐시
`localStorage["songbook:lyrics-sync:v1:{songId}"]` — 제목/가수/저장된 가사 해시가 바뀌면 폐기, 부정 결과(못 찾음 등)는 24시간, MR 보정값은 영상(youtubeVideoId)별. 실패(네트워크)는 캐시하지 않는다.

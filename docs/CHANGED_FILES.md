# 변경 파일 목록 (원본 `orig-copy` 대비, 1~3단계 누적)

## Phase 3 에서 만들거나 고친 파일
- src/utils/overlayStudio.ts
- src/utils/queueOverlay.ts (확장)
- src/services/overlayConfigRepository.ts
- src/hooks/useOverlayConfig.ts
- src/components/overlay/QueueOverlayView.tsx
- src/pages/OverlayStudioPage.tsx
- src/pages/QueueOverlayPage.tsx (cfg=1 지원)
- src/pages/OverlayPage.tsx (kind=song|lyrics, cfg=1)
- src/server/overlayConfigHandler.ts
- src/server/songRequestHandler.ts (rpc/json export)
- workers/worker.js (/api/overlay-config)
- src/App.tsx (라우트 3개)
- src/pages/HomePage.tsx, RequestQueuePage.tsx (진입 링크)
- supabase/migrations/20261013_overlay_configs.sql / _rollback.sql
- tests/overlayStudio.test.ts, tests/sql/overlay-configs.test.mjs
- docs/overlay-studio-deploy.md

## 원본 대비 수정된 파일 (전체 누적)
- src/App.tsx
- src/components/layout/SearchBar.tsx
- src/components/overlay/OverlayView.tsx
- src/components/song/AutoLyricsBar.tsx
- src/hooks/useAutoLyrics.ts
- src/index.css
- src/lyrics/matching.ts
- src/lyrics/pipeline.ts
- src/lyrics/providers/lrclib.ts
- src/lyrics/searchPlan.ts
- src/lyrics/types.ts
- src/lyrics/warp.ts
- src/pages/HomePage.tsx
- src/pages/OverlayPage.tsx
- src/pages/OverlaySettingsPage.tsx
- src/pages/SongFormPage.tsx
- src/pages/SongModePage.tsx
- src/services/songRepository.ts
- src/services/supabaseClient.ts
- src/services/youtubeService.ts
- src/types/overlay.ts
- src/types/song.ts
- src/utils/backup.ts
- src/utils/importNormalize.ts
- src/utils/liveBroadcast.ts
- src/utils/search.ts
- workers/worker.js

## 원본에 없던 새 파일/디렉터리 (전체 누적)
- docs/broadcast-stage2-6-design.md
- docs/overlay-studio-deploy.md
- docs/song-requests-deploy.md
- tests/ (디렉터리)
- src/components/overlay/QueueOverlayView.tsx
- src/components/song/BookMrBatchDialog.tsx
- src/components/song/ImportMrSection.tsx
- src/components/song/MrCandidatePicker.tsx
- src/data/aliasSeed.ts
- src/hooks/useFloatingPlayerLayout.ts
- src/hooks/useImeSafeInput.ts
- src/hooks/useOverlayConfig.ts
- src/hooks/useRequesterName.ts
- src/lyrics/providers/musicbrainz.ts
- src/pages/OverlayStudioPage.tsx
- src/pages/QueueOverlayPage.tsx
- src/pages/RequestQueuePage.tsx
- src/pages/SongRequestPage.tsx
- src/services/overlayConfigRepository.ts
- src/services/songRequestRepository.ts
- src/utils/floatingPlayer.ts
- src/utils/listParams.ts
- src/utils/mrBatch.ts
- src/utils/mrSearch.ts
- src/utils/overlayStudio.ts
- src/utils/queueOverlay.ts
- src/utils/searchNormalize.ts
- src/utils/songAliases.ts
- src/utils/songRequest.ts
- src/server
- supabase/migrations

> 원본에는 Git 정보가 없어 diff 는 폴더 비교(`diff -rq`) 기준입니다.


## Phase 3.1 (가사 검색·적용·한글 발음)
신규: `src/lyrics/errors.ts`, `src/lyrics/apply.ts`, `src/lyrics/pronunciation/{hangul,kana,english,index}.ts`, `src/components/song/{LyricsCandidatePanel,PronunciationPanel}.tsx`, `src/utils/songInput.ts`, `tests/lyrics-phase31.test.ts`, `docs/lyrics-phase31.md`
수정: `src/lyrics/{searchPlan,pipeline,matching,text,artist,types}.ts`, `src/lyrics/providers/{lrclib,musicbrainz}.ts`, `src/hooks/useAutoLyrics.ts`, `src/components/song/AutoLyricsBar.tsx`, `src/utils/{lyrics,liveBroadcast}.ts`, `src/types/overlay.ts`, `src/components/overlay/OverlayView.tsx`, `src/pages/{SongModePage,SongDetailPage,ConcertModePage,OverlayStudioPage,OverlaySettingsPage}.tsx`, `src/App.tsx`, `package.json`(+`cmu-pronouncing-dictionary`)


## Phase 3.2 (실시간 가사 싱크 · 노래방 UX)
신규: `src/lyrics/lyricOffset.ts`, `src/hooks/useLyricOffset.ts`, `src/utils/liveClock.ts`, `src/hooks/useClockedLive.ts`, `tests/liveSync.test.ts`, `docs/lyrics-sync-phase32.md`
수정: `src/hooks/useYouTubePlayer.ts`, `src/hooks/useLivePublisher.ts`, `src/utils/liveBroadcast.ts`, `src/pages/{SongModePage,ConcertModePage,OverlayPage}.tsx`, `tests/lyrics-phase31.test.ts`
DB/스키마 변경: 없음


## Phase 3.3 (최종 통합 품질 개선)
신규: `src/lyrics/pronunciation/{japanese,tokenizer}.ts`, `src/lyrics/loanword.ts`, `src/hooks/usePronDraft.ts`, `tests/lyrics-phase33.test.ts`, `docs/lyrics-phase33.md`, `public/_headers`
수정: `src/lyrics/pronunciation/{kana,index}.ts`, `src/lyrics/{matching,text,types,lyricOffset}.ts`, `src/hooks/{useAutoLyrics,useLyricOffset}.ts`, `src/components/song/{PronunciationPanel,LyricsCandidatePanel}.tsx`, `src/pages/SongModePage.tsx`, `vite.config.ts`(사전 복사 플러그인), `package.json`(+`@patdx/kuromoji`), `tests/lyrics-phase31.test.ts`
DB/스키마 변경: 없음

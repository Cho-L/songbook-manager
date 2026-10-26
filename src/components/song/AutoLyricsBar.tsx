import { useState } from "react";
import { Link } from "react-router-dom";
import type { useAutoLyrics } from "../../hooks/useAutoLyrics";
import { describeStatus } from "../../hooks/useAutoLyrics";
import { setAutoLyricsEnabled } from "../../lyrics/cache";
import { LyricsCandidatePanel } from "./LyricsCandidatePanel";
import { ArtistSongBrowser } from "./ArtistSongBrowser";
import { LyricsSearchDiagnostics } from "./LyricsSearchDiagnostics";
import { PronunciationPanel } from "./PronunciationPanel";
import { SYNC_STEP_TENTHS, formatOffset, formatStep, readSyncStep, writeSyncStep } from "../../lyrics/warp";

type Auto = ReturnType<typeof useAutoLyrics>;

interface AutoLyricsBarProps {
  auto: Auto;
  /** 현재 MR 재생 시간(초) — "첫 소절 시작에 맞추기"에 쓴다 */
  currentTime: number;
  /** MR 영상 길이(초). 모르면 0 */
  mrDuration: number;
  /** 곡 상세 화면처럼 켜기/끄기와 결과 지우기까지 보여줄지 */
  showManage?: boolean;
}

const btn =
  "rounded-lg border px-3 min-h-[36px] text-[12.5px] transition-[filter] hover:brightness-125 active:brightness-95 disabled:opacity-40";
const btnStyle = { borderColor: "rgba(128,128,128,0.35)", backgroundColor: "rgba(128,128,128,0.12)", color: "inherit" } as const;

/**
 * 자동 가사/싱크 상태 표시 + (필요할 때만) 후보 선택·싱크 보정.
 * 글자 색은 부모(SongMode 설정색/노래책 색)를 그대로 따라가도록 inherit + 투명도만 쓴다.
 */
export function AutoLyricsBar({ auto, currentTime, mrDuration, showManage }: AutoLyricsBarProps) {
  const [tuning, setTuning] = useState(false);
  const [msg, setMsg] = useState("");
  const [showMore, setShowMore] = useState(false);
  // 한 번 누를 때 움직일 간격(0.1~1.0초). 현재 누적 보정값(auto.warp.offset)과는 완전히 별개라서 간격을 바꿔도 보정값은 그대로다.
  const [stepTenths, setStepTenths] = useState(readSyncStep);
  const status = describeStatus({
    searching: auto.searching,
    error: auto.error,
    entry: auto.entry,
    ownSynced: auto.ownSynced,
    enabled: auto.enabled,
    mrDuration,
    videoId: auto.rawSong?.youtubeVideoId,
  });

  const canTune = auto.applied && (auto.entry?.outcome === "synced" || auto.entry?.outcome === "partial");
  const showRetry = ["failed", "not-found", "mismatch", "no-sync"].includes(status.kind);
  const nothing = status.kind === "off" && !showManage;
  if (nothing) return null;
  const offset = auto.warp.offset;

  return (
    <div className="max-w-2xl mx-auto mb-4 text-[13px]" data-testid="auto-lyrics" style={{ color: "inherit" }}>
      {status.kind !== "off" && (
        <div role="status" data-testid="auto-lyrics-status" data-kind={status.kind} className="opacity-80">
          {status.text}
        </div>
      )}
      {status.detail && (
        <details className="mt-0.5">
          <summary className="cursor-pointer select-none text-[12px] opacity-50 hover:opacity-80 min-h-[24px] inline-flex items-center">자세히 보기</summary>
          <div className="text-[12px] opacity-60" data-testid="auto-lyrics-detail">
            {status.detail}
          </div>
        </details>
      )}
      {status.notes.map((n, i) => (
        <div key={i} className="opacity-60 text-[12px] mt-0.5" data-testid="auto-lyrics-note">
          {n}
        </div>
      ))}

      <LyricsSearchDiagnostics enabled={auto.diagnosticsEnabled ?? false} requests={auto.diagnostics ?? []}
        onToggle={(enabled) => auto.setDiagnosticsEnabled(enabled)} />

      {status.kind === "needs-choice" && auto.entry?.options && (
        <LyricsCandidatePanel auto={auto} mrDuration={mrDuration} ids={auto.entry.options.map((o) => o.id)} />
      )}
      {showMore && status.kind !== "needs-choice" && <LyricsCandidatePanel auto={auto} mrDuration={mrDuration} />}

      {(showMore || status.kind === "needs-choice" || status.kind === "not-found") && !auto.ownSynced && <ArtistSongBrowser key={auto.rawSong?.id} auto={auto} mrDuration={mrDuration} />}

      <div className="flex flex-wrap items-center gap-2 mt-2">
        {canTune && (
          <button type="button" className={btn} style={btnStyle} aria-expanded={tuning} onClick={() => setTuning((v) => !v)}>
            싱크 보정{Math.abs(offset) > 0.001 ? ` (${formatOffset(offset)})` : ""}
          </button>
        )}
        {["not-found", "no-sync", "lyrics-only", "mismatch"].includes(status.kind) && auto.canSave && auto.rawSong && (
          <Link className={btn + " inline-flex items-center"} style={btnStyle}
            to={`/books/${encodeURIComponent(auto.rawSong.ownerId)}/songs/${encodeURIComponent(auto.rawSong.id)}/edit`}>
            가사·LRC 직접 입력
          </Link>
        )}
        {showRetry && (
          <button type="button" className={btn} style={btnStyle} onClick={() => void auto.refresh()}>
            다시 찾기
          </button>
        )}
        {(!auto.ownSynced || showManage) && status.kind !== "needs-choice" && status.kind !== "searching" && (
          <button
            type="button"
            className={btn}
            style={btnStyle}
            data-testid="cand-toggle"
            onClick={() => {
              setShowMore((v) => !v);
              if (!showMore && auto.candidates.length === 0) void auto.loadCandidates();
            }}
          >
            {showMore ? "후보 닫기" : "다른 가사 후보 보기"}
          </button>
        )}
        {showManage && (
          <>
            {auto.entry && (
              <button type="button" className={btn} style={btnStyle} onClick={() => auto.clear()}>
                자동 결과 지우기
              </button>
            )}
            {!auto.entry && !auto.searching && !auto.ownSynced && (
              <button type="button" className={btn} style={btnStyle} onClick={() => void auto.refresh()}>
                가사 자동 찾기
              </button>
            )}
          </>
        )}
      </div>

      {canTune && tuning && (
        <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="싱크 보정">
          <div className="basis-full flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="한 번에 조절할 간격">
            <span className="opacity-70 text-[12px] mr-1">조절 간격</span>
            {SYNC_STEP_TENTHS.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={stepTenths === t}
                data-testid={`sync-step-${t}`}
                className={`${btn} !px-2.5 min-w-[44px] ${stepTenths === t ? "!border-amber-400/70 !bg-amber-400/20 text-amber-500 font-semibold" : ""}`}
                style={stepTenths === t ? undefined : btnStyle}
                onClick={() => {
                  setStepTenths(t);
                  writeSyncStep(t);
                }}
              >
                {(t / 10).toFixed(1)}
              </button>
            ))}
            <span className="opacity-50 text-[11.5px]">초</span>
          </div>
          <button type="button" className={btn} style={btnStyle} onClick={() => auto.nudge(stepTenths, -1)} aria-label={`가사를 ${formatStep(stepTenths)} 먼저`}>
            −{formatStep(stepTenths)} <span className="opacity-60">(가사 빠르게)</span>
          </button>
          <button type="button" className={btn} style={btnStyle} onClick={() => auto.nudge(stepTenths, 1)} aria-label={`가사를 ${formatStep(stepTenths)} 늦게`}>
            +{formatStep(stepTenths)} <span className="opacity-60">(가사 늦게)</span>
          </button>
          <button
            type="button"
            className={btn}
            style={btnStyle}
            onClick={() => setMsg(auto.anchorFirstLine(currentTime) ? "첫 소절 시작 시간에 맞췄어요" : "보정할 수 없어요 (값이 너무 달라요)")}
          >
            지금이 첫 소절 시작
          </button>
          <button type="button" className={btn} style={btnStyle} onClick={() => auto.resetWarp()}>
            초기화
          </button>
          <span className="basis-full opacity-55 text-[11.5px]">
            가사가 노래보다 먼저 나오면 "가사 늦게", 늦게 나오면 "가사 빠르게"를 눌러 맞춰요. MR의 인트로가 원곡과 다를 때 쓰면 좋아요.
          </span>
          <span data-testid="auto-lyrics-offset" className="opacity-70 text-[12px]">
            보정 {formatOffset(offset)}
          </span>
          {msg && (
            <span role="status" className="opacity-70 text-[12px]">
              {msg}
            </span>
          )}
        </div>
      )}

      {(showManage || auto.canSave) && <PronunciationPanel auto={auto} />}

      {showManage && (
        <label className="flex items-center gap-2 mt-3 text-[12.5px] opacity-80 cursor-pointer min-h-[32px]">
          <input type="checkbox" checked={auto.enabled} onChange={(e) => setAutoLyricsEnabled(e.target.checked)} className="h-4 w-4" />
          이 브라우저에서 자동 가사 검색 사용
        </label>
      )}
      {showManage && (
        <p className="text-[11.5px] opacity-50 mt-1">
          저장된 싱크 가사가 없는 곡에서만, 곡 제목과 가수를 가사 서비스(LRCLIB)로 보내 검색해요. 한글 곡을 못 찾으면 영문 표기를 확인하려고 음악 정보 서비스(MusicBrainz)에도 제목과 가수를 보내 조회해요. 결과는 이 브라우저에만 저장되고 노래 데이터는 바뀌지 않아요.
        </p>
      )}
    </div>
  );
}

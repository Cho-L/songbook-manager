import { useState } from "react";
import type { useAutoLyrics } from "../../hooks/useAutoLyrics";
import { describeStatus } from "../../hooks/useAutoLyrics";
import { setAutoLyricsEnabled } from "../../lyrics/cache";

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
      {status.notes.map((n, i) => (
        <div key={i} className="opacity-60 text-[12px] mt-0.5" data-testid="auto-lyrics-note">
          {n}
        </div>
      ))}

      {status.kind === "needs-choice" && auto.entry?.options && (
        <ul className="mt-2 flex flex-col gap-1.5" aria-label="가사 후보">
          {auto.entry.options.map((o) => (
            <li key={o.id}>
              <button type="button" className={`${btn} w-full text-left`} style={btnStyle} onClick={() => void auto.choose(o.id)} data-testid="auto-lyrics-option">
                {o.title} — {o.artist || "가수 미상"}
                <span className="opacity-60">
                  {" "}
                  · {o.hasSynced ? "싱크 있음" : "가사만"}
                  {o.duration ? ` · ${Math.floor(o.duration / 60)}:${String(Math.round(o.duration % 60)).padStart(2, "0")}` : ""} · 일치 {Math.round(o.confidence * 100)}%
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-2">
        {canTune && (
          <button type="button" className={btn} style={btnStyle} aria-expanded={tuning} onClick={() => setTuning((v) => !v)}>
            싱크 보정{Math.abs(offset) > 0.001 ? ` (${offset > 0 ? "+" : ""}${offset.toFixed(1)}초)` : ""}
          </button>
        )}
        {showRetry && (
          <button type="button" className={btn} style={btnStyle} onClick={() => void auto.refresh()}>
            다시 찾기
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
          <button type="button" className={btn} style={btnStyle} onClick={() => auto.nudge(-0.5)} aria-label="가사를 0.5초 먼저">
            −0.5초
          </button>
          <button type="button" className={btn} style={btnStyle} onClick={() => auto.nudge(0.5)} aria-label="가사를 0.5초 늦게">
            +0.5초
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
          <span data-testid="auto-lyrics-offset" className="opacity-70 text-[12px]">
            보정 {offset > 0 ? "+" : ""}
            {offset.toFixed(2)}초
          </span>
          {msg && (
            <span role="status" className="opacity-70 text-[12px]">
              {msg}
            </span>
          )}
        </div>
      )}

      {showManage && (
        <label className="flex items-center gap-2 mt-3 text-[12.5px] opacity-80 cursor-pointer min-h-[32px]">
          <input type="checkbox" checked={auto.enabled} onChange={(e) => setAutoLyricsEnabled(e.target.checked)} className="h-4 w-4" />
          이 브라우저에서 자동 가사 검색 사용
        </label>
      )}
      {showManage && (
        <p className="text-[11.5px] opacity-50 mt-1">
          저장된 싱크 가사가 없는 곡에서만, 곡 제목과 가수를 가사 서비스(LRCLIB)로 보내 검색해요. 결과는 이 브라우저에만 저장되고 노래 데이터는 바뀌지 않아요.
        </p>
      )}
    </div>
  );
}

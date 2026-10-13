import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { useAutoLyrics } from "../../hooks/useAutoLyrics";
import type { ApplyMode } from "../../lyrics/apply";
import { hasLyricTracks } from "../../utils/lyrics";
import { formatTimestamp } from "../../lyrics/lrc";

type Auto = ReturnType<typeof useAutoLyrics>;

const btn = "rounded-lg border px-3 min-h-[36px] text-[12.5px] transition-[filter] hover:brightness-125 active:brightness-95 disabled:opacity-40";
const btnStyle = { borderColor: "rgba(128,128,128,0.35)", backgroundColor: "rgba(128,128,128,0.12)", color: "inherit" } as const;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/**
 * 후보 목록 → 전체 가사 미리보기 → 적용.
 * 미리보기는 후보 검색 때 이미 받은 가사 본문을 그대로 쓴다(추가 요청 없음). 저장은 관리자만 할 수 있다.
 */
export function LyricsCandidatePanel({ auto, mrDuration, ids }: { auto: Auto; mrDuration: number; ids?: string[] }) {
  const { ownerId } = useParams();
  const [openId, setOpenId] = useState<string | null>(null);
  const [mode, setMode] = useState<ApplyMode>("replace");
  const [confirming, setConfirming] = useState(false);
  const own = (auto.rawSong?.lyrics ?? "").trim();

  const list = ids ? auto.candidates.filter((c) => ids.includes(c.id)) : auto.candidates.slice(0, 8);
  if (list.length === 0) {
    return (
      <div className="mt-2 text-[12px] opacity-70" data-testid="cand-empty">
        {auto.listing ? "후보를 불러오는 중이에요..." : (
          <button type="button" className={btn} style={btnStyle} onClick={() => void auto.loadCandidates()} data-testid="cand-load">
            후보 불러오기
          </button>
        )}
      </div>
    );
  }
  const preview = openId ? auto.previewOf(openId, mrDuration || undefined) : null;

  return (
    <div className="mt-2" data-testid="cand-panel">
      <ul className="flex flex-col gap-1.5" aria-label="가사 후보">
        {list.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className={`${btn} w-full text-left`}
              style={btnStyle}
              aria-expanded={openId === c.id}
              data-testid="cand-item"
              onClick={() => {
                setOpenId(openId === c.id ? null : c.id);
                setConfirming(false);
                setMode("replace");
              }}
            >
              {c.title} — {c.artist || "가수 미상"}
              <span className="opacity-60">
                {" "}· {c.syncedLyrics ? "싱크 있음" : "가사만 (싱크 없음)"}
                {c.duration ? ` · ${mmss(c.duration)}` : ""} · 일치 {Math.round(c.confidence * 100)}%
              </span>
            </button>
            {openId === c.id && preview && (
              <div className="mt-1 rounded-lg border p-3" style={{ borderColor: "rgba(128,128,128,0.35)" }} data-testid="cand-preview">
                <div className="text-[12.5px]">
                  <b>{preview.title}</b> — {preview.artist || "가수 미상"}
                  <span className="opacity-60"> · 출처 {preview.source}</span>
                </div>
                <div className="text-[12px] opacity-75 mt-0.5" data-testid="cand-meta">
                  {preview.synced ? `싱크 있음 · ${preview.lineCount}줄` : `싱크 없음 · ${preview.lineCount}줄`}
                  {preview.duration ? ` · 원곡 ${mmss(preview.duration)}` : ""}
                  {mrDuration ? ` · MR ${mmss(mrDuration)}` : ""}
                  {preview.durationDiff !== undefined ? ` · 길이 차이 ${preview.durationDiff > 0 ? "+" : ""}${Math.round(preview.durationDiff)}초` : ""}
                  {preview.lastTime !== undefined ? ` · 마지막 줄 ${mmss(preview.lastTime)}` : ""}
                </div>
                {preview.warnings.map((w, i) => (
                  <div key={i} className="text-[12px] mt-0.5 text-amber-500" data-testid="cand-warning">⚠ {w}</div>
                ))}
                <div className="mt-2 max-h-56 overflow-y-auto rounded border p-2 text-[12.5px] leading-relaxed" style={{ borderColor: "rgba(128,128,128,0.25)" }} data-testid="cand-lines" tabIndex={0}>
                  {preview.lines.map((l, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="shrink-0 w-[58px] opacity-50 font-mono text-[11.5px]">{l.time !== null ? formatTimestamp(l.time).slice(0, 8) : ""}</span>
                      <span className="break-words min-w-0">{l.text || " "}</span>
                    </div>
                  ))}
                </div>

                {!preview.synced && (
                  <p className="text-[12px] opacity-70 mt-2" data-testid="cand-nosync">
                    이 가사에는 시간 정보가 없어요. 적용하면 가사만 보이고, 시간은 <Link className="underline" to={ownerId && auto.rawSong ? `/books/${ownerId}/songs/${auto.rawSong.id}/edit` : "#"}>곡 수정 화면</Link>에서 직접 [분:초] 태그로 맞출 수 있어요.
                  </p>
                )}

                {own && preview.alignedText && (
                  <div className="mt-2 flex flex-col gap-1 text-[12.5px]" role="radiogroup" aria-label="적용 방식">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="apply-mode" checked={mode === "replace"} onChange={() => setMode("replace")} /> 찾은 가사로 교체
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="apply-mode" checked={mode === "align"} onChange={() => setMode("align")} data-testid="mode-align" />
                      내가 저장한 가사 유지 + 시간만 입히기 ({Math.round((preview.alignedCoverage ?? 0) * 100)}% 일치)
                    </label>
                  </div>
                )}

                <div className="mt-2 flex flex-wrap gap-2">
                  {auto.canSave && !confirming && (
                    <button
                      type="button"
                      className={btn}
                      style={btnStyle}
                      disabled={auto.applying}
                      data-testid="cand-apply"
                      onClick={() => (own ? setConfirming(true) : void auto.applyCandidate(c.id, mode))}
                    >
                      이 가사 적용 (곡에 저장)
                    </button>
                  )}
                  {auto.canSave && confirming && (
                    <>
                      <span className="basis-full text-[12px] text-amber-500" data-testid="cand-confirm-text">
                        이미 저장된 가사가 있어요. {mode === "align" ? "저장된 가사에 시간 정보를 더해" : "찾은 가사로 바꿔"} 저장해요. {mode === "replace" && hasLyricTracks(own) ? "저장된 한글 발음 줄도 함께 사라져요. " : ""}이전 가사는 이 브라우저에 백업돼서 되돌릴 수 있어요.
                      </span>
                      <button type="button" className={btn} style={btnStyle} disabled={auto.applying} data-testid="cand-confirm" onClick={() => void auto.applyCandidate(c.id, mode).then(() => setConfirming(false))}>
                        덮어쓰고 저장
                      </button>
                      <button type="button" className={btn} style={btnStyle} onClick={() => setConfirming(false)}>
                        취소
                      </button>
                    </>
                  )}
                  <button type="button" className={btn} style={btnStyle} onClick={() => void auto.choose(c.id)} data-testid="cand-local">
                    이 브라우저에서만 임시 적용
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {auto.applyMsg && (
        <div role="status" data-testid="cand-msg" data-kind={auto.applyMsg.kind} className={`mt-2 text-[12.5px] ${auto.applyMsg.kind === "error" ? "text-red-400" : "opacity-80"}`}>
          {auto.applyMsg.text}
          {auto.applyMsg.kind === "ok" && auto.hasBackup && auto.canSave && (
            <button type="button" className="ml-2 underline" data-testid="cand-undo" onClick={() => void auto.undoApply()}>
              되돌리기
            </button>
          )}
        </div>
      )}
    </div>
  );
}

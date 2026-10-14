import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { useAutoLyrics } from "../../hooks/useAutoLyrics";
import type { ApplyMode } from "../../lyrics/apply";
import { formatLyricsWithTracks, hasLyricTracks } from "../../utils/lyrics";
import type { CandidatePreview } from "../../lyrics/apply";
import { usePronDraft } from "../../hooks/usePronDraft";
import { formatTimestamp } from "../../lyrics/lrc";
import { isSavablePron } from "../../lyrics/pronunciation";
import { LEVEL_LABEL } from "../../lyrics/matching";

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
              }}
            >
              {c.title} — {c.artist || "가수 미상"}
              <span className="opacity-60">
                {" "}· {c.syncedLyrics ? "싱크 있음" : "가사만 (싱크 없음)"}
                {c.duration ? ` · ${mmss(c.duration)}` : ""}
              </span>
              <span className="block text-[11.5px] opacity-70" data-testid="cand-evidence" data-level={c.evidence?.level}>
                {c.evidence ? `${c.evidence.label} · ${LEVEL_LABEL[c.evidence.level]}` : ""}
              </span>
            </button>
            {openId === c.id && preview && <CandidateDetail key={c.id} auto={auto} preview={preview} candId={c.id} mrDuration={mrDuration} ownerId={ownerId} />}
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

function CandidateDetail({ auto, preview, candId, mrDuration, ownerId }: { auto: Auto; preview: CandidatePreview; candId: string; mrDuration: number; ownerId?: string }) {
  const [mode, setMode] = useState<ApplyMode>("replace");
  const [confirming, setConfirming] = useState(false);
  const [includePron, setIncludePron] = useState(true);
  const [saving, setSaving] = useState(false);
  const own = (auto.rawSong?.lyrics ?? "").trim();
  const evidence = auto.candidates.find((x) => x.id === candId)?.evidence;
  const texts = preview.lines.map((l) => l.text);
  const pron = usePronDraft(texts, auto.canSave && mode === "replace" && includePron);
  const withPron = pron.enabled && mode === "replace" && includePron;

  // 저장할 텍스트: 교체 모드에서 발음을 함께 저장할 때만 직접 만든다 (원문·시간은 후보 그대로)
  async function doApply(): Promise<void> {
    if (saving) return; // 중복 저장 방지
    setSaving(true);
    try {
      let override: string | undefined;
      if (withPron && !pron.loading) {
        const hasAny = pron.prons.some((p) => p);
        if (hasAny) override = formatLyricsWithTracks(preview.lines.map((l, i) => ({ time: l.time, text: l.text, pron: pron.prons[i] || undefined })));
      }
      await auto.applyCandidate(candId, mode, override);
    } finally {
      setSaving(false);
    }
  }

  return (
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
                {evidence && (
                  <div className="text-[12px] opacity-75 mt-0.5" data-testid="cand-evidence-detail">
                    일치 근거: {evidence.label}
                    {evidence.notes.map((n) => ` · ${n}`).join("")}
                  </div>
                )}
                {preview.warnings.map((w, i) => (
                  <div key={i} className="text-[12px] mt-0.5 text-amber-500" data-testid="cand-warning">⚠ {w}</div>
                ))}
                {pron.enabled && mode === "replace" && (
                  <div className="mt-2 text-[12.5px]" data-testid="cand-pron">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={includePron} onChange={(e) => setIncludePron(e.target.checked)} data-testid="cand-pron-toggle" /> 한글 발음도 함께 저장
                    </label>
                    {includePron && (
                      <div className="opacity-75 mt-0.5" data-testid="cand-pron-status" data-state={pron.loading ? "loading" : "done"}>
                        {pron.loading
                          ? "한글 발음을 만드는 중이에요..."
                          : `발음 ${pron.counts.ok}줄${pron.counts.review > 0 ? ` · 확인 필요 ${pron.counts.review}줄` : ""}${pron.counts.failed > 0 ? ` · 변환 못 한 ${pron.counts.failed}줄은 발음 없이 저장돼요` : ""}`}
                      </div>
                    )}
                    {includePron && pron.warnings.map((w, i) => (
                      <div key={i} className="text-amber-500" data-testid="cand-pron-warning">
                        ⚠ {w}{" "}
                        <button type="button" className="underline" onClick={() => void pron.regenerate()} disabled={pron.loading} data-testid="cand-pron-retry">
                          다시 시도
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-2 max-h-56 overflow-y-auto rounded border p-2 text-[12.5px] leading-relaxed" style={{ borderColor: "rgba(128,128,128,0.25)" }} data-testid="cand-lines" tabIndex={0}>
                  {preview.lines.map((l, i) => {
                    const r = withPron ? pron.rows[i] : undefined;
                    const showInput = r && (r.lang === "ja" || r.lang === "en") && l.text.trim() !== "";
                    const ok = r ? isSavablePron(r.pron) : true;
                    return (
                      <div key={i} className="flex gap-2">
                        <span className="shrink-0 w-[58px] opacity-50 font-mono text-[11.5px]">{l.time !== null ? formatTimestamp(l.time).slice(0, 8) : ""}</span>
                        <span className="min-w-0 flex-1">
                          <span className="break-words block">{l.text || " "}</span>
                          {r && showInput && (
                            <span className="flex items-center gap-1.5">
                              <input
                                aria-label={`${i + 1}번째 줄 발음`}
                                data-testid="cand-pron-input"
                                data-status={ok ? r.status : "failed"}
                                className="flex-1 min-w-0 rounded border px-1.5 min-h-[28px] text-[12px] bg-transparent"
                                style={{ borderColor: "rgba(128,128,128,0.3)" }}
                                value={r.pron}
                                placeholder={ok ? "" : "직접 입력 (비우면 이 줄은 발음 없이 저장)"}
                                onChange={(e) => pron.edit(i, e.target.value)}
                              />
                              {(!ok || r.status === "review") && (
                                <span className="shrink-0 text-[11px] text-amber-500" title={r.notes.join(" / ")}>
                                  {!ok ? `검토 필요${r.failed?.length ? ` · ${r.failed.join(", ")}` : ""}` : `확인${r.uncertain?.length ? ` · ${r.uncertain.join(", ")}` : ""}`}
                                </span>
                              )}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
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
                      disabled={auto.applying || saving || (withPron && pron.loading)}
                      data-testid="cand-apply"
                      onClick={() => (own ? setConfirming(true) : void doApply())}
                    >
                      {withPron && pron.loading ? "발음 만드는 중..." : "이 가사 적용 (곡에 저장)"}
                    </button>
                  )}
                  {auto.canSave && confirming && (
                    <>
                      <span className="basis-full text-[12px] text-amber-500" data-testid="cand-confirm-text">
                        이미 저장된 가사가 있어요. {mode === "align" ? "저장된 가사에 시간 정보를 더해" : "찾은 가사로 바꿔"} 저장해요. {mode === "replace" && hasLyricTracks(own) ? (withPron ? "저장된 한글 발음 줄은 새 발음으로 바뀌어요. " : "저장된 한글 발음 줄도 함께 사라져요. ") : ""}이전 가사는 이 브라우저에 백업돼서 되돌릴 수 있어요.
                      </span>
                      <button type="button" className={btn} style={btnStyle} disabled={auto.applying || saving || (withPron && pron.loading)} data-testid="cand-confirm" onClick={() => void doApply().then(() => setConfirming(false))}>
                        덮어쓰고 저장
                      </button>
                      <button type="button" className={btn} style={btnStyle} onClick={() => setConfirming(false)}>
                        취소
                      </button>
                    </>
                  )}
                  <button type="button" className={btn} style={btnStyle} onClick={() => void auto.choose(candId)} data-testid="cand-local">
                    이 브라우저에서만 임시 적용
                  </button>
                </div>
              </div>
            );
}

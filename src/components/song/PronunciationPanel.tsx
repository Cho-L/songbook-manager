import { useMemo, useState } from "react";
import type { useAutoLyrics } from "../../hooks/useAutoLyrics";
import { applyPronToRaw, parseLyrics, stripLyricTracks } from "../../utils/lyrics";
import { hasUnconverted, isSavablePron, runPronunciation, type PronLine } from "../../lyrics/pronunciation";

type Auto = ReturnType<typeof useAutoLyrics>;
const btn = "rounded-lg border px-3 min-h-[36px] text-[12.5px] transition-[filter] hover:brightness-125 active:brightness-95 disabled:opacity-40";
const btnStyle = { borderColor: "rgba(128,128,128,0.35)", backgroundColor: "rgba(128,128,128,0.12)", color: "inherit" } as const;

interface Row {
  text: string;
  /** 저장돼 있던 발음 ("" 이면 없음) */
  saved: string;
  /** 새로 만든 자동 발음 (없으면 null) */
  gen: PronLine | null;
  /** 지금 입력칸에 있는 값 = 저장할 값 */
  pron: string;
  /** 사용자가 직접 고쳤는가 */
  edited: boolean;
  selected: boolean;
}

/**
 * 한글 발음 만들기/다시 만들기 → 전후 비교 → 직접 수정 → 저장.
 * - 자동 변환은 초안일 뿐이라 저장 전에 화면에서 확인하게 한다 (자동 저장 없음). 원문·시간은 바꾸지 않는다.
 * - 이미 저장된 발음(사용자가 고친 값일 수 있음)은 덮어쓰지 않고, 새 값은 "제안"으로만 보여 준다. 줄별/전체로 새 값을 고를 수 있고, 덮어쓰기는 한 번 더 확인한다.
 * - 변환 안 된 한자·가나가 남은 줄은 저장할 수 없다 (고치거나 비워야 한다).
 */
export function PronunciationPanel({ auto }: { auto: Auto }) {
  const savedRaw = auto.rawSong?.lyrics ?? "";
  // 저장된 가사가 없고 자동으로 찾은 가사가 적용 중이면, 그 가사를 기준으로 발음을 만들어 함께 저장할 수 있다
  const fromAuto = !savedRaw.trim() && auto.applied && !!auto.song?.lyrics?.trim();
  const raw = fromAuto ? (auto.song?.lyrics ?? "") : savedRaw;
  const lines = useMemo(() => parseLyrics(raw), [raw]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const hasExisting = lines.some((l) => l.pron);

  if (!auto.canSave || lines.every((l) => !l.text.trim())) return null;

  async function generate(only?: number[]) {
    if (busy) return; // 중복 생성 방지
    setBusy(true);
    setWarnings([]);
    setConfirming(false);
    setConfirmAll(false);
    setProgress("준비하는 중...");
    try {
      const texts = lines.map((l) => l.text);
      const { rows: gen, warnings: w } = await runPronunciation(texts, (d, t) => setProgress(`${d}/${t}줄`));
      setWarnings(w);
      setRows((cur) =>
        lines.map((l, i) => {
          const old = cur?.[i];
          const saved = (l.pron ?? "").trim();
          const g = gen[i];
          const isTarget = !only || only.includes(i);
          if (old && !isTarget) return old; // 선택하지 않은 줄은 그대로
          const keepEdited = old?.edited && !only; // 전체 다시 만들 때 이번에 고친 줄은 건드리지 않는다
          const usable = g.pron.trim() !== "";
          const pron = keepEdited ? old!.pron : saved ? (old?.pron ?? saved) : usable ? g.pron : "";
          return { text: l.text, saved, gen: g, pron, edited: !!keepEdited, selected: old?.selected ?? false };
        })
      );
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  const set = (i: number, patch: Partial<Row>) => setRows((cur) => cur && cur.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const proposals = rows?.map((r) => (r.saved && r.gen && r.gen.pron.trim() && isSavablePron(r.gen.pron) && r.gen.pron !== r.saved ? r.gen.pron : null)) ?? [];
  const count = rows?.filter((r) => r.pron.trim()).length ?? 0;
  const reviewCount = rows?.filter((r) => r.gen && (r.gen.status === "review" || r.gen.status === "unsupported") && !r.edited && r.pron === r.gen.pron).length ?? 0;
  const bad = rows?.filter((r) => r.pron.trim() && hasUnconverted(r.pron)).length ?? 0;
  const overwrites = rows?.filter((r) => r.saved && r.pron.trim() !== r.saved).length ?? 0;
  const selectedIdx = rows?.flatMap((r, i) => (r.selected ? [i] : [])) ?? [];

  async function save() {
    if (!rows || bad > 0) return;
    if (overwrites > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    const text = applyPronToRaw(raw, rows.map((r) => (r.pron.trim() && !hasUnconverted(r.pron) ? r.pron : "")));
    if (await auto.saveLyricsText(text, "발음을 저장했어요")) {
      setRows(null);
      setConfirming(false);
    }
  }
  async function removeAll() {
    const text = stripLyricTracks(raw);
    if (await auto.saveLyricsText(text, "발음을 지웠어요")) setRows(null);
  }

  return (
    <div className="mt-3" data-testid="pron-panel">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} style={btnStyle} onClick={() => void generate()} disabled={busy} data-testid="pron-generate">
          {busy ? `만드는 중... ${progress}` : hasExisting ? "한글 발음 다시 만들기" : "한글 발음 만들기"}
        </button>
        {rows && selectedIdx.length > 0 && (
          <button type="button" className={btn} style={btnStyle} onClick={() => void generate(selectedIdx)} disabled={busy} data-testid="pron-regen-selected">
            선택한 {selectedIdx.length}줄만 다시 만들기
          </button>
        )}
        {hasExisting && !rows && (
          <button type="button" className={btn} style={btnStyle} onClick={() => void removeAll()} disabled={auto.applying} data-testid="pron-remove">
            발음 지우기
          </button>
        )}
        {auto.hasBackup && auto.applyMsg?.kind === "ok" && !rows && (
          <button type="button" className={btn} style={btnStyle} onClick={() => void auto.undoApply()} data-testid="pron-undo">
            되돌리기
          </button>
        )}
      </div>
      <p className="text-[11.5px] opacity-55 mt-1">
        일본어(가나·한자)·영어 줄을 한글로 옮긴 <b>초안</b>이에요. 한자 읽기와 영어 발음은 문맥·노래마다 달라서 부정확할 수 있으니 저장 전에 확인하고 고쳐 주세요. 원문과 시간 정보는 바뀌지 않아요.
        {fromAuto ? " 지금은 자동으로 찾은 가사 기준이라, 저장하면 가사도 함께 저장돼요." : ""}
      </p>
      {warnings.map((w, i) => (
        <div key={i} className="text-[12px] text-amber-500 mt-1" data-testid="pron-err">{w}</div>
      ))}
      {rows && (
        <div className="mt-2" data-testid="pron-preview">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-[12px] opacity-75" data-testid="pron-summary">
              발음 {count}줄{reviewCount > 0 ? ` · 확인 필요 ${reviewCount}줄` : ""}{bad > 0 ? ` · 변환 안 된 글자가 있는 ${bad}줄` : ""}
            </span>
            {proposals.some(Boolean) && (
              <>
                <span className="text-[12px] text-amber-500" data-testid="pron-diff-count">새 값이 다른 줄 {proposals.filter(Boolean).length}줄</span>
                {!confirmAll ? (
                  <button type="button" className={btn} style={btnStyle} onClick={() => setConfirmAll(true)} data-testid="pron-use-all">
                    새 값 전부 사용
                  </button>
                ) : (
                  <>
                    <span className="text-[12px] text-amber-500">저장된 발음을 새 값으로 바꿔요. 직접 고친 값도 바뀔 수 있어요.</span>
                    <button
                      type="button"
                      className={btn}
                      style={btnStyle}
                      data-testid="pron-use-all-confirm"
                      onClick={() => {
                        setRows((cur) => cur && cur.map((r, i) => (proposals[i] ? { ...r, pron: proposals[i] as string, edited: false } : r)));
                        setConfirmAll(false);
                      }}
                    >
                      바꾸기
                    </button>
                    <button type="button" className={btn} style={btnStyle} onClick={() => setConfirmAll(false)}>
                      취소
                    </button>
                  </>
                )}
              </>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto rounded border p-2 flex flex-col gap-2" style={{ borderColor: "rgba(128,128,128,0.25)" }}>
            {rows.map((r, i) => {
              if (r.text.trim() === "") return null;
              const g = r.gen;
              if (!g || g.lang === "ko" || g.lang === "none") return (
                <div key={i} className="text-[12.5px] opacity-70 break-words">{r.text}</div>
              );
              const unconverted = r.pron.trim() !== "" && hasUnconverted(r.pron);
              const failedLine = r.pron.trim() === "" || unconverted;
              const state = unconverted || (failedLine && g.status === "unsupported") ? "failed" : g.status === "review" && !r.edited && r.pron === g.pron ? "review" : r.edited ? "edited" : r.saved && r.pron === r.saved ? "saved" : "ok";
              return (
                <div key={i} className="text-[12.5px]" data-testid="pron-row" data-status={state}>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" className="mt-1" checked={r.selected} onChange={(e) => set(i, { selected: e.target.checked })} aria-label={`${i + 1}번째 줄 선택`} data-testid="pron-select" />
                    <span className="opacity-80 break-words">{r.text}</span>
                  </label>
                  <div className="flex items-center gap-2 pl-6">
                    <input
                      aria-label={`${i + 1}번째 줄 발음`}
                      className="flex-1 min-w-0 rounded border px-2 min-h-[34px] bg-transparent"
                      style={{ borderColor: "rgba(128,128,128,0.35)" }}
                      value={r.pron}
                      placeholder={state === "failed" ? "직접 입력 (비우면 이 줄은 발음 없이 저장)" : ""}
                      onChange={(e) => set(i, { pron: e.target.value, edited: true })}
                    />
                    <span className={`shrink-0 text-[11.5px] ${state === "failed" ? "text-red-400" : state === "review" ? "text-amber-500" : state === "ok" ? "text-emerald-500" : "opacity-60"}`} title={g.notes.join(" / ")}>
                      {state === "failed" ? "검토 필요" : state === "review" ? "확인 필요" : state === "edited" ? "수정함" : state === "saved" ? "저장됨" : "자동"}
                    </span>
                  </div>
                  {state === "failed" && (g.failed?.length ?? 0) > 0 && <div className="pl-6 text-[11.5px] text-red-400">변환 못 한 단어: {g.failed!.join(", ")}</div>}
                  {state === "review" && (g.uncertain?.length ?? 0) > 0 && <div className="pl-6 text-[11.5px] text-amber-500">읽기 확인: {g.uncertain!.join(", ")}</div>}
                  {proposals[i] && r.pron !== proposals[i] && (
                    <div className="pl-6 text-[11.5px] mt-0.5" data-testid="pron-compare">
                      <span className="opacity-60">저장됨</span> {r.saved} <span className="opacity-60">→ 새로 만든 값</span> <b>{proposals[i]}</b>{" "}
                      <button type="button" className="underline" onClick={() => set(i, { pron: proposals[i] as string, edited: false })} data-testid="pron-use-new">
                        새 값 사용
                      </button>
                    </div>
                  )}
                  {r.saved && r.pron !== r.saved && (
                    <div className="pl-6 text-[11.5px] opacity-70">
                      이전 저장값: {r.saved}{" "}
                      <button type="button" className="underline" onClick={() => set(i, { pron: r.saved, edited: false })} data-testid="pron-keep-saved">
                        저장값 유지
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {bad > 0 && <div className="text-[12px] text-red-400 mt-1" data-testid="pron-block">변환 안 된 한자/가나가 남은 줄이 {bad}줄 있어요 — 고치거나 비우면 저장할 수 있어요. (가사 원문은 그대로 저장돼요)</div>}
          {confirming && (
            <div className="text-[12px] text-amber-500 mt-1" data-testid="pron-confirm-text">
              저장된 발음 {overwrites}줄이 바뀌어요. 이전 가사는 이 브라우저에 백업돼서 "되돌리기"로 복구할 수 있어요.
            </div>
          )}
          <div className="mt-2 flex gap-2">
            <button type="button" className={btn} style={btnStyle} onClick={() => void save()} disabled={auto.applying || count === 0 || bad > 0} data-testid="pron-save">
              {confirming ? "덮어쓰고 저장" : "발음 저장"}
            </button>
            <button type="button" className={btn} style={btnStyle} onClick={() => { setRows(null); setConfirming(false); }}>
              취소
            </button>
          </div>
        </div>
      )}
      {auto.applyMsg && !rows && (
        <div role="status" className={`mt-1 text-[12.5px] ${auto.applyMsg.kind === "error" ? "text-red-400" : "opacity-80"}`}>{auto.applyMsg.text}</div>
      )}
    </div>
  );
}

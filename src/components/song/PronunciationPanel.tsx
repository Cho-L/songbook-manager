import { useMemo, useState } from "react";
import type { useAutoLyrics } from "../../hooks/useAutoLyrics";
import { applyPronToRaw, parseLyrics, stripLyricTracks } from "../../utils/lyrics";
import { generatePronunciation, loadCmuDict, needsEnglishDict, type PronLine } from "../../lyrics/pronunciation";

type Auto = ReturnType<typeof useAutoLyrics>;
const btn = "rounded-lg border px-3 min-h-[36px] text-[12.5px] transition-[filter] hover:brightness-125 active:brightness-95 disabled:opacity-40";
const btnStyle = { borderColor: "rgba(128,128,128,0.35)", backgroundColor: "rgba(128,128,128,0.12)", color: "inherit" } as const;
const BADGE: Record<string, { label: string; cls: string }> = {
  ok: { label: "자동", cls: "text-emerald-500" },
  review: { label: "검토 필요", cls: "text-amber-500" },
  unsupported: { label: "지원 불가", cls: "text-red-400" },
  skipped: { label: "", cls: "" },
  saved: { label: "저장됨", cls: "opacity-60" },
};

/**
 * 한글 발음 만들기 → 미리보기/직접 수정 → 저장.
 * 자동 변환은 초안일 뿐이라 저장 전에 반드시 화면에서 확인하게 하고(자동 저장 없음), 원문·시간은 바꾸지 않는다.
 */
export function PronunciationPanel({ auto }: { auto: Auto }) {
  const raw = auto.rawSong?.lyrics ?? "";
  const lines = useMemo(() => parseLyrics(raw), [raw]);
  const [rows, setRows] = useState<(PronLine & { edited?: boolean })[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const hasExisting = lines.some((l) => l.pron);

  if (!auto.canSave || lines.every((l) => !l.text.trim())) return null;

  async function generate() {
    setBusy(true);
    setErr(null);
    const texts = lines.map((l) => l.text);
    let dict;
    if (needsEnglishDict(texts)) {
      try {
        dict = await loadCmuDict();
      } catch {
        setErr("영어 발음 사전을 불러오지 못했어요. 일본어 부분만 변환했어요.");
      }
    }
    const generated = generatePronunciation(texts, { dict });
    // 이미 저장된 발음은 덮어쓰지 않고 그대로 보여 준다 (사용자가 고친 값 보호)
    setRows(generated.map((g, i) => (lines[i].pron ? { ...g, pron: lines[i].pron as string, status: "skipped" as const, notes: ["저장된 발음"], edited: true } : g)));
    setBusy(false);
  }

  const count = rows?.filter((r) => r.pron.trim()).length ?? 0;
  const reviewCount = rows?.filter((r) => r.status === "review" || r.status === "unsupported").length ?? 0;

  async function save() {
    if (!rows) return;
    const text = applyPronToRaw(raw, rows.map((r) => r.pron));
    if (await auto.saveLyricsText(text, "발음을 저장했어요")) setRows(null);
  }
  async function removeAll() {
    const text = stripLyricTracks(raw);
    if (await auto.saveLyricsText(text, "발음을 지웠어요")) setRows(null);
  }

  return (
    <div className="mt-3" data-testid="pron-panel">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} style={btnStyle} onClick={() => void generate()} disabled={busy} data-testid="pron-generate">
          {busy ? "만드는 중..." : hasExisting ? "한글 발음 다시 만들기" : "한글 발음 만들기"}
        </button>
        {hasExisting && !rows && (
          <button type="button" className={btn} style={btnStyle} onClick={() => void removeAll()} disabled={auto.applying} data-testid="pron-remove">
            발음 지우기
          </button>
        )}
      </div>
      <p className="text-[11.5px] opacity-55 mt-1">
        일본어(가나)·영어 줄을 한글로 옮긴 <b>초안</b>이에요. 한자 읽기와 영어 발음은 문맥·노래마다 달라서 부정확할 수 있으니 저장 전에 확인하고 고쳐 주세요. 원문과 시간 정보는 바뀌지 않아요.
      </p>
      {err && <div className="text-[12px] text-amber-500 mt-1" data-testid="pron-err">{err}</div>}
      {rows && (
        <div className="mt-2" data-testid="pron-preview">
          <div className="text-[12px] opacity-75 mb-1" data-testid="pron-summary">
            발음 {count}줄{reviewCount > 0 ? ` · 확인 필요 ${reviewCount}줄` : ""}
          </div>
          <div className="max-h-72 overflow-y-auto rounded border p-2 flex flex-col gap-2" style={{ borderColor: "rgba(128,128,128,0.25)" }}>
            {rows.map((r, i) =>
              r.text.trim() === "" ? null : (
                <div key={i} className="text-[12.5px]" data-testid="pron-row" data-status={r.status}>
                  <div className="opacity-80 break-words">{r.text}</div>
                  {r.lang === "ko" || r.lang === "none" ? null : (
                    <div className="flex items-center gap-2">
                      <input
                        aria-label={`${i + 1}번째 줄 발음`}
                        className="flex-1 min-w-0 rounded border px-2 min-h-[34px] bg-transparent"
                        style={{ borderColor: "rgba(128,128,128,0.35)" }}
                        value={r.pron}
                        placeholder={r.status === "unsupported" ? "직접 입력" : ""}
                        onChange={(e) => setRows((cur) => cur && cur.map((x, j) => (j === i ? { ...x, pron: e.target.value, edited: true } : x)))}
                      />
                      <span className={`shrink-0 text-[11.5px] ${(BADGE[r.edited && r.status === "skipped" ? "saved" : r.status] ?? BADGE.skipped).cls}`} title={r.notes.join(" / ")}>
                        {(BADGE[r.edited && r.status === "skipped" ? "saved" : r.status] ?? BADGE.skipped).label}
                      </span>
                    </div>
                  )}
                  {r.notes.length > 0 && r.status !== "skipped" && <div className="text-[11.5px] opacity-55">{r.notes.join(" · ")}</div>}
                </div>
              )
            )}
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" className={btn} style={btnStyle} onClick={() => void save()} disabled={auto.applying || count === 0} data-testid="pron-save">
              발음 저장
            </button>
            <button type="button" className={btn} style={btnStyle} onClick={() => setRows(null)}>
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

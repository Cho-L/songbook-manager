import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { MrCandidatePicker } from "./MrCandidatePicker";
import { searchYouTube } from "../../services/youtubeService";
import { searchMrForRows, type MrRowResult } from "../../utils/mrSearch";

export interface MrTarget {
  row: number;
  title: string;
  artist: string;
}

interface ImportMrSectionProps {
  /** MR이 비어 있고 제목·가수가 있어서 검색할 수 있는 행 (이미 MR이 있는 행은 호출하는 쪽에서 뺀다) */
  targets: MrTarget[];
  /** 제목 또는 가수가 없어서 검색에서 제외된 MR 없는 행의 수 */
  insufficientCount: number;
  /** 행 번호 → 연결할 videoId. 사용자가 최종 확인(가져오기)하기 전에는 저장되지 않는다 */
  onChoicesChange: (choices: Record<number, string>) => void;
  disabled?: boolean;
}

/**
 * 가져오기 미리보기 안의 "MR 자동 검색" 구역.
 * 검색은 서버 프록시(/api/youtube-search)만 쓰고, 결과는 이 컴포넌트 state 에만 있다가
 * 사용자가 "가져오기"를 눌렀을 때 호출한 쪽이 반영한다. 취소/실패/닫기는 기존 노래책에 아무 영향이 없다.
 */
export function ImportMrSection({ targets, insufficientCount, onChoicesChange, disabled }: ImportMrSectionProps) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<Map<number, MrRowResult>>(new Map());
  // 행 번호 → 선택한 videoId (null = 연결 안 함). 자동 연결된 행은 처음부터 채워진다.
  const [choices, setChoices] = useState<Map<number, string | null>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 닫히거나 파일이 바뀌어 사라질 때 진행 중이던 검색을 멈춘다
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const out: Record<number, string> = {};
    choices.forEach((v, k) => {
      if (v) out[k] = v;
    });
    onChoicesChange(out);
    // onChoicesChange 는 부모의 setState 래퍼
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choices]);

  const targetByRow = useMemo(() => new Map(targets.map((t) => [t.row, t])), [targets]);

  async function start() {
    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);
    setNotice(null);
    setResults(new Map());
    setChoices(new Map());
    setProgress({ done: 0, total: targets.length });
    const summary = await searchMrForRows(targets, {
      search: searchYouTube,
      signal: ac.signal,
      onProgress: setProgress,
      onResult: (row, res) => {
        setResults((prev) => new Map(prev).set(row, res));
        if (res.kind === "decision" && res.decision.status === "auto") {
          setChoices((prev) => new Map(prev).set(row, res.decision.status === "auto" ? res.decision.best.videoId : null));
        }
      },
    });
    abortRef.current = null;
    setRunning(false);
    setNotice(
      summary.abortedReason ??
        (summary.cancelled ? "검색을 취소했어요. 지금까지 찾은 결과는 그대로 남아 있어요." : null)
    );
  }

  function cancel() {
    abortRef.current?.abort();
  }

  const entries = [...results.entries()].sort((a, b) => a[0] - b[0]);
  const counts = { auto: 0, review: 0, none: 0, error: 0 };
  for (const [, r] of entries) {
    if (r.kind === "error") counts.error++;
    else counts[r.decision.status]++;
  }
  const reviewable = entries.filter(([, r]) => r.kind === "decision" && r.decision.candidates.length > 0);
  const linked = [...choices.values()].filter(Boolean).length;

  if (targets.length === 0 && insufficientCount === 0) return null;

  return (
    <div className="mt-3 rounded-lg bg-white/[0.04] border border-white/10 p-3" data-testid="import-mr-section">
      <p className="text-[12.5px] text-white/80">
        MR 영상이 없는 곡 {targets.length + insufficientCount}곡
        {insufficientCount > 0 && <span className="text-white/45"> (제목·가수가 비어 검색할 수 없는 {insufficientCount}곡 포함)</span>}
      </p>

      {targets.length > 0 && !running && results.size === 0 && (
        <>
          <button
            type="button"
            onClick={start}
            disabled={disabled}
            className="mt-2 flex items-center gap-1.5 text-[12.5px] px-3 py-1.5 rounded-full bg-white/[0.08] border border-white/10 text-white/80 disabled:opacity-40 transition-[filter] hover:brightness-125"
          >
            <Search className="h-3.5 w-3.5" /> MR 자동 검색 ({targets.length}곡)
          </button>
          <p className="text-[11px] text-white/40 mt-1.5 leading-relaxed">
            곡당 YouTube 검색을 1~2번 해요. 검색 1번은 YouTube API 일일 할당량(기본 1만)에서 100을 쓰기 때문에 하루에 약 100번까지만 검색할 수 있어요.
            확실한 후보만 자동으로 연결하고, 애매하면 직접 고르게 해요. "가져오기"를 누르기 전에는 아무것도 저장되지 않아요.
          </p>
        </>
      )}

      {running && (
        <div className="mt-2" role="status" aria-live="polite">
          <div className="flex items-center gap-2 text-[12px] text-white/70">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> 검색 중 {progress.done} / {progress.total}
            <button
              type="button"
              onClick={cancel}
              className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/[0.08] border border-white/10 text-white/80"
            >
              <X className="h-3 w-3" /> 취소
            </button>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-[var(--book-accent,#fbbf24)] transition-[width]" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      {notice && <p className="mt-2 text-[12px] text-amber-300/90">{notice}</p>}

      {results.size > 0 && (
        <div className="mt-2">
          <p className="text-[12px] text-white/60" data-testid="mr-summary">
            자동 연결 {counts.auto}곡 · 직접 선택 필요 {counts.review}곡 · 못 찾음 {counts.none}곡
            {counts.error > 0 && ` · 오류 ${counts.error}곡`} · 현재 연결 {linked}곡
          </p>
          {!running && targets.length > 0 && (
            <button type="button" onClick={start} disabled={disabled} className="mt-1.5 text-[11.5px] text-white/50 underline underline-offset-2">
              처음부터 다시 검색
            </button>
          )}
          {reviewable.length > 0 && (
            <div className="mt-2 max-h-64 overflow-y-auto flex flex-col gap-2">
              {reviewable.map(([row, res]) => {
                if (res.kind !== "decision") return null;
                const t = targetByRow.get(row);
                const selected = choices.get(row) ?? null;
                return (
                  <MrCandidatePicker
                    key={row}
                    name={`mr-${row}`}
                    legend={`${row}번째 행: ${t?.title} - ${t?.artist}`}
                    statusLabel={res.decision.status === "auto" ? "자동 연결됨" : "직접 선택 필요"}
                    candidates={res.decision.candidates}
                    selected={selected}
                    onSelect={(id) => setChoices((prev) => new Map(prev).set(row, id))}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

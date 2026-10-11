import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import type { Song } from "../../types/song";
import { searchYouTube } from "../../services/youtubeService";
import { songRepository } from "../../services/songRepository";
import { classifyBookSongs, MR_BATCH_SIZE, saveMrChoices, type MrSaveStatus } from "../../utils/mrBatch";
import { estimateMrQuota, searchMrForRows, YT_DEFAULT_DAILY_QUOTA, type MrRowResult } from "../../utils/mrSearch";
import { MrCandidatePicker } from "./MrCandidatePicker";

interface BookMrBatchDialogProps {
  ownerId: string;
  songs: Song[];
  /** changed: 하나라도 저장됐으면 true — 호출한 쪽이 목록을 다시 불러온다 */
  onClose: (changed: boolean) => void;
}

type Phase = "confirm" | "searching" | "review" | "saving";

const btn =
  "text-[12.5px] px-3 py-1.5 rounded-full bg-white/[0.08] border border-white/10 text-white/80 disabled:opacity-40 transition-[filter] hover:brightness-125";

function range(a: number, b: number, unit = ""): string {
  return a === b ? `${a.toLocaleString()}${unit}` : `${a.toLocaleString()}~${b.toLocaleString()}${unit}`;
}

/**
 * 이미 저장된 노래책에서 "MR이 비어 있는 곡"만 YouTube로 찾아 채우는 화면.
 * CSV/JSON 가져오기와 같은 검색·판정 로직(utils/mrSearch)과 같은 후보 목록(MrCandidatePicker)을 쓴다.
 * 흐름: 확인(통계·할당량 추정) → 10곡씩 검색 → 미리보기에서 고르기 → "선택한 MR 저장"을 눌러야만 DB에 반영.
 * 저장은 직전에 최신 데이터를 다시 읽고, "비어 있을 때만" 쓰는 조건부 갱신으로 처리한다.
 */
export function BookMrBatchDialog({ ownerId, songs, onClose }: BookMrBatchDialogProps) {
  const [stats] = useState(() => classifyBookSongs(songs)); // 열린 시점의 목록으로 고정
  const [phase, setPhase] = useState<Phase>("confirm");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<Map<string, MrRowResult>>(new Map());
  const [choices, setChoices] = useState<Map<string, string | null>>(new Map());
  const [autoPicks, setAutoPicks] = useState<Map<string, string>>(new Map());
  const [saveStatus, setSaveStatus] = useState<Map<string, MrSaveStatus>>(new Map());
  const [requests, setRequests] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false); // 검색/저장이 겹쳐 실행되지 않게 하는 잠금 (버튼 연타 방지)
  const mountedRef = useRef(true);
  const cacheRef = useRef<Map<string, MrRowResult>>(new Map());
  const changedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort(); // 닫히면 진행 중인 검색 요청을 멈춘다
    };
  }, []);

  const safe = <T extends unknown[]>(fn: (...a: T) => void) => (...a: T) => {
    if (mountedRef.current) fn(...a);
  };

  const targets = stats.targets;
  const pending = targets.filter((s) => {
    const r = results.get(s.id);
    return !r || r.kind === "error";
  });
  const nextBatch = pending.slice(0, MR_BATCH_SIZE);
  const totalQuota = estimateMrQuota(targets.length);
  const batchQuota = estimateMrQuota(nextBatch.length);
  const searched = targets.filter((s) => results.has(s.id));

  async function runBatch() {
    if (busyRef.current || nextBatch.length === 0) return;
    busyRef.current = true;
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase("searching");
    setNotice(null);
    setProgress({ done: 0, total: nextBatch.length });
    const rowToId = new Map<number, string>();
    const rows = nextBatch.map((s, i) => {
      rowToId.set(i + 1, s.id);
      return { row: i + 1, title: s.title, artist: s.artist };
    });
    try {
      const summary = await searchMrForRows(rows, {
        search: searchYouTube,
        signal: ac.signal,
        cache: cacheRef.current,
        onProgress: safe(setProgress),
        onResult: safe((row, res) => {
          const id = rowToId.get(row)!;
          setResults((prev) => new Map(prev).set(id, res));
          if (res.kind === "decision" && res.decision.status === "auto") {
            const pick = res.decision.best.videoId;
            setAutoPicks((prev) => new Map(prev).set(id, pick));
            setChoices((prev) => new Map(prev).set(id, pick));
          }
        }),
      });
      if (!mountedRef.current) return;
      setRequests((n) => n + summary.requests);
      setNotice(summary.abortedReason ?? (summary.cancelled ? "검색을 취소했어요. 지금까지 찾은 결과는 그대로 남아 있고, 아무것도 저장되지 않았어요." : null));
    } finally {
      busyRef.current = false;
      abortRef.current = null;
      if (mountedRef.current) setPhase("review");
    }
  }

  async function save(only?: string[]) {
    if (busyRef.current) return;
    const list = [...choices.entries()]
      .filter(([id, v]) => v && saveStatus.get(id)?.kind !== "saved" && (!only || only.includes(id)))
      .map(([songId, videoId]) => ({ songId, videoId: videoId as string }));
    if (list.length === 0) return;
    busyRef.current = true;
    setPhase("saving");
    try {
      const out = await saveMrChoices(list, {
        fetchLatest: () => songRepository.getByOwner(ownerId),
        setIfEmpty: (id, videoId) => songRepository.setYoutubeVideoIdIfEmpty(id, videoId),
      });
      if ([...out.values()].some((v) => v.kind === "saved")) changedRef.current = true;
      if (mountedRef.current) setSaveStatus((prev) => new Map([...prev, ...out]));
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setPhase("review");
    }
  }

  const unsavedChosen = [...choices.entries()].filter(([id, v]) => v && saveStatus.get(id)?.kind !== "saved");
  const failedIds = [...saveStatus.entries()].filter(([, v]) => v.kind === "failed").map(([id]) => id);
  const counts = { auto: 0, review: 0, none: 0, error: 0 };
  for (const s of searched) {
    const r = results.get(s.id)!;
    if (r.kind === "error") counts.error++;
    else counts[r.decision.status]++;
  }
  const savedCount = [...saveStatus.values()].filter((v) => v.kind === "saved").length;
  const conflictCount = [...saveStatus.values()].filter((v) => v.kind === "conflict").length;
  const busy = phase === "searching" || phase === "saving";

  function originLabel(id: string, sel: string | null, status: string): string {
    if (sel === null) return status === "auto" ? "연결 안 함으로 변경" : "선택 필요";
    return autoPicks.get(id) === sel ? "자동 선택" : "직접 선택";
  }
  function saveLabel(id: string): string | null {
    const st = saveStatus.get(id);
    if (!st) return null;
    if (st.kind === "saved") return "✓ 저장됨";
    if (st.kind === "conflict") return "건너뜀 — 그 사이 MR이 등록돼 있어 그대로 두었어요";
    if (st.kind === "not-found") return "건너뜀 — 곡을 찾을 수 없어요";
    return `✗ 저장 실패 — ${st.message}`;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="MR 없는 곡 자동 검색"
        className="w-full max-w-md rounded-2xl bg-[#14161F] border border-white/10 text-white max-h-[88vh] flex flex-col overflow-hidden"
      >
        <div className="px-5 pt-5 pb-3 border-b border-white/10 shrink-0 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold">MR 없는 곡 자동 검색</h2>
            <p className="text-[12px] text-white/50 mt-1">MR이 비어 있는 곡만 찾아요. 이미 MR이 있는 곡은 검색도, 변경도 하지 않아요.</p>
          </div>
          <button type="button" onClick={() => onClose(changedRef.current)} disabled={phase === "saving"} className="p-1 text-white/60 hover:text-white disabled:opacity-30" aria-label="닫기">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0 text-[12.5px]">
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-white/70" data-testid="mr-batch-stats">
            <dt>전체 등록 곡</dt><dd className="text-right">{stats.total}곡</dd>
            <dt>MR 등록 곡</dt><dd className="text-right">{stats.withMr}곡</dd>
            <dt>MR 미등록 곡</dt><dd className="text-right">{stats.withoutMr}곡</dd>
            <dt>제목·가수 부족으로 검색 불가</dt><dd className="text-right">{stats.insufficient}곡</dd>
            <dt className="text-white">실제 검색 대상</dt><dd className="text-right text-white">{targets.length}곡</dd>
            <dt>예상 YouTube 검색 요청 (전체)</dt><dd className="text-right">{range(totalQuota.minRequests, totalQuota.maxRequests, "회")}</dd>
            <dt>예상 API 할당량 (전체, 추정)</dt><dd className="text-right">{range(totalQuota.minUnits, totalQuota.maxUnits)}</dd>
          </dl>
          <p className="text-[11px] text-white/40 mt-2 leading-relaxed">
            곡당 검색은 1~2회예요(첫 검색으로 확실하면 1회). 검색 1회를 100으로 계산한 추정치이고, 기본 일일 할당량({YT_DEFAULT_DAILY_QUOTA.toLocaleString()})은 프로젝트 설정에 따라 다를 수 있어요.
            이 서버는 YouTube의 할당량 초과 응답을 일반 오류로만 전달해서, 초과는 "3번 연속 실패"로 감지해 멈춰요.
          </p>

          {targets.length === 0 && <p className="mt-3 text-white/60">검색할 곡이 없어요.</p>}

          {phase === "confirm" && targets.length > 0 && (
            <div className="mt-4">
              <button type="button" className={btn} onClick={runBatch} disabled={busy}>
                {Math.min(MR_BATCH_SIZE, targets.length)}곡 검색 시작
              </button>
              <p className="text-[11px] text-white/40 mt-1.5">
                처음 {nextBatch.length}곡 기준 {range(batchQuota.minRequests, batchQuota.maxRequests, "회")} · 할당량 약 {range(batchQuota.minUnits, batchQuota.maxUnits)} (추정). 검색이 끝나도 바로 저장하지 않아요.
              </p>
            </div>
          )}

          {phase === "searching" && (
            <div className="mt-4" role="status" aria-live="polite">
              <div className="flex items-center gap-2 text-white/70">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> 검색 중 {progress.done} / {progress.total}
                <button type="button" className={`${btn} ml-auto`} onClick={() => abortRef.current?.abort()}>취소</button>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-[var(--book-accent,#fbbf24)] transition-[width]" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
              </div>
            </div>
          )}

          {notice && <p className="mt-3 text-amber-300/90" data-testid="mr-batch-notice">{notice}</p>}

          {searched.length > 0 && (
            <div className="mt-4">
              <p className="text-white/60" data-testid="mr-batch-summary">
                검색 {searched.length}곡 / 대상 {targets.length}곡 · 자동 선택 {counts.auto} · 직접 선택 필요 {counts.review} · 결과 없음 {counts.none} · 검색 실패 {counts.error} · 아직 안 한 곡 {pending.filter((s) => !results.has(s.id)).length}
                <span className="text-white/40"> · 이번 창에서 보낸 요청 {requests}회</span>
              </p>
              <div className="mt-2 flex flex-col gap-2">
                {searched.map((s) => {
                  const r = results.get(s.id)!;
                  const label = `${s.title} - ${s.artist}`;
                  const saved = saveLabel(s.id);
                  if (r.kind === "error") {
                    return <p key={s.id} className="text-red-300/90 break-words">✗ {label}: 검색 실패 — {r.message} (다음 검색 때 다시 시도돼요)</p>;
                  }
                  if (r.decision.candidates.length === 0) {
                    return <p key={s.id} className="text-white/50 break-words">– {label}: 검색 결과 없음 (MR은 그대로 비워 둬요)</p>;
                  }
                  const sel = choices.get(s.id) ?? null;
                  return (
                    <div key={s.id}>
                      <MrCandidatePicker
                        name={`bookmr-${s.id}`}
                        legend={label}
                        statusLabel={originLabel(s.id, sel, r.decision.status)}
                        candidates={r.decision.candidates}
                        selected={sel}
                        onSelect={(id) => setChoices((prev) => new Map(prev).set(s.id, id))}
                        disabled={busy || saveStatus.get(s.id)?.kind === "saved"}
                      />
                      {saved && <p className={`mt-0.5 text-[11.5px] ${saveStatus.get(s.id)?.kind === "failed" ? "text-red-300/90" : "text-white/55"}`}>{saved}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {saveStatus.size > 0 && (
            <p className="mt-3 text-white/70" data-testid="mr-save-summary">
              저장 결과: 저장됨 {savedCount}곡 · 건너뜀 {conflictCount}곡 · 실패 {failedIds.length}곡
            </p>
          )}
        </div>

        <div className="px-5 py-4 border-t border-white/10 shrink-0 flex flex-wrap gap-2 items-center">
          {phase !== "confirm" && (
            <button type="button" className={btn} onClick={runBatch} disabled={busy || pending.length === 0}>
              {pending.length === 0 ? "검색할 곡을 모두 마쳤어요" : `다음 ${Math.min(MR_BATCH_SIZE, pending.length)}곡 검색 (남은 ${pending.length}곡)`}
            </button>
          )}
          {failedIds.length > 0 && (
            <button type="button" className={btn} onClick={() => save(failedIds)} disabled={busy}>실패한 곡 다시 저장</button>
          )}
          <button
            type="button"
            data-testid="mr-save"
            onClick={() => save()}
            disabled={busy || unsavedChosen.length === 0}
            className="ml-auto text-[13px] px-4 py-2 rounded-xl bg-[var(--book-accent,#fbbf24)] text-[#14161F] font-medium disabled:opacity-40 transition-[filter] hover:brightness-110"
          >
            {phase === "saving" ? "저장 중..." : `선택한 MR 저장 (${unsavedChosen.length}곡)`}
          </button>
        </div>
      </div>
    </div>
  );
}

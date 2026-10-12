import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowDown, ArrowUp, Check, ChevronLeft, Copy, Play, RefreshCw, SkipForward, X } from "lucide-react";
import { confirmAsync, notify } from "../components/ui/feedback";
import { useBookDesign } from "../hooks/useBookDesign";
import { getChromeCssVars } from "../utils/color";
import {
  RequestConflictError,
  getAdminRequestRepository,
  normalizeSettings,
} from "../services/songRequestRepository";
import { DEFAULT_QUEUE_OVERLAY, buildQueueOverlayUrl, type QueueOverlaySettings } from "../utils/queueOverlay";
import { canTransition, moveInOrder, type RequestSettings, type RequestStatus, type SongRequest } from "../utils/songRequest";

const POLL_MS = 5000;

/** 관리자용 신청곡 대기열: 접수 켜기/끄기, 승인·거절, 순서 조정, 재생/완료 처리. (RequireOwner 안에서만 열린다) */
export function RequestQueuePage() {
  const { ownerId } = useParams();
  const navigate = useNavigate();
  const { design } = useBookDesign(ownerId);
  const repo = useMemo(() => getAdminRequestRepository(), []);
  const [rows, setRows] = useState<SongRequest[]>([]);
  const [settings, setSettings] = useState<RequestSettings | null>(null);
  const [draft, setDraft] = useState<RequestSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [copied, setCopied] = useState(false);
  const [qo, setQo] = useState<QueueOverlaySettings>(DEFAULT_QUEUE_OVERLAY);
  const [qoCopied, setQoCopied] = useState(false);

  const bookStyle = {
    "--book-accent": design.accentColor,
    "--book-background": design.backgroundColor,
    "--book-surface": design.surfaceColor,
    "--book-text": design.textColor,
    ...getChromeCssVars(design.backgroundColor),
    backgroundColor: design.backgroundColor,
    color: design.textColor,
  } as React.CSSProperties;

  const reload = useCallback(async () => {
    if (!ownerId) return;
    try {
      const [list, s] = await Promise.all([repo.list(ownerId), repo.getSettings(ownerId)]);
      setRows(list);
      setSettings(s);
      setDraft((d) => d ?? s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "신청곡을 불러오지 못했어요.");
    }
  }, [repo, ownerId]);

  useEffect(() => {
    const first = window.setTimeout(() => void reload(), 0);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible" && !busyRef.current) void reload();
    }, POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [reload]);

  /** 한 번에 하나의 동작만 (연타/동시 클릭 방지). 끝나면 최신 목록을 다시 읽는다. */
  async function act(fn: () => Promise<void>, okText?: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await fn();
      if (okText) notify(okText);
    } catch (e) {
      notify(e instanceof RequestConflictError ? e.message : e instanceof Error ? e.message : "처리하지 못했어요.", "error");
    } finally {
      busyRef.current = false;
      setBusy(false);
      await reload();
      // 같은 브라우저에서 열린 OBS 대기열 화면에 즉시 알림 (다른 기기의 OBS 는 4초 주기 조회로 따라온다)
      try {
        if (ownerId) {
          const bc = new BroadcastChannel("songbook-request-queue");
          bc.postMessage(ownerId);
          bc.close();
        }
      } catch {
        /* 미지원 환경 */
      }
    }
  }

  const pending = rows.filter((r) => r.status === "pending");
  const queue = rows
    .filter((r) => r.status === "approved" || r.status === "playing")
    .sort((a, b) => Number(b.status === "playing") - Number(a.status === "playing") || a.position - b.position);
  const finished = rows.filter((r) => r.status === "done" || r.status === "rejected" || r.status === "canceled");
  const approvedIds = queue.filter((r) => r.status === "approved").map((r) => r.id);

  const setStatus = (r: SongRequest, to: RequestStatus, text?: string) => {
    if (!canTransition(r.status, to)) return;
    void act(() => repo.setStatus(r.id, to), text);
  };

  async function play(r: SongRequest) {
    if (!r.songId || !ownerId) return;
    let started = false;
    await act(async () => {
      await repo.startPlaying(ownerId, r.id);
      started = true;
    });
    // 기존 노래 부르기 화면을 그대로 연다 (신청 id 는 오버레이에 신청자 이름을 보여주는 데만 쓰인다)
    if (started) navigate(`/books/${ownerId}/songs/${r.songId}/sing?request=${encodeURIComponent(r.id)}`);
  }

  const dirty = settings && draft && (settings.accepting !== draft.accepting || settings.maxQueue !== draft.maxQueue || settings.perUserMax !== draft.perUserMax);
  const url = `${window.location.origin}/books/${ownerId}/request`;
  const obsUrl = ownerId ? buildQueueOverlayUrl(window.location.origin, ownerId, qo) : "";
  const muted = { color: "var(--book-chrome-muted, rgba(255,255,255,0.55))" } as const;
  const box = { backgroundColor: "var(--book-chrome-surface, rgba(255,255,255,0.05))", borderColor: "var(--book-chrome-border, rgba(255,255,255,0.12))" } as const;
  const smallBtn = "inline-flex items-center gap-1 rounded-lg border px-2.5 min-h-[36px] text-[12.5px] disabled:opacity-40";

  const Row = ({ r, children }: { r: SongRequest; children: React.ReactNode }) => (
    <li className="rounded-xl border px-3 py-2.5 flex flex-wrap items-center gap-2" style={box} data-testid="request-row" data-status={r.status}>
      <div className="min-w-0 flex-1 basis-48">
        <div className="text-[14px] font-medium truncate">{r.title}</div>
        <div className="text-[12px] truncate" style={muted}>{r.artist} · 🙋 {r.requesterName}</div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </li>
  );

  return (
    <div className="book-focus max-w-md lg:max-w-3xl mx-auto pb-16 min-h-screen px-5 pt-5" style={bookStyle} data-testid="request-queue-page">
      <button onClick={() => navigate(`/books/${ownerId}`)} className="inline-flex items-center gap-1 text-[13px] mb-3" style={muted}>
        <ChevronLeft className="h-4 w-4" /> 노래책
      </button>
      <div className="flex items-center justify-between gap-2 mb-4">
        <h1 className="text-xl font-semibold">신청곡 대기열</h1>
        <button type="button" onClick={() => void act(async () => undefined)} disabled={busy} className={smallBtn} style={box} aria-label="새로고침">
          <RefreshCw className="h-3.5 w-3.5" /> 새로고침
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border px-4 py-3 text-[13px] mb-4" style={{ ...box, color: "#f87171" }} data-testid="request-error">
          {error}
        </div>
      )}

      <section className="rounded-xl border p-4 mb-6" style={box} aria-labelledby="req-set">
        <h2 id="req-set" className="text-[14px] font-semibold mb-3">접수 설정</h2>
        <label className="flex items-center gap-2 text-[14px] min-h-[40px]">
          <input
            type="checkbox"
            data-testid="accepting-toggle"
            checked={draft?.accepting ?? false}
            disabled={!draft}
            onChange={(e) => setDraft((d) => (d ? { ...d, accepting: e.target.checked } : d))}
            className="h-4 w-4 accent-[var(--book-accent,#fbbf24)]"
          />
          시청자 신청곡 받기 (꺼져 있으면 신청할 수 없어요)
        </label>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <label className="text-[12px]" style={muted}>
            대기열 최대 곡 수
            <input type="number" min={1} max={200} data-testid="max-queue" value={draft?.maxQueue ?? 30} onChange={(e) => setDraft((d) => (d ? { ...d, maxQueue: Number(e.target.value) } : d))} className="book-input w-full mt-1 rounded-lg border px-3 py-2 text-[13px] outline-none" style={{ ...box, color: "var(--book-text,#fff)" }} />
          </label>
          <label className="text-[12px]" style={muted}>
            1인당 동시 신청 수
            <input type="number" min={1} max={10} data-testid="per-user-max" value={draft?.perUserMax ?? 2} onChange={(e) => setDraft((d) => (d ? { ...d, perUserMax: Number(e.target.value) } : d))} className="book-input w-full mt-1 rounded-lg border px-3 py-2 text-[13px] outline-none" style={{ ...box, color: "var(--book-text,#fff)" }} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button
            type="button"
            data-testid="save-settings"
            disabled={!dirty || busy}
            onClick={() => ownerId && draft && void act(async () => { const n = normalizeSettings(draft); await repo.saveSettings(ownerId, n); setDraft(n); }, "접수 설정을 저장했어요.")}
            className="rounded-lg px-3 min-h-[40px] text-[13px] font-semibold disabled:opacity-40"
            style={{ backgroundColor: "var(--book-accent,#fbbf24)", color: "#14161F" }}
          >
            설정 저장
          </button>
          <span className="text-[12px]" style={muted}>같은 곡 중복·도배(20초 간격, 1시간 10회)는 서버가 자동으로 막아요.</span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input readOnly aria-label="시청자 신청 주소" data-testid="request-url" value={url} onFocus={(e) => e.currentTarget.select()} className="book-input flex-1 min-w-[12rem] rounded-lg border px-3 py-2 text-[12.5px] outline-none" style={{ ...box, color: "var(--book-text,#fff)" }} />
          <button
            type="button"
            className={smallBtn}
            style={box}
            onClick={async () => {
              try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { notify("복사하지 못했어요. 주소를 직접 선택해서 복사해주세요.", "error"); }
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "복사됨" : "주소 복사"}
          </button>
        </div>
        <p className="text-[11.5px] mt-1.5" style={muted}>이 주소를 방송 설명란/채팅 공지에 올리세요. 시청자는 로그인 없이 신청할 수 있어요.</p>
      </section>

      <section className="rounded-xl border px-4 py-3 mb-6" style={box} aria-labelledby="req-obs" data-testid="obs-queue-section">
        <h2 id="req-obs" className="text-[13.5px] font-semibold mb-1">OBS 대기열 화면 주소</h2>
        <p className="text-[11.5px] mb-2" style={muted}>OBS → 소스 추가 → 브라우저에 붙여넣으세요. 로그인/비밀키 없이 승인된 곡의 제목·가수·신청자 이름만 보여요. 승인/완료하면 몇 초 안에 바뀌어요.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2 text-[12px]">
          <label className="block" style={muted}>대기 곡 수
            <input type="number" min={1} max={12} data-testid="qo-n" value={qo.n} onChange={(e) => setQo((v) => ({ ...v, n: Math.min(12, Math.max(1, Number(e.target.value) || 1)) }))} className="book-input w-full mt-1 rounded-lg border px-2 py-1.5 text-[13px] outline-none" style={{ ...box, color: "var(--book-text,#fff)" }} />
          </label>
          <label className="block" style={muted}>글자 크기
            <input type="number" min={12} max={96} data-testid="qo-fs" value={qo.fs} onChange={(e) => setQo((v) => ({ ...v, fs: Math.min(96, Math.max(12, Number(e.target.value) || 12)) }))} className="book-input w-full mt-1 rounded-lg border px-2 py-1.5 text-[13px] outline-none" style={{ ...box, color: "var(--book-text,#fff)" }} />
          </label>
          <label className="block" style={muted}>정렬
            <select data-testid="qo-align" value={qo.align} onChange={(e) => setQo((v) => ({ ...v, align: e.target.value as QueueOverlaySettings["align"] }))} className="book-input w-full mt-1 rounded-lg border px-2 py-1.5 text-[13px] outline-none" style={{ ...box, color: "var(--book-text,#fff)" }}>
              <option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option>
            </select>
          </label>
          <label className="block" style={muted}>배경 불투명도 %
            <input type="number" min={0} max={100} data-testid="qo-bg" value={qo.bg} onChange={(e) => setQo((v) => ({ ...v, bg: Math.min(100, Math.max(0, Number(e.target.value) || 0)) }))} className="book-input w-full mt-1 rounded-lg border px-2 py-1.5 text-[13px] outline-none" style={{ ...box, color: "var(--book-text,#fff)" }} />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <input readOnly aria-label="OBS 대기열 주소" data-testid="obs-queue-url" value={obsUrl} onFocus={(e) => e.currentTarget.select()} className="book-input flex-1 min-w-[12rem] rounded-lg border px-3 py-2 text-[12.5px] outline-none" style={{ ...box, color: "var(--book-text,#fff)" }} />
          <button type="button" className={smallBtn} style={box} onClick={async () => { try { await navigator.clipboard.writeText(obsUrl); setQoCopied(true); window.setTimeout(() => setQoCopied(false), 1500); } catch { notify("복사하지 못했어요. 주소를 직접 선택해서 복사해주세요.", "error"); } }}>
            {qoCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {qoCopied ? "복사됨" : "주소 복사"}
          </button>
          <a href={obsUrl} target="_blank" rel="noreferrer" className={smallBtn} style={box} data-testid="obs-queue-open">미리보기 열기</a>
          <button type="button" className={smallBtn} style={box} data-testid="to-studio" onClick={() => navigate(`/books/${ownerId}/overlay-studio`)}>Overlay Studio 에서 꾸미기</button>
        </div>
      </section>

      <section className="mb-6" aria-labelledby="req-pending">
        <h2 id="req-pending" className="text-[14px] font-semibold mb-2">확인 대기 <span style={muted}>({pending.length})</span></h2>
        {pending.length === 0 && <p className="text-[13px]" style={muted} data-testid="pending-empty">새 신청이 없어요.</p>}
        <ul className="flex flex-col gap-2" data-testid="pending-list">
          {pending.map((r) => (
            <Row key={r.id} r={r}>
              <button type="button" data-testid="approve" disabled={busy} onClick={() => setStatus(r, "approved")} className={smallBtn} style={{ ...box, color: "#22c55e" }}><Check className="h-3.5 w-3.5" /> 승인</button>
              <button type="button" data-testid="reject" disabled={busy} onClick={() => setStatus(r, "rejected")} className={smallBtn} style={{ ...box, color: "#f87171" }}><X className="h-3.5 w-3.5" /> 거절</button>
            </Row>
          ))}
        </ul>
      </section>

      <section className="mb-6" aria-labelledby="req-queue">
        <h2 id="req-queue" className="text-[14px] font-semibold mb-2">대기열 <span style={muted}>({queue.length})</span></h2>
        {queue.length === 0 && <p className="text-[13px]" style={muted}>승인한 곡이 여기에 쌓여요.</p>}
        <ol className="flex flex-col gap-2" data-testid="queue-list">
          {queue.map((r) => {
            const i = approvedIds.indexOf(r.id);
            return (
              <Row key={r.id} r={r}>
                {r.status === "playing" ? (
                  <>
                    <span className="text-[12px] font-semibold" style={{ color: "var(--book-accent,#fbbf24)" }}>▶ 재생 중</span>
                    {r.songId && <button type="button" className={smallBtn} style={box} onClick={() => navigate(`/books/${ownerId}/songs/${r.songId}/sing?request=${encodeURIComponent(r.id)}`)}>화면 열기</button>}
                    <button type="button" data-testid="finish" disabled={busy} onClick={() => setStatus(r, "done")} className={smallBtn} style={box}><Check className="h-3.5 w-3.5" /> 완료</button>
                    <button type="button" data-testid="skip" disabled={busy || !ownerId} title="대기열 맨 뒤로 보내요" onClick={() => ownerId && void act(() => repo.skip(ownerId, r.id), "맨 뒤로 보냈어요.")} className={smallBtn} style={box}><SkipForward className="h-3.5 w-3.5" /> 건너뛰기</button>
                    <button type="button" data-testid="cancel" disabled={busy} onClick={() => setStatus(r, "canceled")} className={smallBtn} style={{ ...box, color: "#f87171" }}><X className="h-3.5 w-3.5" /> 취소</button>
                  </>
                ) : (
                  <>
                    <button type="button" data-testid="move-up" aria-label="위로" disabled={busy || i <= 0} onClick={() => void act(() => repo.reorder(moveInOrder(approvedIds, r.id, -1)))} className={smallBtn} style={box}><ArrowUp className="h-3.5 w-3.5" /></button>
                    <button type="button" data-testid="move-down" aria-label="아래로" disabled={busy || i < 0 || i >= approvedIds.length - 1} onClick={() => void act(() => repo.reorder(moveInOrder(approvedIds, r.id, 1)))} className={smallBtn} style={box}><ArrowDown className="h-3.5 w-3.5" /></button>
                    <button type="button" data-testid="play" disabled={busy || !r.songId} title={r.songId ? "" : "노래책에서 삭제된 곡이에요"} onClick={() => void play(r)} className={smallBtn} style={{ ...box, color: "var(--book-accent,#fbbf24)" }}><Play className="h-3.5 w-3.5" /> 재생</button>
                    <button type="button" data-testid="skip" disabled={busy || !ownerId || i >= approvedIds.length - 1} title="대기열 맨 뒤로 보내요" onClick={() => ownerId && void act(() => repo.skip(ownerId, r.id), "맨 뒤로 보냈어요.")} className={smallBtn} style={box}><SkipForward className="h-3.5 w-3.5" /> 건너뛰기</button>
                    <button type="button" data-testid="remove" disabled={busy} onClick={() => setStatus(r, "canceled")} className={smallBtn} style={{ ...box, color: "#f87171" }}><X className="h-3.5 w-3.5" /> 취소</button>
                  </>
                )}
              </Row>
            );
          })}
        </ol>
      </section>

      <details className="rounded-xl border" style={box}>
        <summary className="cursor-pointer select-none px-4 py-3 text-[13.5px] font-medium min-h-[44px] flex items-center">처리된 신청 ({finished.length})</summary>
        <div className="px-4 pb-4">
          <ul className="flex flex-col gap-2" data-testid="finished-list">
            {finished.map((r) => (
              <Row key={r.id} r={r}>
                <span className="text-[12px]" style={muted}>{r.status === "done" ? "완료" : r.status === "canceled" ? "취소" : "거절"}</span>
                {(r.status === "rejected") && <button type="button" disabled={busy} onClick={() => setStatus(r, "pending", "확인 대기로 되돌렸어요.")} className={smallBtn} style={box}>되돌리기</button>}
              </Row>
            ))}
          </ul>
          {finished.length > 0 && ownerId && (
            <button
              type="button"
              disabled={busy}
              className={`${smallBtn} mt-3`}
              style={box}
              onClick={async () => {
                const ok = await confirmAsync({ title: "처리된 기록을 지울까요?", message: "완료/거절된 신청 기록만 삭제돼요. 대기 중인 신청은 그대로예요.", confirmLabel: "기록 삭제", tone: "danger" });
                if (ok) void act(() => repo.clearFinished(ownerId), "처리된 기록을 지웠어요.");
              }}
            >
              처리된 기록 지우기
            </button>
          )}
        </div>
      </details>
    </div>
  );
}

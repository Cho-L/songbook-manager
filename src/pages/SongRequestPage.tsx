import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Send } from "lucide-react";
import type { Song } from "../types/song";
import { useBookDesign } from "../hooks/useBookDesign";
import { getChromeCssVars } from "../utils/color";
import { searchSongs } from "../utils/search";
import { getPublicRequestClient, type SubmitResult } from "../services/songRequestRepository";
import { NAME_MAX, type PublicQueue } from "../utils/songRequest";

const NAME_KEY = "songbook:requester-name";
const MAX_RESULTS = 30;
const POLL_MS = 10000;

interface Props {
  songs: Song[];
  loading: boolean;
}

/**
 * 시청자용 신청곡 페이지 (로그인 불필요).
 * 노래책에서 곡을 검색해 고르는 방식만 지원한다. 신청은 서버(/api/song-requests)가 검증·접수하고,
 * 이 화면은 결과 문구만 보여준다.
 */
export function SongRequestPage({ songs, loading }: Props) {
  const { ownerId } = useParams();
  const { design } = useBookDesign(ownerId);
  const client = useMemo(() => getPublicRequestClient(), []);
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(NAME_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [query, setQuery] = useState("");
  const [queue, setQueue] = useState<PublicQueue | null>(null);
  const [queueError, setQueueError] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const busyRef = useRef(false); // 같은 순간의 중복 클릭 방지
  const honeypotRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const bookStyle = {
    "--book-accent": design.accentColor,
    "--book-background": design.backgroundColor,
    "--book-surface": design.surfaceColor,
    "--book-text": design.textColor,
    ...getChromeCssVars(design.backgroundColor),
    backgroundColor: design.backgroundColor,
    color: design.textColor,
  } as React.CSSProperties;

  const loadQueue = useCallback(async () => {
    if (!ownerId) return;
    try {
      setQueue(await client.getQueue(ownerId));
      setQueueError(false);
    } catch {
      setQueueError(true);
    }
  }, [client, ownerId]);

  useEffect(() => {
    const first = window.setTimeout(() => void loadQueue(), 0);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadQueue();
    }, POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [loadQueue]);

  const results = useMemo(() => (query.trim() ? searchSongs(songs, query).slice(0, MAX_RESULTS) : []), [songs, query]);
  const queued = useMemo(() => new Set((queue?.queue ?? []).map((q) => `${q.title}\u0000${q.artist}`)), [queue]);
  const closed = queue !== null && !queue.accepting;

  async function request(song: Song) {
    if (busyRef.current) return;
    const trimmed = name.replace(/\s+/g, " ").trim();
    if (!trimmed) {
      setMsg({ kind: "error", text: "먼저 신청자 이름(닉네임)을 입력해주세요." });
      nameRef.current?.focus();
      return;
    }
    if (!ownerId) return;
    busyRef.current = true;
    setBusyId(song.id);
    setMsg(null);
    let result: SubmitResult;
    try {
      result = await client.submit({ bookId: ownerId, songId: song.id, name: trimmed, website: honeypotRef.current?.value ?? "" } as Parameters<typeof client.submit>[0]);
    } finally {
      busyRef.current = false;
      setBusyId(null);
    }
    if (result.ok) {
      try {
        localStorage.setItem(NAME_KEY, trimmed);
      } catch {
        /* 저장 실패는 무시 */
      }
      setSentIds((s) => new Set(s).add(song.id));
      setMsg({ kind: "ok", text: `"${song.title}" 신청했어요! 방장이 확인하면 대기열에 올라가요.` });
      void loadQueue();
    } else {
      setMsg({ kind: "error", text: result.message });
      void loadQueue();
    }
  }

  const muted = { color: "var(--book-chrome-muted, rgba(255,255,255,0.55))" } as const;
  const box = { backgroundColor: "var(--book-chrome-surface, rgba(255,255,255,0.05))", borderColor: "var(--book-chrome-border, rgba(255,255,255,0.12))" } as const;

  return (
    <div className="book-focus max-w-md lg:max-w-2xl mx-auto pb-16 min-h-screen px-5 pt-6" style={bookStyle} data-testid="request-page">
      <h1 className="text-xl font-semibold mb-1">🎤 신청곡 보내기</h1>
      <p className="text-[13px] mb-5" style={muted}>
        부르고 싶은 곡을 찾아서 신청하면, 방장이 확인한 뒤 대기열에 올려요. 로그인은 필요 없어요.
      </p>

      {closed && (
        <div role="status" data-testid="request-closed" className="rounded-xl border px-4 py-3 text-[13.5px] mb-4" style={box}>
          지금은 신청곡을 받지 않고 있어요. 방장이 접수를 열면 신청할 수 있어요.
        </div>
      )}

      <label className="block text-[12.5px] font-medium mb-1" htmlFor="req-name" style={muted}>
        신청자 이름 (닉네임)
      </label>
      <input
        id="req-name"
        ref={nameRef}
        data-testid="request-name"
        value={name}
        maxLength={NAME_MAX}
        onChange={(e) => setName(e.target.value)}
        placeholder="화면에 표시될 이름"
        className="book-input w-full rounded-lg border px-3 py-2.5 text-[14px] outline-none mb-4"
        style={{ ...box, color: "var(--book-text, #fff)" }}
      />
      {/* 허니팟: 사람에게는 보이지 않고, 자동 입력 봇만 채운다 */}
      <input ref={honeypotRef} name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" data-testid="request-website" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }} />

      <label className="block text-[12.5px] font-medium mb-1" htmlFor="req-search" style={muted}>
        곡 검색 (제목 · 가수)
      </label>
      <input
        id="req-search"
        data-testid="request-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="예: 꽃길, 김세정"
        className="book-input w-full rounded-lg border px-3 py-2.5 text-[14px] outline-none"
        style={{ ...box, color: "var(--book-text, #fff)" }}
      />

      <div aria-live="polite" className="min-h-[24px] mt-2 text-[13px]" data-testid="request-message" style={msg ? { color: msg.kind === "ok" ? "#22c55e" : "#f87171" } : undefined}>
        {msg?.text}
      </div>

      <ul className="flex flex-col gap-2 mt-2" aria-label="검색 결과" data-testid="request-results">
        {loading && <li className="text-[13px]" style={muted}>노래책을 불러오는 중…</li>}
        {!loading && query.trim() && results.length === 0 && <li className="text-[13px]" style={muted}>검색 결과가 없어요. 노래책에 있는 곡만 신청할 수 있어요.</li>}
        {results.map((s) => {
          const inQueue = queued.has(`${s.title}\u0000${s.artist}`);
          const sent = sentIds.has(s.id);
          return (
            <li key={s.id} className="flex items-center gap-3 rounded-xl border px-3 py-2.5" style={box} data-testid="request-result">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium truncate">{s.title}</div>
                <div className="text-[12px] truncate" style={muted}>{s.artist}</div>
              </div>
              <button
                type="button"
                data-testid="request-submit"
                disabled={closed || busyId !== null || inQueue || sent}
                onClick={() => void request(s)}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 min-h-[40px] text-[13px] font-semibold disabled:opacity-40"
                style={{ backgroundColor: "var(--book-accent, #fbbf24)", color: "#14161F" }}
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                {busyId === s.id ? "보내는 중…" : sent ? "신청함" : inQueue ? "대기 중" : "신청"}
              </button>
            </li>
          );
        })}
      </ul>

      <section className="mt-8" aria-labelledby="queue-h">
        <h2 id="queue-h" className="text-[15px] font-semibold mb-2">
          지금 대기열 {queue && queue.pendingCount > 0 && <span className="text-[12px] font-normal" style={muted}>· 확인 대기 {queue.pendingCount}곡</span>}
        </h2>
        {queueError && <p className="text-[12.5px]" style={muted}>대기열을 불러오지 못했어요.</p>}
        {queue && queue.queue.length === 0 && !queueError && <p className="text-[13px]" style={muted} data-testid="queue-empty">아직 대기열이 비어 있어요.</p>}
        <ol className="flex flex-col gap-1.5" data-testid="public-queue">
          {queue?.queue.map((q) => (
            <li key={q.id} className="rounded-lg border px-3 py-2 text-[13.5px] flex items-baseline gap-2" style={box}>
              <span aria-hidden="true">{q.status === "playing" ? "▶" : "•"}</span>
              <span className="min-w-0 flex-1 truncate">
                <b>{q.title}</b> <span style={muted}>{q.artist}</span>
              </span>
              <span className="text-[12px] shrink-0" style={muted}>🙋 {q.requesterName}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

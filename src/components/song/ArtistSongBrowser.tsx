import { useMemo, useRef, useState } from "react";
import type { useAutoLyrics } from "../../hooks/useAutoLyrics";
import { getArtistCatalog } from "../../hooks/useAutoLyrics";
import { describeLyricsError, isAbort } from "../../lyrics/errors";
import { filterGroups, groupRecordings, type RecordingGroup } from "../../lyrics/catalog";
import { splitArtists } from "../../lyrics/artist";
import type { ArtistHit, ArtistRecording } from "../../lyrics/types";
import { LyricsCandidatePanel } from "./LyricsCandidatePanel";

type Auto = ReturnType<typeof useAutoLyrics>;

const btn = "rounded-lg border px-3 min-h-[36px] text-[12.5px] transition-[filter] hover:brightness-125 active:brightness-95 disabled:opacity-40";
const btnStyle = { borderColor: "rgba(128,128,128,0.35)", backgroundColor: "rgba(128,128,128,0.12)", color: "inherit" } as const;
const inputCls = "rounded-lg border px-2 min-h-[36px] text-[13px] bg-transparent";
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/**
 * 가수별 곡 탐색: 가수를 검색해서 고르면 MusicBrainz 에 등록된 그 가수의 곡 목록을 보여 주고,
 * 곡을 고르면 그 곡의 원어/로마자 제목으로 가사(LRCLIB)를 다시 찾는다.
 * 제목을 한글로만 알고 있어도(예: 무희) 가수의 곡 목록에서 직접 확인하고 고를 수 있다. 자동으로 고르지 않는다.
 */
export function ArtistSongBrowser({ auto, mrDuration }: { auto: Auto; mrDuration: number }) {
  const catalog = getArtistCatalog();
  const [open, setOpen] = useState(false);
  // 가수 입력칸 기본값: 곡에 적힌 가수 (콜라보면 첫 번째). 곡이 바뀌면 부모가 key 로 새로 만든다
  const songArtist = auto.rawSong?.artist ?? "";
  const [q, setQ] = useState(() => splitArtists(songArtist)[0] ?? songArtist);
  const [hits, setHits] = useState<ArtistHit[] | null>(null);
  const [selected, setSelected] = useState<ArtistHit | null>(null);
  const [recs, setRecs] = useState<ArtistRecording[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [exhausted, setExhausted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [pickedTitle, setPickedTitle] = useState<string | null>(null);
  const [resultIds, setResultIds] = useState<string[] | null>(null);
  const reqRef = useRef(0);

  const groups = useMemo(() => groupRecordings(recs), [recs]);
  const shown = useMemo(() => filterGroups(groups, filter), [groups, filter]);

  if (!catalog) return null;

  async function searchArtist(): Promise<void> {
    const name = q.trim();
    if (!name || busy) return;
    const id = ++reqRef.current;
    setBusy(true);
    setErr(null);
    setSelected(null);
    setRecs([]);
    setResultIds(null);
    try {
      const r = await catalog!.searchArtists(name);
      if (id !== reqRef.current) return;
      setHits(r);
    } catch (e) {
      if (id === reqRef.current && !isAbort(e)) setErr(describeLyricsError(e));
    } finally {
      if (id === reqRef.current) setBusy(false);
    }
  }

  async function loadPage(artist: ArtistHit, offset: number, replace: boolean): Promise<void> {
    const id = ++reqRef.current;
    setBusy(true);
    setErr(null);
    try {
      const page = await catalog!.browseRecordings(artist.mbid, offset);
      if (id !== reqRef.current) return;
      setRecs((cur) => (replace ? page.items : [...cur, ...page.items]));
      setTotal(page.total);
      setNextOffset(offset + page.rawCount);
      setExhausted(page.rawCount === 0 || offset + page.rawCount >= page.total);
    } catch (e) {
      if (id === reqRef.current && !isAbort(e)) setErr(describeLyricsError(e));
    } finally {
      if (id === reqRef.current) setBusy(false);
    }
  }

  function selectArtist(a: ArtistHit): void {
    setSelected(a);
    setFilter("");
    setResultIds(null);
    setPickedTitle(null);
    setRecs([]);
    setNextOffset(0);
    setExhausted(false);
    void loadPage(a, 0, true);
  }

  async function pick(g: RecordingGroup): Promise<void> {
    if (!selected) return;
    setPickedTitle(g.main.title);
    setResultIds(null);
    const artistAliases = [selected.name, ...selected.aliases.filter((x) => x !== selected.name)];
    const ids = await auto.searchForRecording({ title: g.main.title, referenceDuration: g.main.length, altTitles: g.altTitles, artist: selected.name, artistAliases });
    setResultIds(ids);
  }

  return (
    <div className="mt-2" data-testid="artist-browser">
      <button type="button" className={btn} style={btnStyle} aria-expanded={open} data-testid="artist-browse-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "가수별 곡 찾기 닫기" : "가수별 곡 찾기"}
      </button>
      {open && (
        <div className="mt-2 rounded-lg border p-3" style={{ borderColor: "rgba(128,128,128,0.35)" }}>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void searchArtist();
            }}
          >
            <input className={`${inputCls} flex-1 min-w-[140px]`} style={{ borderColor: "rgba(128,128,128,0.35)" }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="가수 이름 (한글/원어/영문)" aria-label="가수 이름" data-testid="artist-q" />
            <button type="submit" className={btn} style={btnStyle} disabled={busy || !q.trim()} data-testid="artist-search">
              가수 검색
            </button>
          </form>
          <div className="mt-1 text-[11.5px] opacity-60" data-testid="rec-note">
            MusicBrainz에 등록된 곡만 보여요. 전체 디스코그래피를 보장하지 않고, 곡마다 가사가 있는 것도 아니에요.
          </div>
          {err && (
            <div className="mt-2 text-[12.5px] text-red-400" role="alert" data-testid="artist-error">
              {err}
            </div>
          )}
          {hits && hits.length === 0 && !busy && !err && (
            <div className="mt-2 text-[12.5px] opacity-70" data-testid="artist-none">
              MusicBrainz에서 이 가수를 찾지 못했어요. 원어나 영문 표기로 다시 검색해 보세요.
            </div>
          )}
          {hits && hits.length > 0 && !selected && (
            <ul className="mt-2 flex flex-col gap-1.5" aria-label="가수 후보">
              {hits.map((h) => (
                <li key={h.mbid}>
                  <button type="button" className={`${btn} w-full text-left`} style={btnStyle} data-testid="artist-hit" onClick={() => selectArtist(h)}>
                    {h.name}
                    <span className="opacity-60">
                      {[h.type, h.country, h.disambiguation].filter(Boolean).length > 0 ? ` · ${[h.type, h.country, h.disambiguation].filter(Boolean).join(" · ")}` : ""}
                    </span>
                    {h.aliases.length > 0 && <span className="block text-[11.5px] opacity-60">다른 표기: {h.aliases.slice(0, 4).join(", ")}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {selected && (
            <div className="mt-2">
              <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                <strong data-testid="artist-selected">{selected.name}</strong>
                <button
                  type="button"
                  className="underline opacity-70"
                  data-testid="artist-change"
                  onClick={() => {
                    reqRef.current++;
                    setBusy(false);
                    setSelected(null);
                    setRecs([]);
                    setResultIds(null);
                  }}
                >
                  다른 가수 고르기
                </button>
              </div>
              <input className={`${inputCls} mt-2 w-full`} style={{ borderColor: "rgba(128,128,128,0.35)" }} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="곡 제목으로 거르기 (원어/로마자)" aria-label="곡 제목 필터" data-testid="rec-filter" />
              <div className="mt-1 text-[11.5px] opacity-60" data-testid="rec-count">
                {busy && recs.length === 0 ? "곡 목록을 불러오는 중이에요..." : `${groups.length}곡 불러옴 (MusicBrainz 등록 녹음 ${total}개 중 ${Math.min(nextOffset, total)}개 확인)`}
                {filter.trim() ? ` · 거른 결과 ${shown.length}곡` : ""}
              </div>
              <ul className="mt-2 flex flex-col gap-1.5 max-h-[320px] overflow-y-auto" aria-label="곡 목록">
                {shown.map((g) => (
                  <li key={g.main.mbid}>
                    <button type="button" className={`${btn} w-full text-left`} style={btnStyle} data-testid="rec-item" onClick={() => void pick(g)} disabled={auto.listing}>
                      {g.main.title}
                      {g.altTitles.length > 0 && <span className="opacity-70"> ({g.altTitles[0]})</span>}
                      <span className="opacity-60">
                        {g.main.length ? ` · ${mmss(g.main.length)}` : ""}
                        {g.versions > 0 && !g.main.isVersion ? ` · 다른 버전 ${g.versions}개 묶음` : ""}
                        {g.main.isVersion ? ` · ${g.main.disambiguation ?? "다른 버전"}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {shown.length === 0 && !busy && recs.length > 0 && (
                <div className="mt-1 text-[12.5px] opacity-70" data-testid="rec-empty">
                  {exhausted ? "거른 결과가 없어요." : "불러온 곡 중에는 없어요 — 더 불러와 보세요."}
                </div>
              )}
              {!exhausted && recs.length > 0 && (
                <button type="button" className={`${btn} mt-2`} style={btnStyle} disabled={busy} data-testid="rec-more" onClick={() => void loadPage(selected, nextOffset, false)}>
                  {busy ? "불러오는 중..." : "더 불러오기"}
                </button>
              )}
            </div>
          )}
          {pickedTitle && (
            <div className="mt-3" data-testid="rec-results">
              <div className="text-[12.5px] opacity-80">
                “{pickedTitle}” 로 가사를 찾은 결과 — 직접 고른 곡이에요. 미리보기로 가사를 확인하고 적용하세요.
              </div>
              {auto.listing && <div className="text-[12px] opacity-70">가사를 찾는 중이에요...</div>}
              {resultIds && resultIds.length === 0 && !auto.listing && (
                <div className="mt-1 text-[12.5px] opacity-70" data-testid="rec-no-lyrics">
                  가사 서비스에서 이 곡의 가사를 찾지 못했어요. 가사는 직접 입력하거나 수정할 수 있어요.
                </div>
              )}
              {resultIds && resultIds.length > 0 && <LyricsCandidatePanel auto={auto} mrDuration={mrDuration} ids={resultIds} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Music2 } from "lucide-react";
import type { LiveState } from "../../utils/liveBroadcast";
import { bannerSize } from "../../types/overlay";
import type { OverlayAlign, OverlayPosition, OverlayPreset, OverlaySettings } from "../../types/overlay";

/**
 * 방송 오버레이 화면 (표시 전용). 실제 /overlay 페이지와 설정 화면의 미리보기가 똑같이 이 컴포넌트를 쓴다.
 * 일반 앱 UI(헤더/메뉴/버튼)는 여기에 절대 들어가지 않는다.
 */
export type OverlayStatus = "waiting" | "lost";

interface OverlayViewProps {
  /** 지금 방송할 상태. 없으면 status에 따라 대기/끊김 문구를 보여준다 */
  state: LiveState | null;
  status: OverlayStatus;
  settings: OverlaySettings;
  /** 화면(또는 미리보기 박스) 가로 px — 글자 크기를 이 폭에 비례해 정한다 (1920 기준 약 30px) */
  width: number;
  /** 화면 세로 px — 세로 화면(9:16)인지 판단하는 데 쓴다. 모르면 가로 화면으로 본다 */
  height?: number;
  /** 최소 글자 크기 px (작은 화면/미리보기에서 너무 작아지지 않게) */
  minPx?: number;
}

const TEXT_SHADOW = "0 1px 2px rgba(0,0,0,0.75), 0 0 8px rgba(0,0,0,0.45)";
const FONT_STACKS = {
  sans: 'system-ui, -apple-system, "Segoe UI", "Noto Sans KR", Roboto, sans-serif',
  serif: 'Georgia, "Noto Serif KR", "Times New Roman", serif',
  mono: 'ui-monospace, "SFMono-Regular", Consolas, "Noto Sans Mono CJK KR", monospace',
} as const;

/**
 * 아무리 긴 제목/가수/가사도 화면 밖으로 나가지 않도록 줄 수를 제한한다(넘치면 … 처리).
 * 방송 화면은 스크롤할 수 없으므로 "전부 보여주기"보다 "화면을 넘지 않기"가 우선이다.
 */
function clampLines(n: number): React.CSSProperties {
  return { display: "-webkit-box", WebkitLineClamp: n, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" };
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

interface Palette {
  text: string;
  sub: string;
  accent: string;
  accentRaw: string;
}

function makePalette(s: OverlaySettings): Palette {
  const text = s.textColor ? `#${s.textColor}` : "#ffffff";
  const sub = s.subColor ? `#${s.subColor}` : s.textColor ? rgba(s.textColor, 0.72) : "rgba(255,255,255,0.72)";
  return { text, sub, accent: `#${s.accent}`, accentRaw: s.accent };
}

// ---------------------------------------------------------------- 곡 전환 (fade out → fade in)

type Phase = "idle" | "out" | "in";
const OUT_MS = 160;
const IN_MS = 220;

/**
 * 곡이 바뀔 때만 잠깐 사라졌다가 새 내용으로 나타나게 한다.
 * 같은 곡의 갱신(가사 줄 변경, heartbeat)은 즉시 반영하고, 타이머는 곡이 바뀔 때만 쓴다.
 */
function useSongSwap(state: LiveState | null, enabled: boolean): { shown: LiveState | null; phase: Phase } {
  const [shown, setShown] = useState<LiveState | null>(state);
  const [phase, setPhase] = useState<Phase>("idle");
  const shownRef = useRef<LiveState | null>(state);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    shownRef.current = shown;
  }, [shown]);

  useEffect(() => {
    const idOf = (s: LiveState | null) => (s ? `${s.mode}:${s.song?.id ?? ""}` : "none");
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const cur = shownRef.current;
    if (!enabled || !state || !cur || idOf(cur) === idOf(state)) {
      setShown(state);
      setPhase("idle");
      return;
    }
    setPhase("out");
    timer.current = window.setTimeout(() => {
      setShown(state);
      setPhase("in");
      timer.current = window.setTimeout(() => setPhase("idle"), IN_MS);
    }, OUT_MS);
  }, [state, enabled]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  return { shown, phase };
}

// ---------------------------------------------------------------- 배치 (위치 + 미세 조정)

const HORIZONTAL: Record<Exclude<OverlayPosition, "auto">, "l" | "c" | "r"> = {
  tl: "l", tc: "c", tr: "r", c: "c", bl: "l", bc: "c", br: "r",
};
const VERTICAL: Record<Exclude<OverlayPosition, "auto">, "t" | "m" | "b"> = {
  tl: "t", tc: "t", tr: "t", c: "m", bl: "b", bc: "b", br: "b",
};

function Place({
  pos,
  ox,
  oy,
  width,
  children,
}: {
  pos: Exclude<OverlayPosition, "auto">;
  ox: number;
  oy: number;
  /** CSS width. "fit" 이면 내용 크기에 맞춘다 */
  width: string;
  children: React.ReactNode;
}) {
  const h = HORIZONTAL[pos];
  const v = VERTICAL[pos];
  const MX = 2.5; // 좌우 여백 %
  const style: React.CSSProperties = { position: "absolute", overflow: "hidden" };
  let tx = "0";
  let ty = "0";
  // 미세 조정은 "여백 안쪽으로는 자유롭게, 화면 가장자리 밖으로는 못 나가게" 제한한다.
  // 남은 공간(가로/세로)에 맞춰 최대 너비·높이도 줄여서, 어떤 값에서도 콘텐츠가 화면 밖으로 나가지 않는다.
  let availW: number;
  if (h === "l") {
    const left = MX + Math.max(ox, -MX);
    style.left = `${left}%`;
    availW = 100 - left - MX;
  } else if (h === "r") {
    const right = MX - Math.min(ox, MX);
    style.right = `${right}%`;
    availW = 100 - right - MX;
  } else {
    const center = 50 + ox;
    style.left = `${center}%`;
    tx = "-50%";
    availW = 2 * (Math.min(center, 100 - center) - MX);
  }
  let availH: number;
  if (v === "t") {
    const top = 3 + Math.max(oy, -3);
    style.top = `${top}%`;
    availH = 100 - top - 1;
  } else if (v === "b") {
    const bottom = 4 - Math.min(oy, 4);
    style.bottom = `${bottom}%`;
    availH = 100 - bottom - 1;
  } else {
    const center = 50 + oy;
    style.top = `${center}%`;
    ty = "-50%";
    availH = 2 * (Math.min(center, 100 - center) - 1);
  }
  if (width === "fit") {
    style.width = "fit-content";
    style.maxWidth = `${availW}%`;
  } else {
    style.width = `min(${width}, ${availW}%)`;
  }
  style.maxHeight = `${availH}%`;
  if (tx !== "0" || ty !== "0") style.transform = `translate(${tx}, ${ty})`;
  return <div style={style}>{children}</div>;
}

function panelStyle(s: OverlaySettings): React.CSSProperties {
  const a = s.opacity / 100;
  switch (s.background) {
    case "transparent":
      return {};
    case "translucent":
      return { backgroundColor: rgba(s.bgColor || "000000", a), borderRadius: "0.9em", padding: "0.6em 0.95em" };
    case "card":
      return {
        backgroundColor: rgba(s.bgColor || "14161f", a),
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "1em",
        padding: "0.8em 1.1em",
      };
    case "solid":
      return { backgroundColor: `#${s.bgColor || "14161f"}`, borderRadius: "0.9em", padding: "0.8em 1.1em" };
  }
}

function flexAlign(a: Exclude<OverlayAlign, "auto">): "flex-start" | "center" | "flex-end" {
  return a === "left" ? "flex-start" : a === "center" ? "center" : "flex-end";
}

// ---------------------------------------------------------------- 조각들

function Cover({ videoId, settings, size }: { videoId?: string; settings: OverlaySettings; size: string }) {
  const [failed, setFailed] = useState(false);
  if (settings.coverStyle === "hidden" || !settings.showCover) return null;
  const hasImage = Boolean(videoId) && !failed;
  if (!hasImage && settings.coverFallback === "hide") return null;
  const radius = settings.coverStyle === "circle" ? "50%" : settings.coverStyle === "square" ? "0" : "0.6em";
  return (
    <div
      data-testid="overlay-cover"
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: radius,
        overflow: "hidden",
        backgroundColor: "rgba(255,255,255,0.1)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {hasImage ? (
        <img
          src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <Music2 style={{ width: "45%", height: "45%", opacity: 0.7 }} aria-hidden="true" />
      )}
    </div>
  );
}

function nextNonEmpty(lines: string[], from: number): string {
  for (let i = Math.max(0, from); i < lines.length; i++) if (lines[i].trim()) return lines[i];
  return "";
}
function prevNonEmpty(lines: string[], from: number): string {
  for (let i = Math.min(lines.length - 1, from); i >= 0; i--) if (lines[i].trim()) return lines[i];
  return "";
}

function Lyrics({
  state,
  settings,
  pal,
  currentSize,
  align,
}: {
  state: LiveState;
  settings: OverlaySettings;
  pal: Palette;
  currentSize: string;
  align: Exclude<OverlayAlign, "auto">;
}) {
  if (!settings.showLyrics || !state.synced || state.lines.length === 0) return null;
  const idx = state.lineIndex;
  const current = idx >= 0 ? state.lines[idx] ?? "" : "";
  const showPrev = settings.lyricsMode === "prevnext";
  const showNext = settings.lyricsMode !== "current";
  const prev = showPrev ? prevNonEmpty(state.lines, idx - 1) : "";
  const next = showNext ? nextNonEmpty(state.lines, idx + 1) : "";
  const rowBase: React.CSSProperties = { textAlign: align, overflowWrap: "anywhere", minHeight: "1.3em" };
  const rowClamp = (n: number): React.CSSProperties => ({ ...rowBase, ...clampLines(n) });
  const anim = settings.animation ? (settings.animStyle === "fade" ? "overlay-fade-in" : "overlay-line-in") : undefined;
  const accentGlow =
    settings.lyricAccent && settings.preset === "karaoke"
      ? `${TEXT_SHADOW}, 0 0 0.7em ${rgba(pal.accentRaw, 0.35)}`
      : undefined;
  // 곡이 바뀌면 key도 바뀌어서, 이전 곡 가사가 남지 않고 새 곡 기준으로 다시 그려진다
  const rowKey = `${state.song?.id ?? ""}:${idx}`;
  return (
    <div data-testid="overlay-lyrics" style={{ display: "flex", flexDirection: "column", gap: "0.3em", width: "100%" }}>
      {showPrev && (
        <div data-testid="overlay-prev" style={{ ...rowClamp(2), fontSize: "0.95em", color: pal.sub, opacity: 0.5, fontWeight: 400 }}>
          {prev}
        </div>
      )}
      <div
        key={rowKey}
        data-testid="overlay-current"
        className={anim}
        style={{
          ...rowClamp(3),
          fontSize: currentSize,
          fontWeight: settings.fontWeight,
          color: settings.lyricAccent ? pal.accent : pal.text,
          textShadow: accentGlow,
        }}
      >
        {current || "\u00A0"}
      </div>
      {showNext && (
        <div data-testid="overlay-next" style={{ ...rowClamp(2), fontSize: "1em", color: pal.sub, opacity: 0.85, fontWeight: 400 }}>
          {next || "\u00A0"}
        </div>
      )}
    </div>
  );
}

function metaText(state: LiveState, s: OverlaySettings): string {
  const song = state.song;
  if (!song) return "";
  const parts: string[] = [];
  if (s.showKey && song.key) parts.push(`Key ${song.key}`);
  if (s.showBpm && song.bpm) parts.push(`${song.bpm} BPM`);
  if (s.showDifficulty && song.difficulty)
    parts.push(`난이도 ${"●".repeat(song.difficulty)}${"○".repeat(Math.max(0, 5 - song.difficulty))}`);
  return parts.join(" · ");
}

function progressText(state: LiveState): string {
  if (state.total <= 0) return "";
  const last = state.total > 1 && state.index + 1 === state.total;
  return `${state.index + 1} / ${state.total}${last ? " · 마지막 곡" : ""}`;
}

/**
 * 곡 진행도. 실제 재생 시간은 받지 않으므로(가사 줄이 바뀔 때만 상태를 받는다) 시간 막대는 만들지 않고,
 * "플레이리스트에서 몇 번째 곡인지"만 글자/선/점으로 보여준다.
 */
function Progress({ state, settings, pal }: { state: LiveState; settings: OverlaySettings; pal: Palette }) {
  if (!settings.showProgress || state.total <= 0) return null;
  const ratio = Math.min(1, (state.index + 1) / state.total);
  const style = settings.progressStyle;
  const asDots = style === "dot" && state.total <= 12;
  const asBar = style === "thin" || style === "thick" || (style === "dot" && !asDots);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.3em", width: "100%" }}>
      {asBar && (
        <div
          data-testid="overlay-progress-bar"
          style={{
            height: style === "thick" ? "0.45em" : "0.18em",
            borderRadius: "999px",
            backgroundColor: "rgba(255,255,255,0.2)",
            overflow: "hidden",
          }}
        >
          <div style={{ width: `${ratio * 100}%`, height: "100%", backgroundColor: pal.accent }} />
        </div>
      )}
      {asDots && (
        <div data-testid="overlay-progress-dots" style={{ display: "flex", gap: "0.35em", flexWrap: "wrap" }}>
          {Array.from({ length: state.total }, (_, i) => (
            <span
              key={i}
              style={{
                width: "0.55em",
                height: "0.55em",
                borderRadius: "50%",
                backgroundColor: i <= state.index ? pal.accent : "rgba(255,255,255,0.25)",
              }}
            />
          ))}
        </div>
      )}
      <span data-testid="overlay-progress" style={{ fontSize: "0.8em", color: pal.accent, fontWeight: 600 }}>
        {progressText(state)}
      </span>
    </div>
  );
}

function nextCount(mode: OverlaySettings["queueMode"]): number {
  return mode === "current" ? 0 : mode === "next" ? 1 : 3;
}

/** LIVE QUEUE 목록 (오른쪽 위 고정) — "라이브 큐" 표시 옵션용 */
function QueuePanel({ state, settings, pal }: { state: LiveState; settings: OverlaySettings; pal: Palette }) {
  const cur = state.queue.findIndex((q) => q.id === state.song?.id);
  if (cur < 0 || state.queue.length === 0) return null;
  const items = state.queue.slice(cur, cur + 1 + nextCount(settings.queueMode));
  return (
    <div
      data-testid="overlay-queue"
      style={{
        position: "absolute",
        top: "3%",
        right: "2.5%",
        maxWidth: "32%",
        display: "flex",
        flexDirection: "column",
        gap: "0.35em",
        fontSize: "0.9em",
      }}
    >
      <div style={{ fontSize: "0.7em", letterSpacing: "0.14em", color: pal.sub, fontWeight: 600 }}>LIVE QUEUE</div>
      {items.map((q, i) => (
        <div
          key={q.id}
          style={{
            display: "flex",
            gap: "0.5em",
            alignItems: "baseline",
            color: i === 0 ? pal.accent : pal.sub,
            fontWeight: i === 0 ? 700 : 400,
            minWidth: 0,
          }}
        >
          <span aria-hidden="true">{i === 0 ? "●" : "○"}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.title}</span>
        </div>
      ))}
    </div>
  );
}

const NATIVE: Record<OverlayPreset, { pos: Exclude<OverlayPosition, "auto">; align: Exclude<OverlayAlign, "auto">; width: string }> = {
  minimal: { pos: "bl", align: "left", width: "46em" },
  card: { pos: "bl", align: "left", width: "42em" },
  subtitle: { pos: "bc", align: "center", width: "60em" },
  lyrics: { pos: "bc", align: "center", width: "64em" },
  karaoke: { pos: "c", align: "center", width: "60em" },
  nowplaying: { pos: "tl", align: "left", width: "fit" },
  mini: { pos: "tl", align: "left", width: "fit" },
  lowerthird: { pos: "bc", align: "left", width: "70em" },
  covercard: { pos: "bl", align: "center", width: "16em" },
  queue: { pos: "tr", align: "left", width: "22em" },
  vertical: { pos: "c", align: "center", width: "34em" },
  banner: { pos: "bc", align: "left", width: "fit" },
};


// ---------------------------------------------------------------- 가로 배너형

/**
 * 한 줄짜리 글자가 칸보다 길면 글자 크기를 줄여서(최소 55%) 맞추고, 그래도 넘치면 … 으로 줄인다.
 * 측정/조정은 DOM에서 직접 하므로 React 리렌더를 만들지 않는다 (OBS에서 불필요한 렌더 방지).
 */
function FitText({ text, base, style, testId }: { text: string; base: number; style?: React.CSSProperties; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = `${base}em`;
      if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth) {
        const k = Math.max(0.55, (el.clientWidth / el.scrollWidth) * 0.97);
        el.style.fontSize = `${base * k}em`;
      }
    };
    fit();
    // 웹폰트가 늦게 로드돼 글자 폭이 바뀌는 경우까지 다시 맞춘다
    void document.fonts?.ready.then(fit);
  });
  return (
    <div
      ref={ref}
      data-testid={testId}
      title={text}
      style={{ fontSize: `${base}em`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, maxWidth: "100%", ...style }}
    >
      {text}
    </div>
  );
}

const REQUESTER_MAX = 30;
function requesterLabel(name: string | undefined): string {
  return typeof name === "string" ? name.trim().slice(0, REQUESTER_MAX) : "";
}

const PLAYBACK_LABEL = { playing: "▶ 재생 중", paused: "⏸ 일시정지", waiting: "⏳ 대기" } as const;

function Banner({
  state,
  settings,
  pal,
  width,
  height,
  pos,
  align,
}: {
  state: LiveState;
  settings: OverlaySettings;
  pal: Palette;
  width: number;
  height: number;
  pos: Exclude<OverlayPosition, "auto">;
  align: Exclude<OverlayAlign, "auto">;
}) {
  const song = state.song!;
  const bs = bannerSize(settings);
  const vw = Math.max(1, width);
  const vh = height > 0 ? height : (vw * 9) / 16;
  // OBS 소스가 배너보다 작으면 통째로 줄여서 맞춘다 (잘리거나 스크롤이 생기지 않게). 크면 1:1.
  const k = Math.min(1, vw / bs.w, vh / bs.h);
  const pxW = bs.w * k;
  const pxH = bs.h * k;
  const freeX = Math.max(0, vw - pxW);
  const freeY = Math.max(0, vh - pxH);
  const h = HORIZONTAL[pos];
  const v = VERTICAL[pos];
  const baseX = h === "l" ? 0 : h === "c" ? freeX / 2 : freeX;
  const baseY = v === "t" ? 0 : v === "m" ? freeY / 2 : freeY;
  const left = Math.min(freeX, Math.max(0, baseX + (settings.offsetX / 100) * vw));
  const top = Math.min(freeY, Math.max(0, baseY + (settings.offsetY / 100) * vh));

  const font = bs.h * 0.105 * (settings.size / 100); // 배너 높이에 비례 (180px → 약 19px)
  const gapEm = settings.gap / 10;
  const alignItems = flexAlign(align);
  const idx = state.queue.findIndex((q) => q.id === song.id);
  const curItem = idx >= 0 ? state.queue[idx] : undefined;
  const nextItem = idx >= 0 ? state.queue[idx + 1] : undefined;
  const requester = requesterLabel(song.requester ?? curItem?.requester);
  const nextRequester = requesterLabel(nextItem?.requester);
  const showLyrics = settings.showLyrics && state.synced && state.lines.length > 0;
  const showNext = settings.showNext && Boolean(nextItem);
  const panel = panelStyle(settings);
  const coverEm = (bs.h * 0.62) / font;
  const colStyle: React.CSSProperties = { display: "flex", flexDirection: "column", justifyContent: "center", alignItems, textAlign: align, minWidth: 0, gap: "0.15em", height: "100%" };
  const label = (t: string, color = pal.accent): React.ReactNode => (
    <div style={{ fontSize: "0.62em", letterSpacing: "0.14em", fontWeight: 700, color, whiteSpace: "nowrap" }}>{t}</div>
  );
  const reqLine = (name: string, tid: string) =>
    settings.showRequester && name ? (
      <FitText text={`🙋 ${name}`} base={0.8} testId={tid} style={{ color: pal.accent, fontWeight: 600 }} />
    ) : null;

  const inner = (
    <div
      data-testid="overlay-banner"
      style={{
        width: bs.w,
        height: bs.h,
        boxSizing: "border-box",
        transform: `scale(${k})`,
        transformOrigin: "0 0",
        fontSize: `${font}px`,
        display: "flex",
        alignItems: "center",
        gap: `${gapEm}em`,
        overflow: "hidden",
        ...panel,
        padding: `${Math.max(0.3, gapEm * 0.6)}em ${Math.max(0.6, gapEm)}em`,
      }}
    >
      {settings.showCover && <Cover videoId={song.youtubeVideoId} settings={settings} size={`${coverEm}em`} key={song.youtubeVideoId ?? "none"} />}
      {settings.showCurrent && (
        <div data-testid="overlay-current-song" style={{ ...colStyle, flex: "1.3 1 0" }}>
          <div style={{ display: "flex", gap: "0.6em", alignItems: "baseline", justifyContent: alignItems, whiteSpace: "nowrap" }}>
            {label("NOW")}
            {state.playback && (
              <span data-testid="overlay-playback" style={{ fontSize: "0.62em", color: pal.sub }}>
                {PLAYBACK_LABEL[state.playback] ?? ""}
              </span>
            )}
            {settings.showProgress && state.total > 0 && (
              <span data-testid="overlay-progress" style={{ fontSize: "0.62em", color: pal.sub }}>
                {progressText(state)}
              </span>
            )}
          </div>
          {settings.showTitle && <FitText text={song.title} base={1.5} testId="overlay-title" style={{ fontWeight: settings.fontWeight, width: "100%" }} />}
          {settings.showArtist && song.artist && <FitText text={song.artist} base={0.95} testId="overlay-artist" style={{ color: pal.sub, width: "100%" }} />}
          {reqLine(requester, "overlay-requester")}
        </div>
      )}
      {showLyrics && (
        <div
          data-testid="overlay-lyrics-area"
          style={{ ...colStyle, flex: "1.6 1 0", height: `${settings.lyricsH}%`, overflow: "hidden", justifyContent: "center" }}
        >
          <Lyrics state={state} settings={settings} pal={pal} currentSize="1.25em" align={align} />
        </div>
      )}
      {showNext && nextItem && (
        <div data-testid="overlay-next-song" style={{ ...colStyle, flex: "1 1 0" }}>
          {label("NEXT", pal.sub)}
          <FitText text={nextItem.title} base={1.05} testId="overlay-next-title" style={{ fontWeight: 600, width: "100%" }} />
          {nextItem.artist && <FitText text={nextItem.artist} base={0.8} testId="overlay-next-artist" style={{ color: pal.sub, width: "100%" }} />}
          {reqLine(nextRequester, "overlay-next-requester")}
        </div>
      )}
    </div>
  );
  return (
    <div style={{ position: "absolute", left, top, width: pxW, height: pxH, overflow: "hidden" }}>{inner}</div>
  );
}

// ---------------------------------------------------------------- 본체

export function OverlayView({ state, status, settings, width, height = 0, minPx = 14 }: OverlayViewProps) {
  const { shown, phase } = useSongSwap(state, settings.animation);
  const pal = makePalette(settings);
  // Vertical 프리셋은 세로 화면에서만 글자를 키운다 (가로 화면에서는 세로가 모자라 넘치기 때문)
  const portrait = height > width;
  const scale = settings.preset === "vertical" && portrait ? 1.6 : 1;
  const fontSize = Math.max(minPx, Math.min(96, width * 0.016 * (settings.size / 100) * scale));
  const useShadow = settings.background === "transparent" || settings.background === "translucent";
  const rootStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    overflow: "hidden",
    fontSize: `${fontSize}px`,
    color: pal.text,
    textShadow: useShadow ? TEXT_SHADOW : "none",
    fontFamily: FONT_STACKS[settings.fontFamily],
    lineHeight: settings.lineHeight / 100,
    letterSpacing: `${settings.letterSpacing / 100}em`,
  };
  // 곡 전환: 나가는 동안 투명해지고, 새 곡이 들어올 때 페이드 인
  const swapStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    opacity: phase === "out" ? 0 : 1,
    transition: phase === "out" ? `opacity ${OUT_MS}ms ease-in` : undefined,
  };
  const swapClass = phase === "in" ? "overlay-fade-in" : undefined;
  const panel = panelStyle(settings);
  const native = NATIVE[settings.preset];
  const pos = settings.position === "auto" ? native.pos : settings.position;
  const align: Exclude<OverlayAlign, "auto"> = settings.align === "auto" ? native.align : settings.align;
  const alignItems = flexAlign(align);
  const place = (node: React.ReactNode, widthOverride?: string) => (
    <Place pos={pos} ox={settings.offsetX} oy={settings.offsetY} width={widthOverride ?? native.width}>
      {node}
    </Place>
  );

  const centered = (children: React.ReactNode) => (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.4em", textAlign: "center", padding: "0 5%" }}>
      {children}
    </div>
  );

  // ---- 곡이 없는 상태 ----
  if (!shown || (shown.mode !== "finished" && shown.mode !== "test" && !shown.song)) {
    if (settings.idle === "hidden") return <div data-testid="overlay-root" data-status={status} style={rootStyle} />;
    if (settings.idle === "start" || settings.idle === "custom") {
      const msg = settings.idle === "custom" && settings.idleText ? settings.idleText : "잠시 후 방송을 시작합니다";
      return (
        <div data-testid="overlay-root" data-status={status} style={rootStyle}>
          {centered(
            <>
              <div style={{ fontSize: "2.4em" }} aria-hidden="true">🎤</div>
              <div data-testid="overlay-status" style={{ fontSize: "1.6em", fontWeight: settings.fontWeight, ...clampLines(3) }}>
                {msg}
              </div>
            </>
          )}
        </div>
      );
    }
    return (
      <div data-testid="overlay-root" data-status={status} style={rootStyle}>
        <div
          data-testid="overlay-status"
          style={{ position: "absolute", left: "2.5%", bottom: "4%", fontSize: "0.85em", color: pal.sub, opacity: 0.8, ...panel }}
        >
          {status === "lost" ? "No active song" : "Waiting for Song"}
        </div>
      </div>
    );
  }

  // ---- 연결 테스트 (설정 화면의 "OBS 연결 테스트") ----
  if (shown.mode === "test") {
    return (
      <div data-testid="overlay-root" data-status="test" style={rootStyle}>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5%" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "0.35em",
              textAlign: "center",
              backgroundColor: "rgba(20,22,31,0.88)",
              border: `1px solid ${pal.accent}`,
              borderRadius: "1em",
              padding: "1.2em 2em",
              textShadow: "none",
              color: "#fff",
            }}
          >
            <div style={{ fontSize: "2em" }} aria-hidden="true">🎤</div>
            <div style={{ fontSize: "1.1em", fontWeight: 700, color: pal.accent }}>Songbook Manager</div>
            <div data-testid="overlay-status" style={{ fontSize: "1.6em", fontWeight: 700 }}>OBS 연결 테스트</div>
            <div style={{ fontSize: "0.95em", color: "rgba(255,255,255,0.72)" }}>이 화면이 보이면 정상 연결입니다.</div>
          </div>
        </div>
      </div>
    );
  }

  // ---- 공연 종료 ----
  if (shown.mode === "finished") {
    if (settings.endMode === "hide") return <div data-testid="overlay-root" data-status="finished" style={rootStyle} />;
    const [main, sub]: [string, string | null] =
      settings.endMode === "finished"
        ? ["Set Finished", null]
        : settings.endMode === "thanks"
          ? ["Thanks for watching", null]
          : settings.endMode === "custom" && settings.endText
            ? [settings.endText, null]
            : ["오늘의 공연이 끝났습니다", "시청해주셔서 감사합니다"];
    return (
      <div data-testid="overlay-root" data-status="finished" style={rootStyle}>
        {centered(
          <>
            <div data-testid="overlay-status" style={{ fontSize: "2em", fontWeight: settings.fontWeight, ...clampLines(3) }}>
              {main}
            </div>
            {sub && <div style={{ fontSize: "1.1em", color: pal.sub }}>{sub}</div>}
          </>
        )}
      </div>
    );
  }

  const state2 = shown;
  const song = state2.song!;
  const meta = metaText(state2, settings);
  const videoId = song.youtubeVideoId;
  const coverKey = videoId ?? "none";

  const titleEl = settings.showTitle && (
    <div data-testid="overlay-title" style={{ fontSize: "1.5em", fontWeight: settings.fontWeight, ...clampLines(2) }}>
      {song.title}
    </div>
  );
  const artistEl = settings.showArtist && song.artist && (
    <div data-testid="overlay-artist" style={{ fontSize: "0.95em", color: pal.sub, ...clampLines(2) }}>
      {song.artist}
    </div>
  );
  const metaEl = meta && <div style={{ fontSize: "0.8em", color: pal.sub, ...clampLines(2) }}>{meta}</div>;
  const progressEl = <Progress state={state2} settings={settings} pal={pal} />;
  const lyricsEl = (size: string) => <Lyrics state={state2} settings={settings} pal={pal} currentSize={size} align={align} />;
  const col = (gap = "0.2em"): React.CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    gap,
    alignItems,
    textAlign: align,
    minWidth: 0,
  });

  let body: React.ReactNode;
  switch (settings.preset) {
    case "banner":
      body = <Banner state={state2} settings={settings} pal={pal} width={width} height={height} pos={pos} align={align} />;
      break;
    case "mini": {
      const text = [settings.showTitle ? song.title : "", settings.showArtist ? song.artist : ""].filter(Boolean).join(" · ");
      const p = settings.showProgress ? progressText(state2) : "";
      body = place(
        <div style={{ display: "flex", gap: "0.6em", alignItems: "center", ...panel }}>
          <span aria-hidden="true">🎵</span>
          <span data-testid="overlay-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: settings.fontWeight }}>
            {text}
          </span>
          {p && (
            <span data-testid="overlay-progress" style={{ color: pal.accent, fontSize: "0.85em", flexShrink: 0 }}>
              {p}
            </span>
          )}
        </div>
      );
      break;
    }
    case "nowplaying":
      body = place(
        <div style={{ display: "flex", gap: "0.9em", alignItems: "center", ...panel }}>
          <Cover key={coverKey} videoId={videoId} settings={settings} size="4.2em" />
          <div style={col("0.15em")}>
            <div style={{ fontSize: "0.7em", letterSpacing: "0.16em", color: pal.accent, fontWeight: 700 }}>🎵 NOW PLAYING</div>
            {titleEl}
            {artistEl}
            {metaEl}
            {progressEl}
          </div>
        </div>
      );
      break;
    case "card":
      body = place(
        <div style={{ display: "flex", gap: "1em", alignItems: "center", ...panel }}>
          <Cover key={coverKey} videoId={videoId} settings={settings} size="6em" />
          <div style={{ ...col(), flex: 1 }}>
            {titleEl}
            {artistEl}
            {metaEl}
            {progressEl}
            <div style={{ height: "0.4em" }} />
            {lyricsEl("1.5em")}
          </div>
        </div>
      );
      break;
    case "covercard":
      body = place(
        <div style={{ ...col("0.4em"), ...panel }}>
          <Cover key={coverKey} videoId={videoId} settings={settings} size="100%" />
          {titleEl}
          {artistEl}
          {metaEl}
          {progressEl}
        </div>
      );
      break;
    case "lowerthird":
      body = place(
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.8em",
            borderTop: `0.12em solid ${pal.accent}`,
            borderBottom: "1px solid rgba(255,255,255,0.25)",
            padding: "0.55em 0.9em",
            ...panel,
          }}
        >
          <span aria-hidden="true" style={{ fontSize: "1.4em" }}>🎵</span>
          <div style={{ ...col("0.05em"), flex: 1 }}>
            {titleEl}
            {artistEl}
            {metaEl}
          </div>
          {settings.showProgress && state2.total > 0 && (
            <span data-testid="overlay-progress" style={{ color: pal.accent, fontSize: "0.85em", flexShrink: 0 }}>
              {progressText(state2)}
            </span>
          )}
        </div>
      );
      break;
    case "queue": {
      const cur = state2.queue.findIndex((q) => q.id === song.id);
      const upcoming = cur >= 0 ? state2.queue.slice(cur + 1, cur + 1 + nextCount(settings.queueMode)) : [];
      body = place(
        <div data-testid="overlay-queue" style={{ ...col("0.25em"), ...panel }}>
          <div style={{ fontSize: "0.7em", letterSpacing: "0.16em", color: pal.accent, fontWeight: 700 }}>NOW</div>
          <div data-testid="overlay-title" style={{ fontSize: "1.3em", fontWeight: settings.fontWeight, ...clampLines(2) }}>
            {song.title}
          </div>
          {settings.showArtist && song.artist && (
            <div data-testid="overlay-artist" style={{ fontSize: "0.9em", color: pal.sub, ...clampLines(1) }}>
              {song.artist}
            </div>
          )}
          {upcoming.length > 0 && (
            <>
              <div style={{ fontSize: "0.7em", letterSpacing: "0.16em", color: pal.sub, fontWeight: 700, marginTop: "0.5em" }}>NEXT</div>
              {upcoming.map((q) => (
                <div key={q.id} data-testid="overlay-queue-next" style={{ fontSize: "0.95em", ...clampLines(1) }}>
                  {q.title}
                </div>
              ))}
            </>
          )}
          {progressEl}
        </div>
      );
      break;
    }
    case "subtitle":
    case "lyrics":
      body = place(
        <div style={{ ...col("0.3em"), ...panel }}>
          {(titleEl || artistEl) && (
            <div style={{ fontSize: "0.7em", textAlign: align, width: "100%" }}>
              {titleEl}
              {artistEl}
            </div>
          )}
          {metaEl}
          {progressEl}
          {lyricsEl(settings.preset === "lyrics" ? "2.4em" : "1.9em")}
        </div>
      );
      break;
    case "karaoke":
      body = place(
        <div style={{ ...col("1em"), ...panel }}>
          {(titleEl || artistEl) && (
            <div style={{ fontSize: "0.6em", textAlign: align, width: "100%" }}>
              {titleEl}
              {artistEl}
              {metaEl}
            </div>
          )}
          {progressEl}
          {lyricsEl("2.8em")}
        </div>
      );
      break;
    case "vertical":
      body = place(
        <div style={{ ...col("0.5em"), ...panel }}>
          <div style={{ width: "58%", maxWidth: portrait ? "16em" : "7em" }}>
            <Cover key={coverKey} videoId={videoId} settings={settings} size="100%" />
          </div>
          {titleEl}
          {artistEl}
          {metaEl}
          <div style={{ height: "0.6em" }} />
          {lyricsEl("1.9em")}
          <div style={{ height: "0.4em" }} />
          {progressEl}
        </div>
      );
      break;
    default:
      body = place(
        <div style={{ ...col(), ...panel }}>
          {titleEl}
          {artistEl}
          {metaEl}
          {progressEl}
          <div style={{ height: "0.5em" }} />
          {lyricsEl("1.7em")}
        </div>
      );
  }

  const queue =
    settings.showQueue && settings.preset !== "mini" && settings.preset !== "queue" && settings.preset !== "banner" ? (
      <QueuePanel state={state2} settings={settings} pal={pal} />
    ) : null;

  return (
    <div data-testid="overlay-root" data-status="active" data-preset={settings.preset} style={rootStyle}>
      <div key={`${state2.mode}:${song.id}`} className={swapClass} style={swapStyle}>
        {body}
        {queue}
      </div>
    </div>
  );
}

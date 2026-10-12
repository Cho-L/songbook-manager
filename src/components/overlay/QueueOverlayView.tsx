import type { CSSProperties } from "react";
import type { PublicQueue } from "../../utils/songRequest";
import { toQueueView, type QueueOverlaySettings } from "../../utils/queueOverlay";
import type { StudioBox } from "../../utils/overlayStudio";

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** 긴 제목은 한글 단어 단위(keep-all)로 줄바꿈하고 최대 2줄까지만 보여준다 (넘치면 …) */
const clamp2: CSSProperties = {
  minWidth: 0,
  wordBreak: "keep-all",
  overflowWrap: "anywhere",
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 2,
  overflow: "hidden",
};

interface Props {
  queue: PublicQueue | null;
  settings: QueueOverlaySettings;
  /** 있으면 Studio 모드: 박스가 OBS 화면 전체를 채우고 테두리/반경/여백이 적용된다. 없으면 옛 URL 모습(내용 크기에 맞춘 박스). */
  box?: StudioBox;
  /** 서버 연결을 확인하는 중 (우상단 점) */
  stale?: boolean;
}

/** 대기열 오버레이의 그림 부분. OBS 페이지와 Studio 미리보기가 같은 컴포넌트를 쓴다 (미리보기 = 실제 화면). */
export function QueueOverlayView({ queue, settings: s, box, stale }: Props) {
  const view = toQueueView(queue, s.n);
  const textShadow = "0 1px 3px rgba(0,0,0,.7)";
  const justify = s.align === "center" ? "center" : s.align === "right" ? "flex-end" : "flex-start";
  const row: CSSProperties = { display: "flex", alignItems: "baseline", gap: "0.5em", justifyContent: justify, minWidth: 0, marginTop: `${s.gap / 10}em` };
  const meta: CSSProperties = { opacity: 0.8, fontSize: "0.75em", ...clamp2, WebkitLineClamp: 1, flex: "0 1 auto" };
  const hasAny = Boolean(view.playing) || view.upcoming.length > 0;

  const frame: CSSProperties = box
    ? {
        display: "block",
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        overflow: "hidden",
        padding: box.padding,
        borderRadius: box.radius,
        border: box.borderW > 0 ? `${box.borderW}px solid ${box.borderColor}` : "none",
      }
    : { display: "inline-block", maxWidth: "100%", boxSizing: "border-box", padding: "0.45em 0.7em", borderRadius: "0.4em" };

  const renderItem = (key: string, index: number | string, it: { title: string; artist: string; requesterName: string }, playing = false) => (
    <div key={key} style={row} data-testid={playing ? "qo-playing" : "qo-item"}>
      <span style={{ color: s.ac, fontWeight: 800, minWidth: playing ? undefined : "1.2em", flex: "0 0 auto" }}>{index}</span>
      {s.st && <span style={{ ...clamp2, fontWeight: playing ? 800 : s.fw, flex: "1 1 auto", textAlign: s.align }}>{it.title}</span>}
      {s.sa && <span style={meta}>{it.artist}</span>}
      {s.req && <span style={{ ...meta, fontSize: "0.7em", whiteSpace: "nowrap", flex: "0 0 auto", overflow: "visible" }}>🙋 {it.requesterName}</span>}
    </div>
  );

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", color: s.tc, fontSize: s.fs, fontFamily: "system-ui, 'Noto Sans KR', sans-serif", textAlign: s.align }} data-testid="queue-overlay">
      <div style={{ ...frame, background: rgba(s.bgc, s.bg / 100), textShadow, position: "relative" }}>
        {s.head && <div style={{ fontSize: "0.7em", opacity: 0.85, color: s.ac, fontWeight: 700 }}>🎤 신청곡 대기열</div>}
        {s.sc && view.playing && renderItem(view.playing.id, "▶", view.playing, true)}
        {s.sn && view.upcoming.map((it, i) => renderItem(it.id, i === 0 && !view.playing ? "다음" : i + 1, it))}
        {queue && !hasAny && <div style={{ opacity: 0.75, fontSize: "0.8em" }} data-testid="qo-empty">대기 중인 신청곡이 없어요</div>}
        {!queue && <div style={{ opacity: 0.6, fontSize: "0.8em" }}>불러오는 중…</div>}
        {s.sn && view.more > 0 && <div style={{ opacity: 0.75, fontSize: "0.7em", marginTop: `${s.gap / 10}em` }} data-testid="qo-more">외 {view.more}곡 대기 중</div>}
        {stale && <span title="서버 연결을 확인하는 중이에요" data-testid="qo-stale" style={{ position: "absolute", top: 4, right: 4, width: 8, height: 8, borderRadius: 4, background: "#f59e0b" }} />}
      </div>
    </div>
  );
}

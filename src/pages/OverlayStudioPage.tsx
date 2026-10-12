import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, ChevronLeft, Copy, ExternalLink, RotateCcw, Save } from "lucide-react";
import { OverlayView } from "../components/overlay/OverlayView";
import { QueueOverlayView } from "../components/overlay/QueueOverlayView";
import { confirmAsync, notify } from "../components/ui/feedback";
import { useBookDesign } from "../hooks/useBookDesign";
import { adminOverlayConfigs, type SaveResult } from "../services/overlayConfigRepository";
import { OVERLAY_PRESETS, OVERLAY_POSITIONS, presetDefaults, type OverlayPreset, type OverlaySettings } from "../types/overlay";
import { getChromeCssVars } from "../utils/color";
import type { LiveState } from "../utils/liveBroadcast";
import { getLiveKey } from "../utils/liveBroadcast";
import {
  BOX_LIMITS,
  KIND_DESC,
  KIND_LABEL,
  KIND_PRESETS,
  OVERLAY_KINDS,
  buildPortableUrl,
  buildStudioUrl,
  constrainOverlay,
  defaultStudioConfig,
  recommendedSize,
  sanitizeStudioConfig,
  toStoredConfig,
  type OverlayKind,
  type StudioBox,
  type StudioConfig,
} from "../utils/overlayStudio";
import type { QueueOverlaySettings } from "../utils/queueOverlay";
import type { PublicQueue } from "../utils/songRequest";

// 미리보기 샘플 (실제 곡/신청 데이터가 아니다). 긴 제목으로 줄바꿈도 함께 확인할 수 있다.
const SAMPLE_LIVE: LiveState = {
  v: 1, bookId: "sample", mode: "concert",
  song: { id: "s3", title: "샘플 곡 제목 — 아주 길어서 줄바꿈이 필요한 한글 노래 제목 예시", artist: "샘플 가수", key: "Bb", bpm: 87, difficulty: 3, requester: "샘플시청자" },
  lines: ["첫 번째 가사가 여기에 표시돼요", "지금 부르는 가사가 가장 크게 보여요", "다음 가사는 조금 작게 보여요", "그 다음 가사"],
  lineIndex: 1, synced: true, index: 2, total: 8,
  queue: [
    { id: "s3", title: "샘플 곡 제목", artist: "샘플 가수" },
    { id: "s4", title: "다음 곡 하나", artist: "가수", requester: "다음신청자" },
    { id: "s5", title: "그다음 곡", artist: "가수" },
  ],
  ts: 0,
};
const SAMPLE_QUEUE: PublicQueue = {
  accepting: true, pendingCount: 0,
  queue: [
    { id: "a", title: "지금 부르는 곡", artist: "샘플 가수", requesterName: "철수", status: "playing" },
    { id: "b", title: "두 번째로 부를 곡의 아주 긴 제목이 여기에 들어가면 이렇게 줄바꿈돼요", artist: "가수", requesterName: "영희", status: "approved" },
    { id: "c", title: "세 번째 곡", artist: "가수", requesterName: "민수", status: "approved" },
    { id: "d", title: "네 번째 곡", artist: "가수", requesterName: "지수", status: "approved" },
    { id: "e", title: "다섯 번째 곡", artist: "가수", requesterName: "하나", status: "approved" },
    { id: "f", title: "여섯 번째 곡", artist: "가수", requesterName: "두리", status: "approved" },
    { id: "g", title: "일곱 번째 곡", artist: "가수", requesterName: "세리", status: "approved" },
  ],
};

type Backdrop = "dark" | "light" | "checker";
const BACKDROP_CSS: Record<Backdrop, string> = {
  dark: "#1b1d27",
  light: "#e5e7eb",
  checker: "repeating-conic-gradient(#3b3f4f 0% 25%, #2a2d3a 0% 50%) 50% / 24px 24px",
};

const inputCls = "book-input w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none";
const smallBtn = "inline-flex items-center gap-1 rounded-lg border px-2.5 min-h-[36px] text-[12.5px] disabled:opacity-40";

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-[12px]">
      <span className="block mb-1" style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.55))" }}>{label}</span>
      {children}
      {hint && <span className="block mt-0.5 text-[11px] opacity-60">{hint}</span>}
    </label>
  );
}

export function OverlayStudioPage() {
  const { ownerId } = useParams();
  const navigate = useNavigate();
  const { design } = useBookDesign(ownerId);
  const [kind, setKind] = useState<OverlayKind>("queue");
  const [draft, setDraft] = useState<StudioConfig>(() => defaultStudioConfig("queue"));
  const [savedJson, setSavedJson] = useState<string>("");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [saveInfo, setSaveInfo] = useState<SaveResult | null>(null);
  const [copied, setCopied] = useState<"" | "studio" | "portable">("");
  const [backdrop, setBackdrop] = useState<Backdrop>("checker");
  const [panelW, setPanelW] = useState(560);
  const panelRef = useRef<HTMLDivElement>(null);

  const style = {
    "--book-accent": design.accentColor, "--book-background": design.backgroundColor, "--book-surface": design.surfaceColor, "--book-text": design.textColor,
    ...getChromeCssVars(design.backgroundColor), backgroundColor: design.backgroundColor, color: design.textColor,
  } as React.CSSProperties;
  const muted = { color: "var(--book-chrome-muted, rgba(255,255,255,0.55))" } as const;
  const box = { backgroundColor: "var(--book-chrome-surface, rgba(255,255,255,0.05))", borderColor: "var(--book-chrome-border, rgba(255,255,255,0.12))" } as const;
  const field = { ...box, color: "var(--book-text,#fff)" };

  // 종류 탭이 바뀌면 그 종류의 저장된 설정(없으면 기본값)을 불러온다
  useEffect(() => {
    if (!ownerId) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 종류가 바뀌는 순간 "불러오는 중"으로 되돌리는 동기화
    setLoadState("loading");
    setSaveInfo(null);
    adminOverlayConfigs
      .load(ownerId, kind)
      .then((r) => {
        if (!alive) return;
        const cfg = r.config ?? defaultStudioConfig(kind);
        setDraft(cfg);
        setSavedJson(JSON.stringify(toStoredConfig(cfg)));
        setLoadState("ready");
      })
      .catch(() => {
        if (!alive) return;
        const cfg = defaultStudioConfig(kind);
        setDraft(cfg);
        setSavedJson(JSON.stringify(toStoredConfig(cfg)));
        setLoadState("error");
      });
    return () => {
      alive = false;
    };
  }, [ownerId, kind]);

  useEffect(() => {
    const el = panelRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setPanelW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dirty = JSON.stringify(toStoredConfig(draft)) !== savedJson;
  const liveKey = ownerId ? getLiveKey(ownerId) : "";
  const origin = window.location.origin;
  const studioUrl = ownerId ? buildStudioUrl(origin, kind, ownerId, liveKey) : "";
  const portableUrl = ownerId ? buildPortableUrl(origin, draft, ownerId, liveKey) : "";

  const patchOverlay = useCallback((p: Partial<OverlaySettings>) => setDraft((d) => (d.kind === "queue" ? d : sanitizeStudioConfig(d.kind, { ...toStoredConfig(d), overlay: { ...d.overlay, ...p } }))), []);
  const patchQueue = useCallback((p: Partial<QueueOverlaySettings>) => setDraft((d) => sanitizeStudioConfig(d.kind, { ...toStoredConfig(d), queue: { ...d.queue, ...p } })), []);
  const patchBox = useCallback((p: Partial<StudioBox>) => setDraft((d) => sanitizeStudioConfig(d.kind, { ...toStoredConfig(d), box: { ...d.box, ...p } })), []);

  async function save() {
    if (!ownerId || saving) return;
    setSaving(true);
    try {
      const r = await adminOverlayConfigs.save(ownerId, kind, draft);
      setSaveInfo(r);
      setSavedJson(JSON.stringify(toStoredConfig(draft)));
      notify(r.serverIssue === null ? "저장했어요. OBS 화면에 곧 반영돼요." : "이 브라우저에 저장했어요 (서버 저장은 안 됨).", r.serverIssue === null ? "success" : "info");
    } catch {
      notify("저장하지 못했어요. 잠시 후 다시 시도해주세요.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function restore() {
    const ok = await confirmAsync({ title: "기본값으로 되돌릴까요?", message: `${KIND_LABEL[kind]} 오버레이의 편집 중인 설정을 기본값으로 바꿔요. "저장"을 누르기 전에는 OBS 화면이 바뀌지 않아요.`, confirmLabel: "기본값 복원" });
    if (ok) setDraft(defaultStudioConfig(kind));
  }

  async function copy(text: string, which: "studio" | "portable") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      window.setTimeout(() => setCopied(""), 1500);
    } catch {
      notify("복사하지 못했어요. 주소를 직접 선택해서 복사해주세요.", "error");
    }
  }

  // 미리보기: 실제 OBS 크기(box.w × box.h)로 그린 뒤 패널 폭에 맞게 축소한다 = 실제 화면과 같은 모습
  const scale = Math.min(1, Math.max(0.1, (panelW - 2) / draft.box.w));
  const previewH = Math.round(draft.box.h * scale);
  const inset = draft.box.padding + draft.box.borderW;
  const ov = draft.overlay;

  return (
    <div className="book-focus max-w-md lg:max-w-6xl mx-auto pb-16 min-h-screen px-5 pt-5" style={style} data-testid="studio-page">
      <button type="button" onClick={() => navigate(-1)} className="inline-flex items-center gap-1 text-[13px] mb-3" style={muted}>
        <ChevronLeft className="h-4 w-4" /> 뒤로
      </button>
      <h1 className="text-xl font-semibold mb-1">OBS Overlay Studio</h1>
      <p className="text-[13px] mb-4" style={muted}>오버레이 종류마다 따로 꾸미고 저장해서, 각각 다른 OBS 브라우저 소스로 연결하세요.</p>

      <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="오버레이 종류">
        {OVERLAY_KINDS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} data-testid={`studio-tab-${k}`} onClick={() => !saving && setKind(k)} className="rounded-full border px-3.5 min-h-[40px] text-[13px] font-medium" style={kind === k ? { backgroundColor: "var(--book-accent,#fbbf24)", color: "#14161F", borderColor: "transparent" } : box}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <p className="text-[12px] mb-3" style={muted}>{KIND_DESC[kind]}</p>

      {loadState === "error" && <div role="alert" className="rounded-xl border px-4 py-2.5 text-[12.5px] mb-3" style={{ ...box, color: "#f87171" }}>저장된 설정을 불러오지 못해 기본값으로 시작했어요. 저장하면 기존 설정을 덮어쓰니 주의하세요.</div>}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-5">
        {/* 미리보기 */}
        <section aria-label="미리보기" className="min-w-0 order-1">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h2 className="text-[14px] font-semibold">실시간 미리보기 <span className="text-[12px] font-normal" style={muted}>권장 OBS 소스 크기 {recommendedSize(draft)}</span></h2>
            <div className="flex gap-1" role="group" aria-label="미리보기 배경">
              {(["checker", "dark", "light"] as Backdrop[]).map((b) => (
                <button key={b} type="button" aria-pressed={backdrop === b} onClick={() => setBackdrop(b)} className="rounded-md border px-2 min-h-[28px] text-[11.5px]" style={backdrop === b ? { ...box, outline: "2px solid var(--book-accent,#fbbf24)" } : box}>
                  {b === "checker" ? "투명" : b === "dark" ? "어두움" : "밝음"}
                </button>
              ))}
            </div>
          </div>
          <div ref={panelRef} className="w-full rounded-lg border overflow-hidden" style={{ ...box, height: previewH + 2, background: BACKDROP_CSS[backdrop] }} data-testid="studio-preview">
            <div style={{ width: draft.box.w, height: draft.box.h, transform: `scale(${scale})`, transformOrigin: "top left", position: "relative" }}>
              {kind === "queue" ? (
                <QueueOverlayView queue={SAMPLE_QUEUE} settings={draft.queue} box={draft.box} />
              ) : (
                <div style={{ position: "absolute", inset: 0, boxSizing: "border-box", overflow: "hidden", padding: draft.box.padding, borderRadius: draft.box.radius, border: draft.box.borderW > 0 ? `${draft.box.borderW}px solid ${draft.box.borderColor}` : "none" }}>
                  <div style={{ position: "relative", width: "100%", height: "100%" }}>
                    <OverlayView state={SAMPLE_LIVE} status="waiting" settings={{ ...ov, animation: false }} width={draft.box.w - 2 * inset} height={draft.box.h - 2 * inset} />
                  </div>
                </div>
              )}
            </div>
          </div>
          <p className="text-[11.5px] mt-1.5" style={muted}>샘플 데이터로 그린 모습이에요. 실제 OBS 화면은 브라우저 소스 크기 전체를 사용해요.</p>

          {/* 주소 */}
          <div className="rounded-xl border px-4 py-3 mt-4" style={box}>
            <h3 className="text-[13.5px] font-semibold mb-1">OBS 주소</h3>
            <p className="text-[11.5px] mb-2" style={muted}>
              OBS → 소스 추가 → 브라우저 → URL 에 붙여넣고, 너비/높이는 <b>{recommendedSize(draft)}</b> 로 맞추세요. 저장하면 OBS 화면이 다시 열지 않아도 바뀌어요.
              {kind !== "queue" && " (현재 곡/가사는 실시간 연결 키가 주소에 들어 있어요 — 방송 오버레이 화면에서 연결 상태를 확인할 수 있어요.)"}
            </p>
            <div className="flex flex-wrap gap-2 mb-2">
              <input readOnly aria-label="OBS 주소" data-testid="studio-url" value={studioUrl} onFocus={(e) => e.currentTarget.select()} className={`${inputCls} flex-1 min-w-[12rem]`} style={field} />
              <button type="button" data-testid="studio-copy" className={smallBtn} style={box} onClick={() => void copy(studioUrl, "studio")}>
                {copied === "studio" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied === "studio" ? "복사됨" : "주소 복사"}
              </button>
              <a href={studioUrl} target="_blank" rel="noreferrer" className={smallBtn} style={box}><ExternalLink className="h-3.5 w-3.5" /> 열기</a>
            </div>
            <details>
              <summary className="cursor-pointer text-[12px] min-h-[32px] flex items-center" style={muted}>독립형 주소 (설정이 주소 안에 모두 들어 있어요)</summary>
              <p className="text-[11px] my-1.5" style={muted}>서버 저장 없이도 어느 브라우저에서나 같은 모습이에요. 설정을 바꾸면 주소를 다시 복사해야 해요. {kind !== "queue" ? "테두리/반경/여백은 담기지 않아요." : ""}</p>
              <div className="flex gap-2">
                <input readOnly aria-label="독립형 주소" data-testid="studio-portable-url" value={portableUrl} onFocus={(e) => e.currentTarget.select()} className={`${inputCls} flex-1`} style={field} />
                <button type="button" className={smallBtn} style={box} onClick={() => void copy(portableUrl, "portable")}>{copied === "portable" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} 복사</button>
              </div>
            </details>
          </div>
        </section>

        {/* 설정 */}
        <section aria-label="설정" className="min-w-0 order-2 flex flex-col gap-4" data-testid="studio-controls">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" data-testid="studio-save" disabled={saving || loadState === "loading" || !dirty} onClick={() => void save()} className={`${smallBtn} font-semibold`} style={{ backgroundColor: "var(--book-accent,#fbbf24)", color: "#14161F", borderColor: "transparent" }}>
              <Save className="h-3.5 w-3.5" /> {saving ? "저장 중…" : "저장"}
            </button>
            <button type="button" data-testid="studio-reset" onClick={() => void restore()} className={smallBtn} style={box}><RotateCcw className="h-3.5 w-3.5" /> 기본값 복원</button>
            <span className="text-[12px]" style={muted} data-testid="studio-dirty">{dirty ? "저장 안 된 변경이 있어요" : "저장됨"}</span>
          </div>
          {saveInfo && (
            <div role="status" data-testid="studio-save-info" className="rounded-xl border px-3 py-2 text-[12px]" style={box}>
              {saveInfo.serverIssue === null && "서버에 저장했어요. 다른 브라우저/기기의 OBS 에도 반영돼요."}
              {saveInfo.serverIssue === "missing_table" && "서버에 설정 저장 공간이 아직 없어요(마이그레이션 20261013 미적용). 이 브라우저에만 저장했어요. 다른 기기의 OBS 에는 '독립형 주소'를 쓰세요."}
              {saveInfo.serverIssue === "not_configured" && "이 환경은 서버 연결이 없어서 이 브라우저에만 저장했어요."}
              {saveInfo.serverIssue === "error" && `서버 저장에 실패해서 이 브라우저에만 저장했어요. ${saveInfo.message ?? ""}`}
            </div>
          )}

          {kind === "queue" ? (
            <QueueControls s={draft.queue} onChange={patchQueue} field={field} />
          ) : (
            <OverlayControls kind={kind} s={ov} onChange={patchOverlay} onPreset={(p) => setDraft((d) => (d.kind === "queue" ? d : { ...d, overlay: constrainOverlay(d.kind, { ...d.overlay, ...presetDefaults(p), preset: p }) }))} field={field} />
          )}

          <fieldset className="rounded-xl border px-3 py-3" style={box}>
            <legend className="px-1 text-[12.5px] font-semibold">박스 · OBS 화면 크기</legend>
            <div className="grid grid-cols-2 gap-2.5">
              <Row label={`너비 px (${BOX_LIMITS.w[0]}~${BOX_LIMITS.w[1]})`}><input type="number" data-testid="box-w" className={inputCls} style={field} value={draft.box.w} onChange={(e) => patchBox({ w: Number(e.target.value) })} /></Row>
              <Row label={`높이 px (${BOX_LIMITS.h[0]}~${BOX_LIMITS.h[1]})`}><input type="number" data-testid="box-h" className={inputCls} style={field} value={draft.box.h} onChange={(e) => patchBox({ h: Number(e.target.value) })} /></Row>
              <Row label="모서리 반경 px"><input type="number" data-testid="box-radius" className={inputCls} style={field} value={draft.box.radius} onChange={(e) => patchBox({ radius: Number(e.target.value) })} /></Row>
              <Row label="안쪽 여백 px"><input type="number" data-testid="box-padding" className={inputCls} style={field} value={draft.box.padding} onChange={(e) => patchBox({ padding: Number(e.target.value) })} /></Row>
              <Row label="테두리 두께 px"><input type="number" data-testid="box-border" className={inputCls} style={field} value={draft.box.borderW} onChange={(e) => patchBox({ borderW: Number(e.target.value) })} /></Row>
              <Row label="테두리 색"><ColorInput testId="box-border-color" value={draft.box.borderColor} onChange={(v) => patchBox({ borderColor: v })} field={field} /></Row>
            </div>
            <p className="text-[11px] mt-2" style={muted}>너비/높이는 OBS 브라우저 소스 크기 안내와 미리보기 비율에 쓰여요. 실제 OBS 화면은 소스 크기 전체를 채워요.</p>
          </fieldset>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 컨트롤 묶음

function ColorInput({ value, onChange, field, testId, auto }: { value: string; onChange: (v: string) => void; field: React.CSSProperties; testId?: string; auto?: boolean }) {
  const hex = /^#?[0-9a-fA-F]{6}$/.test(value) ? `#${value.replace("#", "")}` : "#000000";
  const [text, setText] = useState(value);
  // 바깥에서 값이 바뀌면(기본값 복원, 탭 전환) 입력 글자도 따라간다 (렌더 중 보정: effect 없이)
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(value);
  }
  return (
    <div className="flex gap-1.5 items-center">
      <input type="color" aria-label="색 선택" value={hex} onChange={(e) => onChange(auto ? e.target.value.slice(1) : e.target.value)} className="h-8 w-9 rounded border-0 bg-transparent p-0" data-testid={testId ? `${testId}-picker` : undefined} />
      <input
        data-testid={testId}
        className={inputCls}
        style={field}
        value={text}
        maxLength={7}
        placeholder={auto ? "자동" : "#rrggbb"}
        onChange={(e) => {
          setText(e.target.value);
          if (/^#?[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(auto ? e.target.value.replace("#", "").toLowerCase() : `#${e.target.value.replace("#", "").toLowerCase()}`);
          else if (auto && e.target.value === "") onChange("");
        }}
        onBlur={() => setText(value)}
      />
    </div>
  );
}

function Toggle({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: (v: boolean) => void; testId: string }) {
  return (
    <label className="flex items-center gap-2 text-[12.5px] min-h-[32px]">
      <input type="checkbox" data-testid={testId} checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" /> {label}
    </label>
  );
}

function QueueControls({ s, onChange, field }: { s: QueueOverlaySettings; onChange: (p: Partial<QueueOverlaySettings>) => void; field: React.CSSProperties }) {
  const num = (k: keyof QueueOverlaySettings, label: string, min: number, max: number, testId: string) => (
    <Row label={`${label} (${min}~${max})`}><input type="number" data-testid={testId} className={inputCls} style={field} value={s[k] as number} onChange={(e) => onChange({ [k]: Number(e.target.value) } as Partial<QueueOverlaySettings>)} /></Row>
  );
  return (
    <>
      <fieldset className="rounded-xl border px-3 py-3" style={{ borderColor: "var(--book-chrome-border, rgba(255,255,255,0.12))" }}>
        <legend className="px-1 text-[12.5px] font-semibold">표시할 내용</legend>
        <div className="grid grid-cols-2 gap-x-3">
          <Toggle label="곡 제목" checked={s.st} onChange={(v) => onChange({ st: v })} testId="q-st" />
          <Toggle label="가수" checked={s.sa} onChange={(v) => onChange({ sa: v })} testId="q-sa" />
          <Toggle label="신청자" checked={s.req} onChange={(v) => onChange({ req: v })} testId="q-req" />
          <Toggle label="재생 중인 곡" checked={s.sc} onChange={(v) => onChange({ sc: v })} testId="q-sc" />
          <Toggle label="다음 곡(대기 목록)" checked={s.sn} onChange={(v) => onChange({ sn: v })} testId="q-sn" />
          <Toggle label="제목 줄" checked={s.head} onChange={(v) => onChange({ head: v })} testId="q-head" />
        </div>
        <div className="mt-2">{num("n", "표시할 신청곡 수", 1, 12, "q-n")}</div>
      </fieldset>
      <fieldset className="rounded-xl border px-3 py-3" style={{ borderColor: "var(--book-chrome-border, rgba(255,255,255,0.12))" }}>
        <legend className="px-1 text-[12.5px] font-semibold">글자 · 색</legend>
        <div className="grid grid-cols-2 gap-2.5">
          {num("fs", "글자 크기 px", 12, 96, "q-fs")}
          {num("fw", "굵기", 400, 800, "q-fw")}
          <Row label="글자 색"><ColorInput testId="q-tc" value={s.tc} onChange={(v) => onChange({ tc: v })} field={field} /></Row>
          <Row label="강조 색"><ColorInput testId="q-ac" value={s.ac} onChange={(v) => onChange({ ac: v })} field={field} /></Row>
          <Row label="배경 색"><ColorInput testId="q-bgc" value={s.bgc} onChange={(v) => onChange({ bgc: v })} field={field} /></Row>
          {num("bg", "배경 불투명도 %", 0, 100, "q-bg")}
          <Row label="정렬">
            <select data-testid="q-align" className={inputCls} style={field} value={s.align} onChange={(e) => onChange({ align: e.target.value as QueueOverlaySettings["align"] })}>
              <option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option>
            </select>
          </Row>
          {num("gap", "줄 간격 (0.1em)", 0, 20, "q-gap")}
        </div>
      </fieldset>
    </>
  );
}

function OverlayControls({ kind, s, onChange, onPreset, field }: { kind: "song" | "lyrics"; s: OverlaySettings; onChange: (p: Partial<OverlaySettings>) => void; onPreset: (p: OverlayPreset) => void; field: React.CSSProperties }) {
  const presets = OVERLAY_PRESETS.filter((p) => KIND_PRESETS[kind].includes(p.value));
  return (
    <>
      <fieldset className="rounded-xl border px-3 py-3" style={{ borderColor: "var(--book-chrome-border, rgba(255,255,255,0.12))" }}>
        <legend className="px-1 text-[12.5px] font-semibold">스타일</legend>
        <Row label="기존 스타일 / 템플릿" hint={presets.find((p) => p.value === s.preset)?.desc}>
          <select data-testid="o-preset" className={inputCls} style={field} value={s.preset} onChange={(e) => onPreset(e.target.value as OverlayPreset)}>
            {presets.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </Row>
      </fieldset>
      <fieldset className="rounded-xl border px-3 py-3" style={{ borderColor: "var(--book-chrome-border, rgba(255,255,255,0.12))" }}>
        <legend className="px-1 text-[12.5px] font-semibold">표시할 내용</legend>
        <div className="grid grid-cols-2 gap-x-3">
          <Toggle label="곡 제목" checked={s.showTitle} onChange={(v) => onChange({ showTitle: v })} testId="o-title" />
          <Toggle label="가수" checked={s.showArtist} onChange={(v) => onChange({ showArtist: v })} testId="o-artist" />
          {kind === "song" && <Toggle label="커버" checked={s.showCover} onChange={(v) => onChange({ showCover: v })} testId="o-cover" />}
          {kind === "song" && <Toggle label="신청자" checked={s.showRequester} onChange={(v) => onChange({ showRequester: v })} testId="o-requester" />}
          {kind === "song" && <Toggle label="다음 곡" checked={s.showNext} onChange={(v) => onChange({ showNext: v })} testId="o-next" />}
          {kind === "lyrics" && <Toggle label="현재 가사 강조색" checked={s.lyricAccent} onChange={(v) => onChange({ lyricAccent: v })} testId="o-lyricaccent" />}
        </div>
        {kind === "lyrics" && (
          <div className="mt-2">
            <Row label="가사 줄 보기">
              <select data-testid="o-lyricsmode" className={inputCls} style={field} value={s.lyricsMode} onChange={(e) => onChange({ lyricsMode: e.target.value as OverlaySettings["lyricsMode"] })}>
                <option value="current">현재 줄만</option><option value="next">현재 + 다음 줄</option><option value="prevnext">이전 + 현재 + 다음</option>
              </select>
            </Row>
          </div>
        )}
      </fieldset>
      <fieldset className="rounded-xl border px-3 py-3" style={{ borderColor: "var(--book-chrome-border, rgba(255,255,255,0.12))" }}>
        <legend className="px-1 text-[12.5px] font-semibold">글자 · 색 · 배경</legend>
        <div className="grid grid-cols-2 gap-2.5">
          <Row label="글자 크기 % (60~200)"><input type="number" data-testid="o-size" className={inputCls} style={field} value={s.size} onChange={(e) => onChange({ size: Number(e.target.value) })} /></Row>
          <Row label="굵기 (400~800)"><input type="number" step={100} data-testid="o-weight" className={inputCls} style={field} value={s.fontWeight} onChange={(e) => onChange({ fontWeight: Number(e.target.value) })} /></Row>
          <Row label="글자 색 (비우면 자동)"><ColorInput auto testId="o-textcolor" value={s.textColor} onChange={(v) => onChange({ textColor: v })} field={field} /></Row>
          <Row label="강조 색"><ColorInput auto testId="o-accent" value={s.accent} onChange={(v) => onChange({ accent: v, useBookAccent: false })} field={field} /></Row>
          <Row label="배경">
            <select data-testid="o-bg" className={inputCls} style={field} value={s.background} onChange={(e) => onChange({ background: e.target.value as OverlaySettings["background"] })}>
              <option value="transparent">투명</option><option value="translucent">반투명</option><option value="card">카드</option><option value="solid">단색</option>
            </select>
          </Row>
          <Row label="배경 색 (비우면 자동)"><ColorInput auto testId="o-bgcolor" value={s.bgColor} onChange={(v) => onChange({ bgColor: v })} field={field} /></Row>
          <Row label="배경 불투명도 % (10~100)"><input type="number" data-testid="o-opacity" className={inputCls} style={field} value={s.opacity} onChange={(e) => onChange({ opacity: Number(e.target.value) })} /></Row>
          <Row label="정렬">
            <select data-testid="o-align" className={inputCls} style={field} value={s.align} onChange={(e) => onChange({ align: e.target.value as OverlaySettings["align"] })}>
              <option value="auto">스타일 기본</option><option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option>
            </select>
          </Row>
          <Row label="위치">
            <select data-testid="o-position" className={inputCls} style={field} value={s.position} onChange={(e) => onChange({ position: e.target.value as OverlaySettings["position"] })}>
              {OVERLAY_POSITIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Row>
          <Row label="요소 간격 (0.1em, 배너형)"><input type="number" data-testid="o-gap" className={inputCls} style={field} value={s.gap} onChange={(e) => onChange({ gap: Number(e.target.value) })} /></Row>
        </div>
      </fieldset>
    </>
  );
}

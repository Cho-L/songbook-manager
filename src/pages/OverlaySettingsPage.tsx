import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, ChevronLeft, Copy, Download, ExternalLink, RefreshCw, Upload } from "lucide-react";
import { OverlayView } from "../components/overlay/OverlayView";
import { useBookDesign } from "../hooks/useBookDesign";
import { useAccountLiveKey } from "../hooks/useAccountLiveKey";
import { broadcastRepository, type BroadcastProfile, type ProfileSource } from "../services/broadcastRepository";
import { getChromeCssVars } from "../utils/color";
import {
  clearLive,
  getLiveKey,
  publishLive,
  publishOverlaySettings,
  subscribeSettingsChannel,
  readLive,
  regenerateLiveKey,
  subscribeLive,
  subscribeLiveAck,
  subscribeLiveStatus,
  type LinkStatus,
  type LiveState,
  type LiveStateInput,
} from "../utils/liveBroadcast";
import {
  DEFAULT_OVERLAY_SETTINGS,
  OFFSET_X_MAX,
  PROFILE_NAME_MAX,
  RECOMMENDED_PROFILES,
  buildOverlayExport,
  cleanProfileName,
  parseOverlayImport,
  OFFSET_Y_MAX,
  OVERLAY_POSITIONS,
  OVERLAY_PRESETS,
  parseOverlaySettings,
  presetDefaults,
  serializeOverlaySettings,
  type OverlayBackground,
  type OverlayLyricsMode,
  type OverlaySettings,
} from "../types/overlay";

const STORAGE_PREFIX = "songbook:overlay-settings:";

function loadSettings(ownerId: string | undefined): OverlaySettings {
  try {
    const raw = ownerId ? localStorage.getItem(STORAGE_PREFIX + ownerId) : null;
    if (raw) return parseOverlaySettings(new URLSearchParams(raw));
  } catch {
    // 저장소를 못 읽으면 기본값으로 시작
  }
  return DEFAULT_OVERLAY_SETTINGS;
}

// 설정 화면 미리보기에 쓰는 샘플 (실제 SongMode가 연결되면 그 상태로 바뀐다)
const SAMPLE_STATE: LiveState = {
  v: 1,
  bookId: "sample",
  mode: "concert",
  song: { id: "s3", title: "샘플 곡 제목", artist: "샘플 가수", key: "Bb", bpm: 87, difficulty: 3 },
  lines: ["첫 번째 가사가 여기에 표시돼요", "지금 부르는 가사가 가장 크게 보여요", "다음 가사는 조금 작게 보여요", "그 다음 가사"],
  lineIndex: 1,
  synced: true,
  index: 2,
  total: 8,
  queue: [
    { id: "s3", title: "샘플 곡 제목", artist: "샘플 가수" },
    { id: "s4", title: "다음 곡 하나", artist: "가수" },
    { id: "s5", title: "그다음 곡", artist: "가수" },
    { id: "s6", title: "마지막에 가까운 곡", artist: "가수" },
  ],
  ts: 0,
};

const LINK_LABEL: Record<LinkStatus, { icon: string; text: string; color: string }> = {
  connecting: { icon: "🟡", text: "연결 중…", color: "#fbbf24" },
  connected: { icon: "🟢", text: "연결됨", color: "#22c55e" },
  reconnecting: { icon: "🔄", text: "재연결 중…", color: "#fbbf24" },
  disconnected: { icon: "🔴", text: "연결 끊김", color: "#ef4444" },
  unavailable: { icon: "⚪", text: "실시간 연결 사용 불가 — 같은 브라우저에서만 동작해요", color: "#9ca3af" },
};

const TEST_MS = 30000;

function ColorRow({
  label,
  value,
  fallback,
  disabled,
  onChange,
  onReset,
}: {
  label: string;
  value: string;
  fallback: string;
  disabled?: boolean;
  onChange: (hex: string) => void;
  onReset?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 min-h-[40px]">
      <label className="text-[13px]" htmlFor={`color-${label}`}>
        {label}
        {!value && !disabled && <span className="text-[11px] ml-1.5 opacity-60">(자동)</span>}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={`color-${label}`}
          type="color"
          value={`#${value || fallback}`}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.replace("#", "").toLowerCase())}
          className="h-9 w-12 rounded border cursor-pointer bg-transparent disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ borderColor: "var(--book-chrome-border, rgba(255,255,255,0.2))" }}
        />
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            disabled={!value}
            aria-label={`${label} 기본값으로`}
            className="text-[12px] px-2.5 min-h-[36px] rounded-lg border disabled:opacity-40"
            style={chipStyle}
          >
            기본값
          </button>
        )}
      </div>
    </div>
  );
}

function StepTitle({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-[15px] font-semibold mb-3">
      <span
        className="h-6 w-6 rounded-full flex items-center justify-center text-[12px] font-semibold shrink-0"
        style={{ backgroundColor: "var(--book-accent, #fbbf24)", color: "#14161F" }}
        aria-hidden="true"
      >
        {n}
      </span>
      {children}
    </h2>
  );
}

const chip =
  "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-[13px] cursor-pointer select-none min-h-[40px]";
const chipStyle = {
  backgroundColor: "var(--book-chrome-surface, rgba(255,255,255,0.05))",
  borderColor: "var(--book-chrome-border, rgba(255,255,255,0.12))",
} as const;
const accentInput = "accent-[var(--book-accent,#fbbf24)] h-4 w-4 shrink-0";

function Group({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-0 p-0 m-0 min-w-0">
      <legend className="text-[12px] font-medium mb-2 p-0" style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.5))" }}>
        {legend}
      </legend>
      {children}
    </fieldset>
  );
}

function Radio<T extends string>({
  name,
  value,
  current,
  onChange,
  label,
  hint,
}: {
  name: string;
  value: T;
  current: T;
  onChange: (v: T) => void;
  label: string;
  hint?: string;
}) {
  const checked = current === value;
  return (
    <label
      className={chip}
      style={{
        ...chipStyle,
        borderColor: checked ? "var(--book-accent, #fbbf24)" : chipStyle.borderColor,
      }}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} className={accentInput} />
      <span className="min-w-0">
        <span className="block">{label}</span>
        {hint && (
          <span className="block text-[11px]" style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.45))" }}>
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={chip} style={chipStyle}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className={accentInput} />
      <span>{label}</span>
    </label>
  );
}

export function OverlaySettingsPage() {
  const { ownerId } = useParams();
  const navigate = useNavigate();
  const { design } = useBookDesign(ownerId);
  const [settings, setSettings] = useState<OverlaySettings>(() => loadSettings(ownerId));
  const [copied, setCopied] = useState(false);
  const [live, setLive] = useState<LiveState | null>(() => readLive());
  const [recvAt, setRecvAt] = useState<number>(() => Date.now());
  const [now, setNow] = useState<number>(() => Date.now());
  const [liveKey, setLiveKey] = useState<string>(() => (ownerId ? getLiveKey(ownerId) : ""));
  const [linkStatus, setLinkStatus] = useState<LinkStatus>("connecting");
  const [test, setTest] = useState<"idle" | "sending" | "ok" | "timeout">("idle");
  const [testActive, setTestActive] = useState(false);
  const testRef = useRef<{ id: string; timer: number; stop: number } | null>(null);
  const target = useMemo(() => (ownerId && liveKey ? { bookId: ownerId, key: liveKey } : null), [ownerId, liveKey]);

  // 방송 키를 계정 단위로 맞춘다 (다른 기기에서 저장한 키가 있으면 그 키로 통일)
  useAccountLiveKey(ownerId, true, setLiveKey);

  // ---- 방송 프로필 ----
  const ACTIVE_KEY = `songbook:overlay-active-profile:${ownerId}`;
  const [profiles, setProfiles] = useState<BroadcastProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profileSource, setProfileSource] = useState<ProfileSource>("server");
  const [activeId, setActiveId] = useState<string>("");
  const [form, setForm] = useState<null | "new" | "rename">(null);
  const [formName, setFormName] = useState("");
  const [profileMsg, setProfileMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const activeProfile = profiles.find((p) => p.id === activeId) ?? null;
  // ---- 오버레이 설정 실시간 전송 ----
  // 설정이 바뀌면(슬라이더처럼 빠른 변경은 120ms 모아서) 연결된 모든 오버레이(OBS)로 보낸다.
  // OBS URL을 다시 복사/수정할 필요 없이 디자인이 바로 바뀐다.
  const [published, setPublished] = useState<{ ver: number; at: number } | null>(null);
  const latestRef = useRef<{ settings: OverlaySettings; ver: number } | null>(null);
  // 연결된 오버레이: sid → 마지막으로 확인된 시각/적용한 설정 버전
  const [overlays, setOverlays] = useState<Record<string, { seen: number; ver: number }>>({});
  // 저장된 프로필과 현재 화면 설정이 다른지 (accent는 노래책 색을 따라가므로 비교에서 제외)
  const comparable = (st: OverlaySettings) => serializeOverlaySettings({ ...st, accent: "000000" });
  const dirty = activeProfile !== null && comparable(settings) !== comparable(activeProfile.settings);

  const previewRef = useRef<HTMLDivElement>(null);
  const [previewWidth, setPreviewWidth] = useState(640);
  const [previewHeight, setPreviewHeight] = useState(360);

  const bookStyle = {
    "--book-accent": design.accentColor,
    "--book-background": design.backgroundColor,
    "--book-surface": design.surfaceColor,
    "--book-text": design.textColor,
    ...getChromeCssVars(design.backgroundColor),
    backgroundColor: design.backgroundColor,
    color: design.textColor,
  } as React.CSSProperties;

  // 강조색은 항상 노래책 Book Design의 accent를 따라간다 (저장하지 않음)
  const effective = useMemo<OverlaySettings>(() => {
    if (!settings.useBookAccent) return settings;
    const hex = design.accentColor.replace("#", "");
    return { ...settings, accent: /^[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : DEFAULT_OVERLAY_SETTINGS.accent };
  }, [settings, design.accentColor]);

  const overlayUrl = useMemo(
    () => `${window.location.origin}/overlay?${serializeOverlaySettings(effective, ownerId, liveKey)}`,
    [effective, ownerId, liveKey]
  );

  useEffect(() => {
    if (!ownerId) return;
    try {
      localStorage.setItem(STORAGE_PREFIX + ownerId, serializeOverlaySettings(settings));
    } catch {
      // 저장 실패는 조용히 무시 (설정 자체는 계속 사용 가능)
    }
  }, [settings, ownerId]);

  // 곡 수신 + Realtime 연결 상태 구독 (노래 부르기 화면이 이 노래책 채널로 보내는 상태)
  useEffect(() => {
    if (!target) return;
    const offLive = subscribeLive((next) => {
      setLive(next);
      setRecvAt(Date.now());
    }, target);
    const offStatus = subscribeLiveStatus(target, setLinkStatus);
    return () => {
      offLive();
      offStatus();
    };
  }, [target]);

  // "연결됨" 표시가 오래된 상태에 머물지 않도록 3초마다 현재 시각 갱신
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 3000);
    return () => window.clearInterval(id);
  }, []);

  const stopTest = useCallback((finalState: "idle" | "ok" | "timeout" = "idle") => {
    const t = testRef.current;
    if (t) {
      window.clearInterval(t.timer);
      window.clearTimeout(t.stop);
      testRef.current = null;
      clearLive();
    }
    setTestActive(false);
    setTest(finalState);
  }, []);

  // 화면을 떠나면 진행 중인 테스트를 정리한다 (오버레이에 테스트 화면이 남지 않게)
  useEffect(() => () => stopTest("idle"), [stopTest]);

  // OBS(오버레이)가 테스트 화면을 받았다는 확인 신호 수신
  useEffect(() => {
    if (!target) return;
    return subscribeLiveAck(target, (id) => {
      if (testRef.current?.id === id) setTest("ok");
    });
  }, [target]);

  function startTest() {
    if (!ownerId) return;
    stopTest("idle");
    const id = `test-${Math.random().toString(36).slice(2, 10)}`;
    const input: LiveStateInput = {
      bookId: ownerId,
      mode: "test",
      song: { id, title: "OBS 연결 테스트", artist: "Songbook Manager" },
      lines: [],
      lineIndex: -1,
      synced: false,
      index: 0,
      total: 0,
      queue: [],
    };
    publishLive(input);
    // 오버레이가 나중에 열려도 받을 수 있게 2초마다 다시 보내고, 30초 뒤에 자동 종료한다
    const timer = window.setInterval(() => publishLive(input, "heartbeat"), 2000);
    const stop = window.setTimeout(() => {
      // 30초 안에 OBS 확인 신호가 없으면 "응답 없음"으로 끝낸다 (성공했다면 이미 "ok")
      setTest((cur) => (cur === "sending" ? "timeout" : cur));
      stopTestKeepResult();
    }, TEST_MS);
    testRef.current = { id, timer, stop };
    setTestActive(true);
    setTest("sending");
  }

  // 시간 초과로 끝낼 때는 결과 문구(성공/실패)를 남긴 채 정리한다
  function stopTestKeepResult() {
    const t = testRef.current;
    if (!t) return;
    window.clearInterval(t.timer);
    window.clearTimeout(t.stop);
    testRef.current = null;
    setTestActive(false);
    clearLive();
  }

  function regenerateKey() {
    if (!ownerId) return;
    if (!window.confirm("방송 키를 새로 만들면 지금 OBS에 붙여넣은 URL은 더 이상 작동하지 않아요. 새 URL을 다시 붙여넣어야 합니다. 계속할까요?")) return;
    stopTest("idle");
    const fresh = regenerateLiveKey(ownerId);
    setLiveKey(fresh);
    void broadcastRepository.saveLiveKey(ownerId, fresh).catch(() => undefined);
  }

  useEffect(() => {
    const el = previewRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      setPreviewWidth(el.clientWidth);
      setPreviewHeight(el.clientHeight);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);

  useEffect(() => {
    if (!ownerId) return;
    let cancelled = false;
    setProfilesLoading(true);
    broadcastRepository
      .list(ownerId)
      .then(({ profiles: list, source }) => {
        if (cancelled) return;
        setProfiles(list);
        setProfileSource(source);
        try {
          const saved = localStorage.getItem(ACTIVE_KEY);
          if (saved && list.some((p) => p.id === saved)) setActiveId(saved);
        } catch {
          // ignore
        }
      })
      .catch(() => {
        if (!cancelled) setProfileMsg({ kind: "error", text: "방송 프로필을 불러오지 못했어요. 잠시 후 다시 시도해주세요." });
      })
      .finally(() => {
        if (!cancelled) setProfilesLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);

  const effectiveKey = serializeOverlaySettings(effective);
  useEffect(() => {
    if (!ownerId) return;
    const t = window.setTimeout(() => {
      const ver = publishOverlaySettings(ownerId, effective);
      latestRef.current = { settings: effective, ver };
      setPublished({ ver, at: Date.now() });
    }, 120);
    return () => window.clearTimeout(t);
    // effective 객체가 아니라 그 내용(effectiveKey)이 바뀔 때만 다시 보낸다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveKey, ownerId, liveKey]);

  // 오버레이가 새로 연결되어 "현재 설정을 주세요"라고 하면 바로 답하고, 연결/적용 확인을 모아 둔다
  useEffect(() => {
    if (!ownerId || !liveKey) return;
    const mark = (sid: string, ver?: number) =>
      setOverlays((prev) => ({ ...prev, [sid]: { seen: Date.now(), ver: ver ?? prev[sid]?.ver ?? 0 } }));
    return subscribeSettingsChannel(
      { bookId: ownerId, key: liveKey },
      {
        onRequest: (sid) => {
          mark(sid);
          const cur = latestRef.current;
          if (cur) publishOverlaySettings(ownerId, cur.settings, cur.ver);
        },
        onAck: (sid, ver) => mark(sid, ver),
      }
    );
  }, [ownerId, liveKey]);

  function rememberActive(id: string) {
    setActiveId(id);
    try {
      if (id) localStorage.setItem(ACTIVE_KEY, id);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {
      // ignore
    }
  }

  async function runProfileAction(action: () => Promise<void>, errorText: string) {
    setBusy(true);
    setProfileMsg(null);
    try {
      await action();
    } catch {
      setProfileMsg({ kind: "error", text: errorText });
    } finally {
      setBusy(false);
    }
  }

  function selectProfile(id: string) {
    if (!id) {
      rememberActive("");
      return;
    }
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    if (dirty && !window.confirm("저장하지 않은 변경사항이 사라져요. 다른 프로필을 불러올까요?")) return;
    setSettings(p.settings);
    rememberActive(p.id);
    setForm(null);
    setProfileMsg({ kind: "ok", text: `"${p.name}" 프로필을 불러왔어요.` });
  }

  function openForm(kind: "new" | "rename") {
    setForm(kind);
    setFormName(kind === "rename" ? activeProfile?.name ?? "" : "");
    setProfileMsg(null);
  }

  function submitForm() {
    if (!ownerId) return;
    const name = cleanProfileName(formName);
    if (!formName.trim()) {
      setProfileMsg({ kind: "error", text: "프로필 이름을 입력해주세요." });
      return;
    }
    void runProfileAction(async () => {
      if (form === "rename" && activeProfile) {
        const updated = await broadcastRepository.update(ownerId, activeProfile.id, { name });
        setProfiles((list) => list.map((p) => (p.id === updated.id ? updated : p)));
        setProfileMsg({ kind: "ok", text: "이름을 바꿨어요." });
      } else {
        const created = await broadcastRepository.create(ownerId, name, settings);
        setProfiles((list) => [...list, created]);
        rememberActive(created.id);
        setProfileMsg({ kind: "ok", text: `"${created.name}" 프로필로 저장했어요.` });
      }
      setForm(null);
    }, "저장하지 못했어요. 잠시 후 다시 시도해주세요.");
  }

  function saveActive() {
    if (!ownerId || !activeProfile) return;
    void runProfileAction(async () => {
      const updated = await broadcastRepository.update(ownerId, activeProfile.id, { settings });
      setProfiles((list) => list.map((p) => (p.id === updated.id ? updated : p)));
      setProfileMsg({ kind: "ok", text: `"${updated.name}"에 저장했어요.` });
    }, "저장하지 못했어요. 잠시 후 다시 시도해주세요.");
  }

  function duplicateActive() {
    if (!ownerId || !activeProfile) return;
    void runProfileAction(async () => {
      const copy = await broadcastRepository.create(ownerId, `${activeProfile.name} - 복사본`.slice(0, PROFILE_NAME_MAX), activeProfile.settings);
      setProfiles((list) => [...list, copy]);
      setSettings(copy.settings);
      rememberActive(copy.id);
      setProfileMsg({ kind: "ok", text: `"${copy.name}" 프로필을 만들었어요.` });
    }, "복제하지 못했어요. 잠시 후 다시 시도해주세요.");
  }

  function deleteActive() {
    if (!ownerId || !activeProfile) return;
    if (!window.confirm(`"${activeProfile.name}" 프로필을 삭제할까요? 되돌릴 수 없어요. (현재 화면의 설정은 그대로 남아요)`)) return;
    void runProfileAction(async () => {
      await broadcastRepository.remove(ownerId, activeProfile.id);
      setProfiles((list) => list.filter((p) => p.id !== activeProfile.id));
      rememberActive("");
      setProfileMsg({ kind: "ok", text: "프로필을 삭제했어요." });
    }, "삭제하지 못했어요. 잠시 후 다시 시도해주세요.");
  }

  function applyRecommended(i: number) {
    const rec = RECOMMENDED_PROFILES[i];
    if (dirty && !window.confirm("저장하지 않은 변경사항이 사라져요. 추천 설정을 적용할까요?")) return;
    setSettings(rec.build());
    rememberActive("");
    setProfileMsg({ kind: "ok", text: `"${rec.name}" 추천 설정을 적용했어요. 마음에 들면 프로필로 저장해보세요.` });
  }

  function exportSettings() {
    const name = activeProfile?.name ?? "방송 설정";
    const blob = new Blob([buildOverlayExport(name, settings)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `songbook-overlay-${name.replace(/[^\w가-힣-]+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importSettings(file: File | undefined) {
    if (!file) return;
    const result = parseOverlayImport(await file.text());
    if (!result.ok) {
      setProfileMsg({ kind: "error", text: `가져오지 못했어요: ${result.error} (현재 설정은 그대로예요)` });
    } else {
      setSettings(result.settings);
      setProfileMsg({ kind: "ok", text: `"${result.name}" 설정을 가져왔어요. 프로필로 저장하려면 "새 프로필"을 눌러주세요.` });
    }
    if (importRef.current) importRef.current.value = "";
  }

  function update<K extends keyof OverlaySettings>(key: K, value: OverlaySettings[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(overlayUrl);
      setCopied(true);
    } catch {
      // 클립보드 권한이 없으면 입력창을 선택해 두고 직접 복사할 수 있게 안내
      const input = document.getElementById("overlay-url") as HTMLInputElement | null;
      input?.focus();
      input?.select();
      alert("자동 복사가 막혀 있어요. 선택된 주소를 직접 복사해주세요 (Ctrl+C).");
    }
  }

  const liveMatches = live !== null && live.mode !== "test" && live.bookId === ownerId && now - recvAt < 15000;
  const muted = { color: "var(--book-chrome-muted, rgba(255,255,255,0.5))" } as const;
  const link = LINK_LABEL[linkStatus];
  // 25초 안에 확인 신호가 있었던 오버레이만 "연결됨"으로 본다
  const connectedOverlays = Object.values(overlays).filter((o) => now - o.seen < 25000);
  const allApplied = published !== null && connectedOverlays.every((o) => o.ver >= published.ver);
  const previewState = liveMatches ? live : SAMPLE_STATE;

  return (
    <div className="book-focus max-w-md lg:max-w-5xl mx-auto pb-16 min-h-screen" style={bookStyle}>
      <div className="px-5 lg:px-8 pt-5">
        <button
          onClick={() => navigate(`/books/${ownerId}`)}
          className="flex items-center gap-1 py-1.5 text-[13px]"
          style={muted}
        >
          <ChevronLeft className="h-4 w-4" /> 노래책으로
        </button>
      </div>

      <div className="px-5 lg:px-8 pt-3 pb-5">
        <h1 className="text-[22px] lg:text-[26px] font-semibold font-serif">방송 오버레이</h1>
        <p className="text-[13px] mt-1" style={muted}>
          OBS 브라우저 소스로 노래 제목과 가사를 방송 화면 위에 띄워요
        </p>
      </div>

      {/* ---- 방송 프로필: 계정 단위로 저장해 두고 어떤 노래책에서든 불러온다 ---- */}
      <section aria-labelledby="profiles-title" className="mx-5 lg:mx-8 mb-6 rounded-xl border p-4" style={chipStyle}>
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <h2 id="profiles-title" className="text-[15px] font-semibold">
            방송 프로필
          </h2>
          {dirty && (
            <span data-testid="profile-dirty" className="text-[12px] font-medium" style={{ color: "#fbbf24" }}>
              ● 저장되지 않은 변경사항
            </span>
          )}
        </div>

        {profilesLoading ? (
          <p className="text-[13px]" style={muted}>방송 프로필을 불러오는 중…</p>
        ) : profiles.length === 0 ? (
          <div data-testid="profile-empty">
            <p className="text-[13px]" style={muted}>
              아직 저장된 방송 프로필이 없습니다. 현재 오버레이 설정을 프로필로 저장해 보세요.
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <button
                type="button"
                onClick={() => openForm("new")}
                className="rounded-lg px-4 min-h-[40px] text-[13px] font-medium transition-[filter] hover:brightness-110 active:brightness-95"
                style={{ backgroundColor: "var(--book-accent, #fbbf24)", color: "#14161F" }}
              >
                프로필 저장
              </button>
            </div>
            <p className="text-[12px] mt-4 mb-2" style={muted}>추천 설정으로 시작하기</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {RECOMMENDED_PROFILES.map((r, i) => (
                <button
                  key={r.name}
                  type="button"
                  onClick={() => applyRecommended(i)}
                  className="text-left rounded-lg border px-3 py-2.5 min-h-[44px] transition-[filter] hover:brightness-110"
                  style={chipStyle}
                >
                  <span className="block text-[13px]">{r.name}</span>
                  <span className="block text-[11px]" style={muted}>{r.desc}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <label htmlFor="profile-select" className="text-[12px] font-medium block mb-1.5" style={muted}>
                내 방송 프로필
              </label>
              <select
                id="profile-select"
                value={activeId}
                onChange={(e) => selectProfile(e.target.value)}
                className="book-input w-full rounded-lg border px-3 py-2.5 text-[13.5px] outline-none min-h-[44px]"
                style={{ ...chipStyle, color: "var(--book-text, #fff)" }}
              >
                <option value="">— 프로필 선택 (저장하지 않은 설정) —</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => openForm("new")} disabled={busy} className="rounded-lg border px-3.5 min-h-[40px] text-[13px] disabled:opacity-40" style={chipStyle}>
                새 프로필
              </button>
              <button
                type="button"
                onClick={saveActive}
                disabled={busy || !activeProfile}
                className="rounded-lg border px-3.5 min-h-[40px] text-[13px] font-medium disabled:opacity-40"
                style={
                  dirty
                    ? { backgroundColor: "var(--book-accent, #fbbf24)", color: "#14161F", borderColor: "transparent" }
                    : chipStyle
                }
              >
                {dirty ? "저장 필요 — 저장" : "저장"}
              </button>
              <button type="button" onClick={duplicateActive} disabled={busy || !activeProfile} className="rounded-lg border px-3.5 min-h-[40px] text-[13px] disabled:opacity-40" style={chipStyle}>
                복제
              </button>
              <button type="button" onClick={() => openForm("rename")} disabled={busy || !activeProfile} className="rounded-lg border px-3.5 min-h-[40px] text-[13px] disabled:opacity-40" style={chipStyle}>
                이름 변경
              </button>
              <button type="button" onClick={deleteActive} disabled={busy || !activeProfile} className="rounded-lg border px-3.5 min-h-[40px] text-[13px] disabled:opacity-40" style={{ ...chipStyle, color: "#f87171" }}>
                삭제
              </button>
            </div>
          </div>
        )}

        {form && (
          <div className="mt-3 flex flex-col sm:flex-row gap-2" data-testid="profile-form">
            <label htmlFor="profile-name" className="sr-only">프로필 이름</label>
            <input
              id="profile-name"
              value={formName}
              maxLength={PROFILE_NAME_MAX}
              autoFocus
              placeholder="예: YouTube 가로 방송"
              onChange={(e) => setFormName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitForm()}
              className="book-input flex-1 min-w-0 rounded-lg border px-3 py-2.5 text-[13.5px] outline-none"
              style={{ ...chipStyle, color: "var(--book-text, #fff)" }}
            />
            <div className="flex gap-2">
              <button type="button" onClick={submitForm} disabled={busy} className="rounded-lg px-4 min-h-[42px] text-[13px] font-medium disabled:opacity-40" style={{ backgroundColor: "var(--book-accent, #fbbf24)", color: "#14161F" }}>
                {form === "rename" ? "이름 바꾸기" : "저장"}
              </button>
              <button type="button" onClick={() => setForm(null)} className="rounded-lg border px-4 min-h-[42px] text-[13px]" style={chipStyle}>
                취소
              </button>
            </div>
          </div>
        )}

        <div role="status" data-testid="profile-msg" className="text-[12.5px] mt-3 min-h-[1.2em] [overflow-wrap:anywhere]" style={{ color: profileMsg?.kind === "error" ? "#f87171" : "var(--book-chrome-muted, rgba(255,255,255,0.6))" }}>
          {profileMsg?.text}
        </div>
        {profileSource === "local" && !profilesLoading && (
          <p className="text-[11.5px] mt-1" style={muted} data-testid="profile-local-note">
            이 브라우저에만 저장돼요. (서버에 방송 프로필 저장소가 아직 준비되지 않았어요. 관리자가 schema.sql을 적용하면 계정에 저장돼요.)
          </p>
        )}

        <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t" style={{ borderColor: "var(--book-chrome-border, rgba(255,255,255,0.1))" }}>
          <button type="button" onClick={exportSettings} className="inline-flex items-center gap-1.5 rounded-lg border px-3 min-h-[40px] text-[12.5px]" style={chipStyle}>
            <Download className="h-3.5 w-3.5" /> 설정 내보내기
          </button>
          <button type="button" onClick={() => importRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border px-3 min-h-[40px] text-[12.5px]" style={chipStyle}>
            <Upload className="h-3.5 w-3.5" /> 설정 가져오기
          </button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            aria-label="설정 파일 선택"
            className="sr-only"
            onChange={(e) => void importSettings(e.target.files?.[0])}
          />
        </div>
      </section>

      <div className="px-5 lg:px-8 lg:grid lg:grid-cols-[1fr_420px] lg:gap-10 lg:items-start">
        {/* 좌: 미리보기 (데스크톱에서는 스크롤해도 따라온다) */}
        <div className="min-w-0 lg:sticky lg:top-4">
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <h2 className="text-[13px] font-medium">미리보기</h2>
            <span className="text-[12px]" style={muted} data-testid="overlay-live-status">
              {liveMatches ? `● 곡 수신 중 — ${live?.song?.title ?? "공연 종료"}` : "○ 샘플 화면 · 노래 부르기를 시작하면 실제 곡으로 바뀌어요"}
            </span>
          </div>
          <div
            ref={previewRef}
            data-testid="overlay-preview"
            className="relative w-full aspect-video rounded-xl overflow-hidden border"
            style={{
              borderColor: "var(--book-chrome-border, rgba(255,255,255,0.12))",
              backgroundColor: "#3a3d4a",
              backgroundImage:
                "linear-gradient(45deg,#2c2f3a 25%,transparent 25%,transparent 75%,#2c2f3a 75%),linear-gradient(45deg,#2c2f3a 25%,transparent 25%,transparent 75%,#2c2f3a 75%)",
              backgroundSize: "20px 20px",
              backgroundPosition: "0 0,10px 10px",
            }}
          >
            <OverlayView state={previewState} status="waiting" settings={effective} width={previewWidth} height={previewHeight} minPx={9} />
          </div>
          <p className="text-[11.5px] mt-1.5" style={muted}>
            체크무늬는 투명한 부분이에요. 방송 화면에서는 뒤의 영상이 그대로 보여요.
          </p>
        </div>

        {/* 우: 단계별 설정 */}
        <div className="min-w-0 mt-8 lg:mt-0 flex flex-col gap-8">
          <section aria-labelledby="step1">
            <div id="step1">
              <StepTitle n="1">오버레이 디자인 고르기</StepTitle>
            </div>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="디자인">
              {OVERLAY_PRESETS.map((p) => (
                <Radio
                  key={p.value}
                  name="preset"
                  value={p.value}
                  current={settings.preset}
                  label={p.label}
                  hint={p.hint}
                  onChange={(v) => setSettings((st) => ({ ...st, preset: v, ...presetDefaults(v) }))}
                />
              ))}
            </div>
            <p className="text-[12.5px] mt-2" style={muted} data-testid="preset-desc">
              {OVERLAY_PRESETS.find((p) => p.value === settings.preset)?.desc}
            </p>
          </section>

          <section aria-labelledby="step2" className="flex flex-col gap-5">
            <div id="step2">
              <StepTitle n="2">표시할 정보 고르기</StepTitle>
            </div>
            <Group legend="표시 정보">
              <div className="grid grid-cols-2 gap-2">
                <Toggle label="곡 제목" checked={settings.showTitle} onChange={(v) => update("showTitle", v)} />
                <Toggle label="가수" checked={settings.showArtist} onChange={(v) => update("showArtist", v)} />
                <Toggle label="커버" checked={settings.showCover} onChange={(v) => update("showCover", v)} />
                <Toggle label="가사" checked={settings.showLyrics} onChange={(v) => update("showLyrics", v)} />
                <Toggle label="Key" checked={settings.showKey} onChange={(v) => update("showKey", v)} />
                <Toggle label="BPM" checked={settings.showBpm} onChange={(v) => update("showBpm", v)} />
                <Toggle label="난이도" checked={settings.showDifficulty} onChange={(v) => update("showDifficulty", v)} />
                <Toggle label="진행도 (3 / 8)" checked={settings.showProgress} onChange={(v) => update("showProgress", v)} />
                <Toggle label="라이브 큐" checked={settings.showQueue} onChange={(v) => update("showQueue", v)} />
              </div>
              <p className="text-[11.5px] mt-1.5" style={muted}>
                커버는 Card / Now Playing 에서 보여요. 가사 싱크(타임스탬프)가 있는 곡만 가사가 나와요.
              </p>
            </Group>

            <Group legend="가사 표시">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="가사 표시">
                {(
                  [
                    ["current", "현재만"],
                    ["next", "현재 + 다음"],
                    ["prevnext", "이전 + 현재 + 다음"],
                  ] as [OverlayLyricsMode, string][]
                ).map(([v, label]) => (
                  <Radio key={v} name="lyricsMode" value={v} current={settings.lyricsMode} label={label} onChange={(x) => update("lyricsMode", x)} />
                ))}
              </div>
            </Group>

            <Group legend="배경">
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="배경">
                {(
                  [
                    ["transparent", "투명"],
                    ["translucent", "반투명"],
                    ["card", "카드"],
                    ["solid", "단색"],
                  ] as [OverlayBackground, string][]
                ).map(([v, label]) => (
                  <Radio key={v} name="background" value={v} current={settings.background} label={label} onChange={(x) => update("background", x)} />
                ))}
              </div>
            </Group>

            <Group legend="애니메이션">
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="애니메이션">
                <Radio name="animation" value="on" current={settings.animation ? "on" : "off"} label="부드럽게" onChange={() => update("animation", true)} />
                <Radio name="animation" value="off" current={settings.animation ? "on" : "off"} label="없음" onChange={() => update("animation", false)} />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2" role="radiogroup" aria-label="가사 전환 효과">
                <Radio name="animStyle" value="slide" current={settings.animStyle} label="위로 슬라이드" onChange={(v) => update("animStyle", v)} />
                <Radio name="animStyle" value="fade" current={settings.animStyle} label="페이드" onChange={(v) => update("animStyle", v)} />
              </div>
              <div className="mt-2">
                <Toggle label="현재 가사를 강조색으로" checked={settings.lyricAccent} onChange={(v) => update("lyricAccent", v)} />
              </div>
              <p className="text-[11.5px] mt-1.5" style={muted}>
                곡이 바뀔 때는 화면이 잠깐 사라졌다 새 곡으로 나타나요 (애니메이션 &quot;부드럽게&quot;일 때).
              </p>
            </Group>

            <div className="flex flex-col gap-4">
              <div>
                <label htmlFor="overlay-size" className="flex justify-between text-[12px] font-medium mb-1" style={muted}>
                  <span>글자 크기</span>
                  <span data-testid="overlay-size-value">{settings.size}%</span>
                </label>
                <input
                  id="overlay-size"
                  type="range"
                  min={60}
                  max={200}
                  step={5}
                  value={settings.size}
                  onChange={(e) => update("size", Number(e.target.value))}
                  className="w-full accent-[var(--book-accent,#fbbf24)] h-8"
                />
              </div>
              <div>
                <label htmlFor="overlay-opacity" className="flex justify-between text-[12px] font-medium mb-1" style={muted}>
                  <span>배경 불투명도 {settings.background === "transparent" ? "(투명 배경에서는 적용 안 됨)" : ""}</span>
                  <span>{settings.opacity}%</span>
                </label>
                <input
                  id="overlay-opacity"
                  type="range"
                  min={10}
                  max={100}
                  step={5}
                  value={settings.opacity}
                  disabled={settings.background === "transparent"}
                  onChange={(e) => update("opacity", Number(e.target.value))}
                  className="w-full accent-[var(--book-accent,#fbbf24)] h-8 disabled:opacity-40"
                />
              </div>
            </div>

            <Group legend="커버가 없는 곡">
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="커버가 없는 곡">
                <Radio name="coverFallback" value="placeholder" current={settings.coverFallback} label="기본 아이콘" onChange={(v) => update("coverFallback", v)} />
                <Radio name="coverFallback" value="hide" current={settings.coverFallback} label="영역 숨김" onChange={(v) => update("coverFallback", v)} />
              </div>
            </Group>

            <Group legend="곡이 없을 때 화면">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="곡이 없을 때 화면">
                <Radio name="idle" value="waiting" current={settings.idle} label="Waiting for Song" onChange={(v) => update("idle", v)} />
                <Radio name="idle" value="start" current={settings.idle} label="방송 시작 문구" onChange={(v) => update("idle", v)} />
                <Radio name="idle" value="custom" current={settings.idle} label="문구 직접 입력" onChange={(v) => update("idle", v)} />
                <Radio name="idle" value="hidden" current={settings.idle} label="아무것도 안 띄움" onChange={(v) => update("idle", v)} />
              </div>
              {settings.idle === "custom" && (
                <input
                  aria-label="곡이 없을 때 표시할 문구"
                  value={settings.idleText}
                  maxLength={60}
                  placeholder="예: 잠시 후 다음 곡이 시작됩니다"
                  onChange={(e) => update("idleText", e.target.value)}
                  className="book-input w-full mt-2 rounded-lg border px-3 py-2.5 text-[13px] outline-none"
                  style={{ ...chipStyle, color: "var(--book-text, #fff)" }}
                />
              )}
            </Group>

            <Group legend="공연이 끝났을 때 화면">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="공연이 끝났을 때 화면">
                <Radio name="endMode" value="ko" current={settings.endMode} label="오늘의 공연이 끝났습니다" onChange={(v) => update("endMode", v)} />
                <Radio name="endMode" value="finished" current={settings.endMode} label="Set Finished" onChange={(v) => update("endMode", v)} />
                <Radio name="endMode" value="thanks" current={settings.endMode} label="Thanks for watching" onChange={(v) => update("endMode", v)} />
                <Radio name="endMode" value="custom" current={settings.endMode} label="종료 문구 직접 입력" onChange={(v) => update("endMode", v)} />
                <Radio name="endMode" value="hide" current={settings.endMode} label="화면 숨기기" onChange={(v) => update("endMode", v)} />
              </div>
              {settings.endMode === "custom" && (
                <input
                  aria-label="공연이 끝났을 때 표시할 문구"
                  value={settings.endText}
                  maxLength={60}
                  placeholder="예: 오늘 방송은 여기까지! 고마워요"
                  onChange={(e) => update("endText", e.target.value)}
                  className="book-input w-full mt-2 rounded-lg border px-3 py-2.5 text-[13px] outline-none"
                  style={{ ...chipStyle, color: "var(--book-text, #fff)" }}
                />
              )}
            </Group>

            {/* ---- 고급 설정 (접어 둠: 처음 쓰는 사람은 위 항목만으로 충분해요) ---- */}
            <details className="rounded-xl border" style={chipStyle}>
              <summary className="cursor-pointer select-none px-4 py-3 text-[13.5px] font-medium min-h-[44px] flex items-center">
                위치 · 정렬
              </summary>
              <div className="px-4 pb-4 flex flex-col gap-4">
                <Group legend="위치">
                  <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="위치">
                    {OVERLAY_POSITIONS.map((p) => (
                      <Radio key={p.value} name="position" value={p.value} current={settings.position} label={p.label} onChange={(v) => update("position", v)} />
                    ))}
                  </div>
                </Group>
                <div>
                  <label htmlFor="overlay-ox" className="flex justify-between text-[12px] font-medium mb-1" style={muted}>
                    <span>좌우 미세 조정</span>
                    <span>{settings.offsetX}%</span>
                  </label>
                  <input id="overlay-ox" type="range" min={-OFFSET_X_MAX} max={OFFSET_X_MAX} step={1} value={settings.offsetX} onChange={(e) => update("offsetX", Number(e.target.value))} className="w-full accent-[var(--book-accent,#fbbf24)] h-8" />
                </div>
                <div>
                  <label htmlFor="overlay-oy" className="flex justify-between text-[12px] font-medium mb-1" style={muted}>
                    <span>위아래 미세 조정</span>
                    <span>{settings.offsetY}%</span>
                  </label>
                  <input id="overlay-oy" type="range" min={-OFFSET_Y_MAX} max={OFFSET_Y_MAX} step={1} value={settings.offsetY} onChange={(e) => update("offsetY", Number(e.target.value))} className="w-full accent-[var(--book-accent,#fbbf24)] h-8" />
                  <p className="text-[11.5px] mt-1" style={muted}>화면 밖으로 나가지 않도록 조정 범위를 제한했어요.</p>
                </div>
                <Group legend="글자 정렬">
                  <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="글자 정렬">
                    <Radio name="align" value="auto" current={settings.align} label="프리셋 기본" onChange={(v) => update("align", v)} />
                    <Radio name="align" value="left" current={settings.align} label="왼쪽" onChange={(v) => update("align", v)} />
                    <Radio name="align" value="center" current={settings.align} label="가운데" onChange={(v) => update("align", v)} />
                    <Radio name="align" value="right" current={settings.align} label="오른쪽" onChange={(v) => update("align", v)} />
                  </div>
                </Group>
              </div>
            </details>

            <details className="rounded-xl border" style={chipStyle}>
              <summary className="cursor-pointer select-none px-4 py-3 text-[13.5px] font-medium min-h-[44px] flex items-center">
                글꼴
              </summary>
              <div className="px-4 pb-4 flex flex-col gap-4">
                <Group legend="글꼴 종류 (기기에 설치된 기본 글꼴만 사용해요)">
                  <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="글꼴 종류">
                    <Radio name="fontFamily" value="sans" current={settings.fontFamily} label="고딕" onChange={(v) => update("fontFamily", v)} />
                    <Radio name="fontFamily" value="serif" current={settings.fontFamily} label="명조" onChange={(v) => update("fontFamily", v)} />
                    <Radio name="fontFamily" value="mono" current={settings.fontFamily} label="고정폭" onChange={(v) => update("fontFamily", v)} />
                  </div>
                </Group>
                <div>
                  <label htmlFor="overlay-fw" className="flex justify-between text-[12px] font-medium mb-1" style={muted}>
                    <span>글자 굵기</span>
                    <span>{settings.fontWeight}</span>
                  </label>
                  <input id="overlay-fw" type="range" min={400} max={800} step={100} value={settings.fontWeight} onChange={(e) => update("fontWeight", Number(e.target.value))} className="w-full accent-[var(--book-accent,#fbbf24)] h-8" />
                </div>
                <div>
                  <label htmlFor="overlay-lh" className="flex justify-between text-[12px] font-medium mb-1" style={muted}>
                    <span>줄 간격</span>
                    <span>{(settings.lineHeight / 100).toFixed(2)}</span>
                  </label>
                  <input id="overlay-lh" type="range" min={110} max={180} step={5} value={settings.lineHeight} onChange={(e) => update("lineHeight", Number(e.target.value))} className="w-full accent-[var(--book-accent,#fbbf24)] h-8" />
                </div>
                <div>
                  <label htmlFor="overlay-ls" className="flex justify-between text-[12px] font-medium mb-1" style={muted}>
                    <span>글자 간격</span>
                    <span>{(settings.letterSpacing / 100).toFixed(2)}em</span>
                  </label>
                  <input id="overlay-ls" type="range" min={-2} max={10} step={1} value={settings.letterSpacing} onChange={(e) => update("letterSpacing", Number(e.target.value))} className="w-full accent-[var(--book-accent,#fbbf24)] h-8" />
                </div>
              </div>
            </details>

            <details className="rounded-xl border" style={chipStyle}>
              <summary className="cursor-pointer select-none px-4 py-3 text-[13.5px] font-medium min-h-[44px] flex items-center">
                색상
              </summary>
              <div className="px-4 pb-4 flex flex-col gap-3">
                <Toggle label="노래책 강조색 사용" checked={settings.useBookAccent} onChange={(v) => update("useBookAccent", v)} />
                <ColorRow
                  label="강조색"
                  value={effective.accent}
                  fallback="fbbf24"
                  disabled={settings.useBookAccent}
                  onChange={(hex) => setSettings((st) => ({ ...st, accent: hex, useBookAccent: false }))}
                />
                <ColorRow label="글자 색" value={settings.textColor} fallback="ffffff" onChange={(hex) => update("textColor", hex)} onReset={() => update("textColor", "")} />
                <ColorRow label="보조 글자 색" value={settings.subColor} fallback="bfbfbf" onChange={(hex) => update("subColor", hex)} onReset={() => update("subColor", "")} />
                <ColorRow label="배경 색" value={settings.bgColor} fallback="14161f" onChange={(hex) => update("bgColor", hex)} onReset={() => update("bgColor", "")} />
                <p className="text-[11.5px]" style={muted}>
                  직접 고른 색이 노래책 색보다 우선해요. &quot;기본값&quot;을 누르면 자동 색으로 돌아가요. 배경 색은 반투명/카드/단색 배경에 적용돼요.
                </p>
              </div>
            </details>

            <details className="rounded-xl border" style={chipStyle}>
              <summary className="cursor-pointer select-none px-4 py-3 text-[13.5px] font-medium min-h-[44px] flex items-center">
                커버 · 진행도 · 큐
              </summary>
              <div className="px-4 pb-4 flex flex-col gap-4">
                <Group legend="커버 모양">
                  <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="커버 모양">
                    <Radio name="coverStyle" value="rounded" current={settings.coverStyle} label="둥근 사각형" onChange={(v) => update("coverStyle", v)} />
                    <Radio name="coverStyle" value="square" current={settings.coverStyle} label="사각형" onChange={(v) => update("coverStyle", v)} />
                    <Radio name="coverStyle" value="circle" current={settings.coverStyle} label="원형" onChange={(v) => update("coverStyle", v)} />
                    <Radio name="coverStyle" value="hidden" current={settings.coverStyle} label="커버 숨김" onChange={(v) => update("coverStyle", v)} />
                  </div>
                </Group>
                <Group legend="곡 진행도 스타일 (&quot;진행도&quot;를 켰을 때 · 플레이리스트에서 몇 번째 곡인지 보여줘요)">
                  <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="곡 진행도 스타일">
                    <Radio name="progressStyle" value="text" current={settings.progressStyle} label="글자만 (3 / 8)" onChange={(v) => update("progressStyle", v)} />
                    <Radio name="progressStyle" value="thin" current={settings.progressStyle} label="얇은 선" onChange={(v) => update("progressStyle", v)} />
                    <Radio name="progressStyle" value="thick" current={settings.progressStyle} label="굵은 선" onChange={(v) => update("progressStyle", v)} />
                    <Radio name="progressStyle" value="dot" current={settings.progressStyle} label="점" onChange={(v) => update("progressStyle", v)} />
                  </div>
                </Group>
                <Group legend="라이브 큐에 보여줄 곡">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="라이브 큐에 보여줄 곡">
                    <Radio name="queueMode" value="current" current={settings.queueMode} label="지금 곡만" onChange={(v) => update("queueMode", v)} />
                    <Radio name="queueMode" value="next" current={settings.queueMode} label="지금 + 다음" onChange={(v) => update("queueMode", v)} />
                    <Radio name="queueMode" value="next3" current={settings.queueMode} label="지금 + 다음 3곡" onChange={(v) => update("queueMode", v)} />
                  </div>
                </Group>
              </div>
            </details>
          </section>

          <section aria-labelledby="step3">
            <div id="step3">
              <StepTitle n="3">URL 복사하기</StepTitle>
            </div>
            <label htmlFor="overlay-url" className="text-[12px] font-medium block mb-1.5" style={muted}>
              OBS Overlay URL
            </label>
            <div className="flex gap-2">
              <input
                id="overlay-url"
                readOnly
                value={overlayUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="book-input flex-1 min-w-0 rounded-lg border px-3 py-2.5 text-[12.5px] outline-none"
                style={{ ...chipStyle, color: "var(--book-text, #fff)" }}
              />
              <button
                type="button"
                onClick={copyUrl}
                className="shrink-0 flex items-center gap-1.5 rounded-lg px-4 min-h-[42px] text-[13px] font-medium transition-[filter] hover:brightness-110 active:brightness-95"
                style={{ backgroundColor: "var(--book-accent, #fbbf24)", color: "#14161F" }}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span data-testid="overlay-copy-label">{copied ? "✓ 복사됨" : "URL 복사"}</span>
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
              <a
                href={overlayUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[12.5px] py-1.5 hover:underline"
                style={muted}
              >
                <ExternalLink className="h-3.5 w-3.5" /> 새 창에서 열어보기
              </a>
              <button
                type="button"
                onClick={regenerateKey}
                className="inline-flex items-center gap-1 text-[12.5px] py-1.5 hover:underline"
                style={muted}
              >
                <RefreshCw className="h-3.5 w-3.5" /> 방송 키 다시 만들기
              </button>
            </div>
            {dirty && (
              <p className="text-[11.5px] mt-1" style={{ color: "#fbbf24" }}>
                저장하지 않은 변경사항이 이 URL에 그대로 들어 있어요. 프로필에 저장해 두면 다음 방송에서 다시 불러올 수 있어요.
              </p>
            )}
            <p className="text-[11.5px] mt-1" style={muted}>
              URL 안의 방송 키는 이 노래책 방송 채널의 입장 열쇠예요. 다른 사람에게 공유하지 마세요.
            </p>
          </section>

          <section aria-labelledby="step4" className="rounded-xl border p-4" style={chipStyle}>
            <div id="step4">
              <StepTitle n="4">방송 오버레이 사용하기</StepTitle>
            </div>
            <ol className="list-decimal pl-5 text-[13px] leading-relaxed space-y-1" style={muted}>
              <li>위에서 <b>방송 오버레이 URL</b>을 복사합니다.</li>
              <li>OBS에서 소스 목록의 <b>+</b>를 눌러 <b>브라우저</b> 소스를 추가합니다.</li>
              <li>복사한 URL을 <b>URL 칸</b>에 붙여넣습니다. <b>처음 한 번만</b> 붙여넣으면 돼요. 이후 디자인을 바꾸면 OBS에 자동으로 적용돼요.</li>
              <li>화면 크기를 정합니다. 가로 방송은 너비 <b>1920</b>, 높이 <b>1080</b>, 세로 방송은 너비 <b>1080</b>, 높이 <b>1920</b>을 권장해요. 방송 캔버스에 맞춰 바꿔도 돼요.</li>
              <li>노래 부르기(또는 공연 모드)에서 노래를 시작합니다. 배경은 자동으로 투명해요.</li>
            </ol>
          </section>

          <section aria-labelledby="step5">
            <div id="step5">
              <StepTitle n="5">연결 확인하고 방송 시작</StepTitle>
            </div>
            <div className="flex items-center justify-between gap-2 mb-3 text-[13px]">
              <span style={muted}>실시간 연결</span>
              <span data-testid="overlay-link-status" className="font-medium text-right" style={{ color: link.color }}>
                <span aria-hidden="true">{link.icon}</span> {link.text}
              </span>
            </div>
            <p className="text-[11.5px] -mt-2 mb-3" style={muted}>
              위 표시는 이 화면과 실시간 서버 사이의 연결이에요. OBS가 켜져 있는지는 아래 &quot;OBS 오버레이&quot;에서 확인하세요.
            </p>
            <div className="flex items-center justify-between gap-2 mb-1 text-[13px]">
              <span style={muted}>OBS 오버레이</span>
              <span data-testid="overlay-obs-status" className="font-medium text-right" style={{ color: connectedOverlays.length > 0 ? "#22c55e" : "#fbbf24" }}>
                {connectedOverlays.length > 0 ? `🟢 OBS 연결됨 (${connectedOverlays.length}개)` : "🟡 OBS 연결 대기 중"}
              </span>
            </div>
            <p data-testid="overlay-apply-status" role="status" className="text-[12px] mb-3" style={muted}>
              {published === null
                ? ""
                : connectedOverlays.length === 0
                  ? "✓ 설정 저장됨 — OBS가 연결되면 자동으로 적용돼요."
                  : allApplied
                    ? "✓ OBS에 적용됨"
                    : "OBS에 적용하는 중…"}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {testActive ? (
                <button
                  type="button"
                  // 확인 신호를 이미 받았다면 종료해도 "✓ 정상" 결과는 남긴다
                  onClick={() => stopTest(test === "ok" ? "ok" : "idle")}
                  className="rounded-lg border px-4 min-h-[42px] text-[13px]"
                  style={chipStyle}
                >
                  테스트 종료
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startTest}
                  className="rounded-lg border px-4 min-h-[42px] text-[13px] font-medium transition-[filter] hover:brightness-110 active:brightness-95"
                  style={chipStyle}
                >
                  OBS 연결 테스트
                </button>
              )}
              <span data-testid="overlay-test-result" role="status" className="text-[12.5px]" style={muted}>
                {test === "sending" && "OBS 화면에 테스트 문구를 보내는 중이에요… (최대 30초)"}
                {test === "ok" && <span style={{ color: "#22c55e" }}>✓ OBS에서 테스트 화면을 받았어요. 연결이 정상이에요!</span>}
                {test === "timeout" && "OBS에서 응답이 없어요. URL을 다시 붙여넣었는지, 소스가 켜져 있는지 확인해주세요."}
              </span>
            </div>
            <p className="text-[12px] mt-3 leading-relaxed" style={muted}>
              테스트가 끝나면 노래 부르기나 공연 모드를 시작하세요. 곡을 바꾸면 OBS 화면도 자동으로 바뀌어요.
              방송 키는 계정에 저장돼서(서버가 준비된 경우) 다른 기기에서 노래를 불러도 같은 URL로 방송돼요. 서버가 준비되지 않았다면 이 브라우저에서만 유효해요.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

/**
 * 앱 전체 공통 피드백: 토스트(알림)와 확인 창.
 * - notify(): 화면을 막는 브라우저 alert() 대신 아래쪽에 잠깐 뜨는 알림. "무엇이 됐는지"를 문장으로 적는다.
 * - confirmAsync(): confirm() 대신 "삭제", "가져오기"처럼 실제 행동 이름이 버튼에 적힌 확인 창. Esc/바깥 클릭/취소는 모두 "취소"다.
 * 둘 다 <FeedbackHost /> 가 마운트되어 있어야 보인다 (App 의 AppShell 에 한 번만).
 */
export type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** 확인 버튼에 적을 실제 행동 이름 (예: "삭제", "저장하지 않고 이동") — "확인"은 쓰지 않는다 */
  confirmLabel: string;
  cancelLabel?: string;
  /** danger: 되돌릴 수 없는 위험한 행동 (빨간 버튼, 기본 포커스는 취소) */
  tone?: "default" | "danger";
}

type ToastListener = (toasts: Toast[]) => void;
type ConfirmRequest = ConfirmOptions & { resolve: (ok: boolean) => void };

let toasts: Toast[] = [];
let nextId = 1;
const toastListeners = new Set<ToastListener>();
let confirmListener: ((req: ConfirmRequest | null) => void) | null = null;
const confirmQueue: ConfirmRequest[] = [];

function emitToasts() {
  toastListeners.forEach((l) => l(toasts));
}

export function notify(text: string, kind: ToastKind = "success"): void {
  const id = nextId++;
  toasts = [...toasts.slice(-2), { id, kind, text }];
  emitToasts();
  window.setTimeout(() => dismiss(id), kind === "error" ? 7000 : 4500);
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emitToasts();
}

/** 확인 창을 띄우고 사용자의 선택을 기다린다. 확인 = true, 취소/Esc/바깥 클릭 = false */
export function confirmAsync(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const req: ConfirmRequest = { ...options, resolve };
    if (!confirmListener) {
      // 호스트가 없으면(테스트 환경 등) 안전하게 "취소"
      resolve(false);
      return;
    }
    confirmQueue.push(req);
    if (confirmQueue.length === 1) confirmListener(req);
  });
}

function nextConfirm() {
  confirmQueue.shift();
  confirmListener?.(confirmQueue[0] ?? null);
}

const ICON = { success: CheckCircle2, error: AlertTriangle, info: Info } as const;
const TINT = { success: "#34d399", error: "#f87171", info: "#93c5fd" } as const;

export function FeedbackHost() {
  const [list, setList] = useState<Toast[]>(toasts);
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    toastListeners.add(setList);
    confirmListener = setReq;
    return () => {
      toastListeners.delete(setList);
      if (confirmListener === setReq) confirmListener = null;
    };
  }, []);

  useEffect(() => {
    if (!req) return;
    lastFocus.current = document.activeElement as HTMLElement | null;
    // 위험한 행동은 기본 포커스를 "취소"에 둬서 Enter 로 실수 삭제하지 않게 한다
    (req.tone === "danger" ? cancelRef.current : okRef.current)?.focus();
    return () => lastFocus.current?.focus?.();
  }, [req]);

  function close(ok: boolean) {
    req?.resolve(ok);
    nextConfirm();
  }

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        req.resolve(false);
        nextConfirm();
      } else if (e.key === "Tab") {
        // 창 밖으로 포커스가 나가지 않게 두 버튼 사이에서만 이동
        const a = cancelRef.current;
        const b = okRef.current;
        if (!a || !b) return;
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          b.focus();
        } else if (!e.shiftKey && document.activeElement === b) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req]);

  return (
    <>
      <div
        className="fixed z-[60] left-0 right-0 bottom-24 sm:bottom-6 flex flex-col items-center gap-2 px-4 pointer-events-none"
        aria-live="polite"
      >
        {list.map((t) => {
          const Icon = ICON[t.kind];
          return (
            <div
              key={t.id}
              role={t.kind === "error" ? "alert" : "status"}
              data-testid="toast"
              data-kind={t.kind}
              className="pointer-events-auto flex items-start gap-2.5 max-w-md w-full rounded-xl border border-white/10 bg-[#1B1E2A] text-white/90 text-[13.5px] leading-snug px-3.5 py-3 shadow-lg"
            >
              <Icon className="h-4 w-4 mt-0.5 shrink-0" style={{ color: TINT[t.kind] }} aria-hidden="true" />
              <span className="flex-1 min-w-0 [overflow-wrap:anywhere]">{t.text}</span>
              <button type="button" onClick={() => dismiss(t.id)} aria-label="알림 닫기" title="알림 닫기" className="shrink-0 -m-1.5 p-1.5 text-white/50 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>

      {req && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close(false);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby={req.message ? "confirm-desc" : undefined}
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#14161F] text-white p-5 max-h-[85vh] overflow-y-auto"
          >
            <h2 id="confirm-title" className="text-[16px] font-semibold [overflow-wrap:anywhere]">
              {req.title}
            </h2>
            {req.message && (
              <p id="confirm-desc" className="mt-2 text-[13.5px] leading-relaxed text-white/65 whitespace-pre-line [overflow-wrap:anywhere]">
                {req.message}
              </p>
            )}
            <div className="mt-5 flex gap-2">
              <button
                ref={cancelRef}
                type="button"
                data-testid="confirm-cancel"
                onClick={() => close(false)}
                className="flex-1 rounded-xl border border-white/12 bg-white/[0.05] text-white/85 min-h-[44px] text-[14px] hover:brightness-125"
              >
                {req.cancelLabel ?? "취소"}
              </button>
              <button
                ref={okRef}
                type="button"
                data-testid="confirm-ok"
                onClick={() => close(true)}
                className={`flex-1 rounded-xl min-h-[44px] text-[14px] font-medium hover:brightness-110 ${
                  req.tone === "danger" ? "bg-red-500/90 text-white" : "bg-amber-400 text-[#14161F]"
                }`}
              >
                {req.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

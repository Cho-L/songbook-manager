import { useCallback, useEffect, useRef, useState } from "react";
import { detectLineLang, isSavablePron, runPronunciation, type PronLine } from "../lyrics/pronunciation";

export type DraftRow = PronLine & { edited?: boolean };

/**
 * 가사 줄들의 한글 발음 초안을 자동으로 만든다 (후보 미리보기용).
 * - texts 내용(키)이 같으면 한 번만 만든다 (중복 생성 방지). 늦게 끝난 이전 요청 결과는 버린다.
 * - 사용자가 고친 줄은 다시 만들어도 덮어쓰지 않는다.
 * - 실패해도 예외를 던지지 않는다: 줄별 상태/경고로만 알린다 (가사 적용은 그대로 가능).
 */
export function usePronDraft(texts: string[], enabled: boolean) {
  const key = texts.join("\n");
  const [state, setState] = useState<{ key: string; rows: DraftRow[]; warnings: string[]; loading: boolean }>({ key: "", rows: [], warnings: [], loading: false });
  const [stage, setStage] = useState("");
  const token = useRef(0);
  const textsRef = useRef(texts);
  useEffect(() => {
    textsRef.current = texts;
  });
  const hasTarget = texts.some((t) => {
    const l = detectLineLang(t);
    return l === "ja" || l === "en";
  });

  const generate = useCallback(async (k: string) => {
    const my = ++token.current;
    try {
      const { rows, warnings } = await runPronunciation(textsRef.current, undefined, (t) => my === token.current && setStage(t));
      if (my !== token.current) return;
      setStage("");
      setState({ key: k, rows, warnings, loading: false });
    } catch {
      if (my !== token.current) return;
      setState({ key: k, rows: [], warnings: ["발음을 만들지 못했어요 — 가사만 적용할 수 있어요."], loading: false });
    }
  }, []);

  useEffect(() => {
    if (!enabled || !hasTarget) return;
    if (state.key === key) return;
    const h = setTimeout(() => void generate(key), 0);
    return () => clearTimeout(h);
  }, [enabled, hasTarget, key, state.key, generate]);

  const edit = useCallback((i: number, value: string) => {
    setState((s) => ({ ...s, rows: s.rows.map((r, j) => (j === i ? { ...r, pron: value, edited: true } : r)) }));
  }, []);
  /** 고치지 않은 줄만 다시 만든다 */
  const regenerate = useCallback(async () => {
    const my = ++token.current;
    setState((s) => ({ ...s, loading: true }));
    const { rows, warnings } = await runPronunciation(textsRef.current, undefined, (t) => my === token.current && setStage(t));
    if (my !== token.current) return;
    setStage("");
    setState((s) => ({ ...s, loading: false, warnings, rows: rows.map((r, i) => (s.rows[i]?.edited ? s.rows[i] : r)) }));
  }, []);

  const ready = state.key === key;
  const rows = ready ? state.rows : [];
  /** 저장할 발음 (미완성/빈 줄은 ""). 줄 수는 texts 와 같다 */
  const prons = texts.map((_, i) => (ready && rows[i] && isSavablePron(rows[i].pron) ? rows[i].pron.trim() : ""));
  return {
    enabled: hasTarget,
    loading: enabled && hasTarget && (!ready || state.loading),
    rows,
    warnings: ready ? state.warnings : [],
    stage,
    prons,
    edit,
    regenerate,
    counts: {
      ok: rows.filter((r) => r.pron.trim() && isSavablePron(r.pron)).length,
      review: rows.filter((r) => (r.status === "review" || r.status === "unsupported") && r.lang !== "none").length,
      failed: rows.filter((r) => (r.lang === "ja" || r.lang === "en") && !isSavablePron(r.pron)).length,
    },
  };
}

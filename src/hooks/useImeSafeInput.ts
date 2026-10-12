import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, CompositionEvent, FocusEvent, KeyboardEvent } from "react";

/**
 * 한글/일본어 같은 IME 입력에 안전한 검색 입력창 훅.
 *
 * 문제: 입력값을 곧바로 URL(react-router)이나 무거운 필터 상태에 넣고 다시 value 로 돌려받으면,
 * 글자를 "조합하는 중"에 value 가 바뀌어 조합이 끊기거나 글자가 밀린다.
 *
 * 해결:
 * - 화면에 보이는 값(draft)은 이 훅이 가진 로컬 state 라서 타이핑은 항상 즉시, 같은 틱에 반영된다.
 * - 조합 중(compositionstart ~ compositionend)에는 바깥으로 값을 내보내지 않는다.
 * - 조합이 끝나거나 일반 입력이면 debounce 후(Enter/blur 는 즉시) onCommit 으로 내보낸다.
 * - 바깥 값(URL 뒤로가기 등)이 바뀌면 입력창이 포커스/조합 중이 아닐 때만 draft 를 맞춘다.
 */
export function useImeSafeInput(value: string, onCommit: (v: string) => void, delayMs = 150) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const composingRef = useRef(false);
  const timer = useRef<number | null>(null);
  const commitRef = useRef(onCommit);
  useEffect(() => {
    commitRef.current = onCommit;
  });

  // 바깥 값이 바뀌었을 때(뒤로 가기/지우기 버튼 등): 입력 중이 아니면 따라간다. (렌더 중 state 조정 패턴)
  if (value !== seen) {
    setSeen(value);
    if (!focused && !composing) setDraft(value);
  }

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const commit = useCallback(
    (v: string) => {
      clearTimer();
      commitRef.current(v);
    },
    [clearTimer]
  );

  useEffect(() => clearTimer, [clearTimer]);

  return {
    /** <input value=...> 에 넣을 값 */
    value: draft,
    inputProps: {
      onChange: (e: ChangeEvent<HTMLInputElement>) => {
        const v = e.target.value;
        setDraft(v);
        if (composingRef.current) return; // 조합 중에는 내보내지 않는다
        clearTimer();
        timer.current = window.setTimeout(() => commit(v), delayMs);
      },
      onCompositionStart: () => {
        composingRef.current = true;
        setComposing(true);
        clearTimer();
      },
      onCompositionEnd: (e: CompositionEvent<HTMLInputElement>) => {
        composingRef.current = false;
        setComposing(false);
        const v = e.currentTarget.value;
        setDraft(v);
        clearTimer();
        timer.current = window.setTimeout(() => commit(v), delayMs);
      },
      onFocus: () => setFocused(true),
      onBlur: (e: FocusEvent<HTMLInputElement>) => {
        setFocused(false);
        if (!composingRef.current) commit(e.currentTarget.value);
      },
      onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
        // 조합 중 Enter 는 "글자 확정"이지 검색 실행이 아니다
        if (e.key === "Enter" && !composingRef.current && !e.nativeEvent.isComposing) commit(e.currentTarget.value);
      },
    },
    /** "지우기" 버튼용: 즉시 비우고 바로 내보낸다 */
    clear: () => {
      composingRef.current = false;
      setComposing(false);
      setDraft("");
      commit("");
    },
  };
}

import { searchRankedDetailed, type ResolveInput } from "./pipeline";
import { describeLyricsError, isAbort } from "./errors";
import type { LyricsProvider, LyricsRequestObserver, RecordingLyricsResult, ScoredCandidate } from "./types";

/** Preserve empty/error/incomplete states instead of turning every failure into []. */
export async function searchRecordingLyrics(input: ResolveInput, provider: LyricsProvider, observe?: LyricsRequestObserver): Promise<{
  result: RecordingLyricsResult; candidates: ScoredCandidate[];
}> {
  try {
    const { candidates, diagnostics } = await searchRankedDetailed(input, provider, { observe });
    const ids = candidates.map((c) => c.id);
    const incomplete = diagnostics.failures > 0 || diagnostics.budgetExhausted;
    return { candidates, result: {
      status: incomplete ? "incomplete" : ids.length ? "found" : "empty", ids,
      message: incomplete ? diagnostics.failures > 0
        ? "일부 조회에 실패해 검색을 완료하지 못했어요. 가사 없음으로 판단할 수 없어요."
        : "요청 횟수 제한으로 일부 검색을 생략했어요. 제공자 전체의 가사 유무는 확인하지 못했어요." : undefined,
    } };
  } catch (e) {
    if (isAbort(e)) throw e;
    return { candidates: [], result: { status: "failed", ids: [], message: describeLyricsError(e) } };
  }
}

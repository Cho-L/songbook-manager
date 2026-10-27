import type { RecordingLyricsResult } from "../../lyrics/types";

export function RecordingLyricsFeedback({ result }: { result: RecordingLyricsResult }) {
  if (result.status === "found") return null;
  return (
    <div className="mt-1 text-[12.5px] opacity-70" role={result.status === "failed" ? "alert" : "status"}
      data-testid={`rec-${result.status}`}>
      {result.status === "empty" ? "검색한 표기에서 사용할 가사 후보를 받지 못했어요. 제공자 전체의 미수록을 뜻하지는 않아요." : result.message}
    </div>
  );
}

import { useState } from "react";
import { Search, Check } from "lucide-react";
import { searchYouTube, type YouTubeSearchResult } from "../../services/youtubeService";

interface YouTubeSearchPickerProps {
  /** 검색창 초기값으로 쓸 "제목 + 가수" 조합 */
  initialQuery?: string;
  currentVideoId?: string;
  onSelect: (videoId: string) => void;
}

export function YouTubeSearchPicker({
  initialQuery = "",
  currentVideoId,
  onSelect,
}: YouTubeSearchPickerProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<YouTubeSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function handleSearch() {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const res = await searchYouTube(query);
      setResults(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "YouTube 검색에 실패했습니다. 잠시 후 다시 시도해주세요.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {currentVideoId && (
        <div className="mb-3 rounded-lg bg-white/[0.04] border border-white/[0.06] px-3 py-2.5">
          <div className="text-[11px] text-white/40 mb-1">현재 지정 영상</div>
          <div className="text-[13px] text-white/70">videoId: {currentVideoId}</div>
        </div>
      )}

      <div className="flex gap-2">
        <input
          aria-label="YouTube 검색어"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="제목 가수 (예: 밤편지 아이유)"
          className="flex-1 rounded-lg bg-white/[0.06] border border-white/10 px-3 py-2.5 text-[14px] placeholder-white/30 outline-none focus:border-amber-400/50"
        />
        <button
          type="button"
          onClick={handleSearch}
          aria-label="YouTube 검색"
          title="YouTube 검색"
          className="px-3 rounded-lg bg-white/[0.08] border border-white/10 text-white/70"
        >
          <Search className="h-4 w-4" />
        </button>
      </div>

      {loading && (
        <p className="text-[13px] text-white/40 mt-3">YouTube 영상 검색 중...</p>
      )}

      {!loading && error && (
        <p className="text-[13px] text-red-400 mt-3">{error}</p>
      )}

      {!loading && !error && searched && results.length === 0 && (
        <p className="text-[13px] text-white/40 mt-3">검색 결과가 없습니다.</p>
      )}

      {!loading && results.length > 0 && (
        <div className="mt-3 flex flex-col gap-2 max-h-72 overflow-y-auto">
          {results.map((r) => (
            <div
              key={r.videoId}
              className="flex items-center gap-3 rounded-lg bg-white/[0.04] border border-white/[0.06] p-2"
            >
              {r.thumbnailUrl && (
                <img
                  src={r.thumbnailUrl}
                  alt=""
                  className="h-12 w-20 object-cover rounded-md shrink-0"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-white/85 truncate">{r.title}</div>
                <div className="text-[11.5px] text-white/40 truncate">{r.channelTitle}</div>
              </div>
              <button
                type="button"
                onClick={() => onSelect(r.videoId)}
                className={`shrink-0 px-2.5 py-1.5 rounded-md text-[12px] flex items-center gap-1 ${
                  currentVideoId === r.videoId
                    ? "bg-amber-400 text-[#14161F]"
                    : "bg-white/[0.08] text-white/70"
                }`}
              >
                <Check className="h-3.5 w-3.5" /> 선택
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

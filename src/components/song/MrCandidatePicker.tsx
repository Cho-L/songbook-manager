import { ExternalLink } from "lucide-react";
import type { MrCandidate } from "../../utils/mrSearch";

const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

interface MrCandidatePickerProps {
  /** 라디오 그룹 이름 (행/곡마다 고유해야 한다) */
  name: string;
  legend: string;
  /** "자동 연결됨" / "직접 선택 필요" */
  statusLabel: string;
  candidates: MrCandidate[];
  /** 선택된 videoId (null = 연결 안 함) */
  selected: string | null;
  onSelect: (videoId: string | null) => void;
  disabled?: boolean;
}

/** MR 후보 목록(제목·채널·점수·열어보기 링크) + "연결 안 함". CSV/JSON 가져오기와 기존 노래책 일괄 검색이 함께 쓴다. */
export function MrCandidatePicker({ name, legend, statusLabel, candidates, selected, onSelect, disabled }: MrCandidatePickerProps) {
  return (
    <fieldset className="rounded-md border border-white/10 p-2 min-w-0" disabled={disabled}>
      <legend className="px-1 text-[12px] text-white/70 max-w-full truncate">
        {legend}
        <span className="text-white/40"> · {statusLabel}</span>
      </legend>
      {candidates.map((c) => (
        <label key={c.videoId} className="flex items-start gap-2 py-1 text-[12px] text-white/75 cursor-pointer">
          <input
            type="radio"
            className="mt-0.5 accent-[var(--book-accent,#fbbf24)] shrink-0"
            name={name}
            checked={selected === c.videoId}
            onChange={() => onSelect(c.videoId)}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{c.title}</span>
            <span className="block text-[11px] text-white/40 truncate">
              {c.channelTitle} · 점수 {Math.round(c.score * 100)}
              {c.flags.length > 0 && ` · 주의: ${c.flags.join(", ")}`}
            </span>
          </span>
          <a
            href={watchUrl(c.videoId)}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 p-1 text-white/50 hover:text-white"
            aria-label="YouTube에서 열어보기"
            title="YouTube에서 열어보기"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </label>
      ))}
      <label className="flex items-center gap-2 py-1 text-[12px] text-white/55 cursor-pointer">
        <input
          type="radio"
          className="accent-[var(--book-accent,#fbbf24)]"
          name={name}
          checked={selected === null}
          onChange={() => onSelect(null)}
        />
        연결 안 함
      </label>
    </fieldset>
  );
}

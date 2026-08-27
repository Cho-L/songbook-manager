import { splitTextByUrls } from "../../utils/lyrics";

interface LinkifiedTextProps {
  text: string;
  className?: string;
}

/** 텍스트 안의 URL만 <a>로 렌더링하고 나머지는 일반 텍스트로 표시한다. */
export function LinkifiedText({ text, className }: LinkifiedTextProps) {
  const parts = splitTextByUrls(text);
  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.isUrl ? (
          <a
            key={i}
            href={part.text.startsWith("http") ? part.text : `https://${part.text}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-amber-300/90 hover:text-amber-300"
            onClick={(e) => e.stopPropagation()}
          >
            {part.text}
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </span>
  );
}

const SHARP_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_TO_SHARP: Record<string, string> = {
  Db: "C#",
  Eb: "D#",
  Gb: "F#",
  Ab: "G#",
  Bb: "A#",
};

// "Am7", "C#m", "Bb/D", "G7", "Fmaj7" 같은 코드 토큰을 인식한다.
const CHORD_PATTERN = /^([A-G])(#|b)?((?:maj|min|dim|aug|sus|add)?[0-9]*m?[0-9]*(?:\/[A-G](?:#|b)?)?)$/;

function normalizeRoot(root: string, accidental?: string): string {
  const raw = root + (accidental ?? "");
  return FLAT_TO_SHARP[raw] ?? raw;
}

function transposeNote(note: string, semitones: number): string {
  const idx = SHARP_NOTES.indexOf(note);
  if (idx === -1) return note;
  const shifted = (((idx + semitones) % 12) + 12) % 12;
  return SHARP_NOTES[shifted];
}

/** 코드 토큰 하나(예: "Am7", "G/B")를 semitones만큼 이조한다. 코드가 아니면 원문 그대로 반환. */
export function transposeChordToken(token: string, semitones: number): string {
  if (semitones === 0) return token;
  const match = token.match(CHORD_PATTERN);
  if (!match) return token;

  const [, root, accidental, rest] = match;
  const normalizedRoot = normalizeRoot(root, accidental);
  const transposedRoot = transposeNote(normalizedRoot, semitones);

  // "/D" 같은 베이스 표기가 rest 안에 있으면 그것도 함께 이조한다.
  const transposedRest = rest.replace(
    /\/([A-G])(#|b)?/,
    (_full, bassRoot: string, bassAccidental?: string) => {
      const normalizedBass = normalizeRoot(bassRoot, bassAccidental);
      return "/" + transposeNote(normalizedBass, semitones);
    }
  );

  return transposedRoot + transposedRest;
}

/** 코드 텍스트 전체(줄바꿈/공백으로 구분된 여러 코드)를 semitones만큼 이조한다. */
export function transposeChordsText(text: string | undefined, semitones: number): string {
  if (!text) return "";
  if (semitones === 0) return text;
  // 공백/줄바꿈은 그대로 두고 토큰 단위로만 치환
  return text.replace(/[A-Za-z0-9#/]+/g, (token) => transposeChordToken(token, semitones));
}

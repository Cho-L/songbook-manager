import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, X } from "lucide-react";
import type { Song, SongFormInput } from "../types/song";
import { YouTubeSearchPicker } from "../components/song/YouTubeSearchPicker";
import { normalizeLyrics } from "../utils/lyrics";
import { parseAliasInput } from "../utils/songAliases";

interface SongFormPageProps {
  songs: Song[];
  onAdd: (input: SongFormInput) => Promise<Song>;
  onUpdate: (id: string, input: SongFormInput) => Promise<Song | null>;
}

interface FormState {
  title: string;
  artist: string;
  composer: string;
  lyricist: string;
  genre: string;
  key: string;
  bpm: string;
  difficulty: string;
  lyrics: string;
  chords: string;
  memo: string;
  tags: string;
  titleAliases: string;
  artistAliases: string;
  youtubeVideoId: string;
}

const emptyForm: FormState = {
  title: "",
  artist: "",
  composer: "",
  lyricist: "",
  genre: "",
  key: "",
  bpm: "",
  difficulty: "",
  lyrics: "",
  chords: "",
  memo: "",
  tags: "",
  titleAliases: "",
  artistAliases: "",
  youtubeVideoId: "",
};

function songToForm(song: Song): FormState {
  return {
    title: song.title,
    artist: song.artist,
    composer: song.composer ?? "",
    lyricist: song.lyricist ?? "",
    genre: song.genre ?? "",
    key: song.key ?? "",
    bpm: song.bpm != null ? String(song.bpm) : "",
    difficulty: song.difficulty != null ? String(song.difficulty) : "",
    lyrics: song.lyrics ?? "",
    chords: song.chords ?? "",
    memo: song.memo ?? "",
    tags: song.tags.join(", "),
    titleAliases: (song.titleAliases ?? []).join(", "),
    artistAliases: (song.artistAliases ?? []).join(", "),
    youtubeVideoId: song.youtubeVideoId ?? "",
  };
}

type FormErrors = Partial<Record<keyof FormState, string>>;

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!form.title.trim()) errors.title = "제목을 입력해주세요";
  if (!form.artist.trim()) errors.artist = "가수를 입력해주세요";
  if (form.bpm && (isNaN(Number(form.bpm)) || Number(form.bpm) <= 0)) {
    errors.bpm = "BPM은 숫자로 입력해주세요";
  }
  if (
    form.difficulty &&
    (isNaN(Number(form.difficulty)) ||
      Number(form.difficulty) < 1 ||
      Number(form.difficulty) > 5)
  ) {
    errors.difficulty = "난이도는 1~5 사이 숫자예요";
  }
  return errors;
}

const inputCls =
  "w-full rounded-lg bg-white/[0.06] border border-white/10 px-3 py-2.5 text-[15px] text-white placeholder-white/30 outline-none focus:border-amber-400/50 focus:ring-1 focus:ring-amber-400/30 transition";
const labelCls = "text-xs text-white/45 mb-1.5 block";

export function SongFormPage({ songs, onAdd, onUpdate }: SongFormPageProps) {
  const { ownerId, id } = useParams();
  const navigate = useNavigate();
  const editingSong = id ? songs.find((s) => s.id === id) : undefined;
  const isEditing = Boolean(editingSong);

  const [form, setForm] = useState<FormState>(
    editingSong ? songToForm(editingSong) : emptyForm
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showYouTubeSearch, setShowYouTubeSearch] = useState(!editingSong?.youtubeVideoId);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    const validationErrors = validate(form);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    const tags = form.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const input: SongFormInput = {
      title: form.title.trim(),
      artist: form.artist.trim(),
      composer: form.composer.trim() || undefined,
      lyricist: form.lyricist.trim() || undefined,
      genre: form.genre.trim() || undefined,
      key: form.key.trim() || undefined,
      bpm: form.bpm ? Number(form.bpm) : undefined,
      difficulty: form.difficulty ? Number(form.difficulty) : undefined,
      lyrics: form.lyrics ? normalizeLyrics(form.lyrics) : undefined,
      chords: form.chords || undefined,
      memo: form.memo || undefined,
      tags,
      titleAliases: parseAliasInput(form.titleAliases).length ? parseAliasInput(form.titleAliases) : undefined,
      artistAliases: parseAliasInput(form.artistAliases).length ? parseAliasInput(form.artistAliases) : undefined,
      youtubeVideoId: form.youtubeVideoId || undefined,
    };

    setSaving(true);
    setSaveError(null);
    try {
      if (isEditing && editingSong) {
        await onUpdate(editingSong.id, input);
        navigate(`/books/${ownerId}/songs/${editingSong.id}`);
      } else {
        const created = await onAdd(input);
        navigate(`/books/${ownerId}/songs/${created.id}`);
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "저장에 실패했어요.");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    navigate(
      isEditing && editingSong
        ? `/books/${ownerId}/songs/${editingSong.id}`
        : `/books/${ownerId}`
    );
  }

  return (
    <div className="max-w-md lg:max-w-3xl mx-auto pb-16">
      <div className="flex items-center justify-between px-4 lg:px-8 pt-5 pb-2">
        <button
          onClick={handleCancel}
          className="flex items-center gap-1 px-3 min-h-[40px] -ml-3 rounded-lg text-[14px] text-white/70 hover:text-white"
          aria-label="취소"
        >
          <X className="h-4 w-4" /> 취소
        </button>
        <span className="text-sm text-white/70 font-medium">
          {isEditing ? "노래 수정" : "노래 추가"}
        </span>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 min-h-[40px] -mr-1 rounded-full text-[14px] font-semibold bg-amber-400 text-[#14161F] disabled:opacity-50 hover:brightness-110"
          aria-label="저장"
        >
          <Check className="h-4 w-4" /> {saving ? "저장 중..." : "저장"}
        </button>
      </div>

      {saveError && (
        <p className="px-5 text-[13px] text-red-400 mt-1">{saveError}</p>
      )}

      <div className="px-5 lg:px-8 pt-3 flex flex-col gap-4">
        <div className="lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0 space-y-4">
          <div>
            <label className={labelCls}>제목 *</label>
            <input aria-label="제목"
              className={inputCls}
              value={form.title}
              onChange={(e) => setField("title", e.target.value)}
            />
            {errors.title && (
              <p className="text-xs text-red-400 mt-1">{errors.title}</p>
            )}
          </div>
          <div>
            <label className={labelCls}>가수 *</label>
            <input aria-label="가수"
              className={inputCls}
              value={form.artist}
              onChange={(e) => setField("artist", e.target.value)}
            />
            {errors.artist && (
              <p className="text-xs text-red-400 mt-1">{errors.artist}</p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>작곡가</label>
            <input aria-label="작곡가"
              className={inputCls}
              value={form.composer}
              onChange={(e) => setField("composer", e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>작사가</label>
            <input aria-label="작사가"
              className={inputCls}
              value={form.lyricist}
              onChange={(e) => setField("lyricist", e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>장르</label>
            <input aria-label="장르"
              className={inputCls}
              value={form.genre}
              onChange={(e) => setField("genre", e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>키</label>
            <input aria-label="키"
              className={inputCls}
              value={form.key}
              onChange={(e) => setField("key", e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>BPM</label>
            <input aria-label="BPM"
              className={inputCls}
              inputMode="numeric"
              value={form.bpm}
              onChange={(e) => setField("bpm", e.target.value)}
            />
            {errors.bpm && (
              <p className="text-xs text-red-400 mt-1">{errors.bpm}</p>
            )}
          </div>
          <div>
            <label className={labelCls}>난이도 (1~5)</label>
            <input aria-label="난이도 (1~5)"
              className={inputCls}
              inputMode="numeric"
              value={form.difficulty}
              onChange={(e) => setField("difficulty", e.target.value)}
            />
            {errors.difficulty && (
              <p className="text-xs text-red-400 mt-1">{errors.difficulty}</p>
            )}
          </div>
        </div>
        <div>
          <label className={labelCls}>태그 (쉼표로 구분)</label>
          <input aria-label="태그 (쉼표로 구분)"
            className={inputCls}
            value={form.tags}
            onChange={(e) => setField("tags", e.target.value)}
            placeholder="발라드, 연습곡"
          />
        </div>

        <div>
          <label className={labelCls}>제목 별칭 (다른 언어/표기, 쉼표로 구분)</label>
          <input aria-label="제목 별칭"
            className={inputCls}
            value={form.titleAliases}
            onChange={(e) => setField("titleAliases", e.target.value)}
            placeholder="Dear Name, 愛称"
          />
        </div>
        <div>
          <label className={labelCls}>가수 별칭 (쉼표로 구분)</label>
          <input aria-label="가수 별칭"
            className={inputCls}
            value={form.artistAliases}
            onChange={(e) => setField("artistAliases", e.target.value)}
            placeholder="IU, 이지은"
          />
        </div>

        <div>
          <label className={labelCls}>YouTube 영상 (MR)</label>
          {!showYouTubeSearch && form.youtubeVideoId ? (
            <div className="rounded-lg bg-white/[0.04] border border-white/[0.06] px-3 py-2.5 flex items-center justify-between">
              <span className="text-[13px] text-white/70">
                현재 지정 영상: {form.youtubeVideoId}
              </span>
              <button
                type="button"
                onClick={() => setShowYouTubeSearch(true)}
                className="text-[12px] text-amber-300 shrink-0 ml-3"
              >
                영상 변경
              </button>
            </div>
          ) : (
            <YouTubeSearchPicker
              initialQuery={`${form.title} ${form.artist}`.trim()}
              currentVideoId={form.youtubeVideoId || undefined}
              onSelect={(videoId) => {
                setField("youtubeVideoId", videoId);
                setShowYouTubeSearch(false);
              }}
            />
          )}
        </div>

        <div className="lg:grid lg:grid-cols-2 lg:gap-3 space-y-4 lg:space-y-0">
          <div>
            <label className={labelCls}>메모</label>
            <textarea aria-label="메모"
              className={inputCls + " min-h-[70px]"}
              value={form.memo}
              onChange={(e) => setField("memo", e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>코드</label>
            <textarea aria-label="코드"
              className={inputCls + " min-h-[70px] lg:min-h-[80px] font-mono"}
              value={form.chords}
              onChange={(e) => setField("chords", e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className={labelCls}>가사</label>
          <textarea aria-label="가사"
            className={inputCls + " min-h-[160px] lg:min-h-[280px]"}
            value={form.lyrics}
            onChange={(e) => setField("lyrics", e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}

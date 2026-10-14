import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TokenizerBuilder } from "@patdx/kuromoji";
import NodeLoader from "@patdx/kuromoji/node";
import { analyzeJapanese, parseNumber, numberToKana } from "../src/lyrics/pronunciation/japanese";
import { generatePronunciation, hasUnconverted, isSavablePron } from "../src/lyrics/pronunciation";
import { loadJaTokenizer, maybeGunzip, type JaTokenizer } from "../src/lyrics/pronunciation/tokenizer";
import { anchorOffset, clampOffset, OFFSET_LIMIT_SEC } from "../src/lyrics/lyricOffset";
import { rankCandidates, scoreCandidate } from "../src/lyrics/matching";
import { loanwordMatches } from "../src/lyrics/loanword";
import { titleSimilarityScore, normalizeText } from "../src/lyrics/text";
import { formatLyricsWithTracks, parseLyrics } from "../src/utils/lyrics";

const DICT = join(process.cwd(), "node_modules/@patdx/kuromoji/dict");
// 실제 사전으로 분석한다 (mock 아님)
const tk = (await new TokenizerBuilder({ loader: new NodeLoader({ dic_path: DICT } as never) }).build()) as unknown as JaTokenizer;
const P = (s: string) => analyzeJapanese(s, tk);

test("일본어 발음: 사용자가 보고한 실패 문장(한자 단어 읽기)", () => {
  const cases: Record<string, string> = {
    "少し寂しそうな君に": "스코시 사비시소오나 키미니",
    "手を叩く合図": "테오 타타쿠 아이즈",
    "僕なりの精一杯": "보쿠나리노 세이잇파이",
    "真面目に針を落とす": "마지메니 하리오 오토스",
    "心を揺さぶりすぎて": "코코로오 유사부리스기테",
    "可哀想なふりをして": "카와이소오나 후리오 시테",
    "希望の光は": "키보오노 히카리와",
    "麦わらの帽子の君が": "무기와라노 보오시노 키미가",
    "目の前でずっと輝いている": "메노 마에데 즛토 카가야이테이루",
    "2人の想いが": "후타리노 오모이가",
    "空気": "쿠우키",
    "不思議": "후시기",
    "恋を乗り越えてきた": "코이오 노리코에테키타",
  };
  for (const [src, want] of Object.entries(cases)) {
    const r = P(src);
    assert.equal(r.text, want, src);
    assert.equal(r.status, "ok", src);
    assert.equal(hasUnconverted(r.text), false, src);
  }
});

test("일본어 발음: 단어 단위 읽기 (회귀 목록)", () => {
  const words: Record<string, string> = {
    少し: "스코시", 真面目: "마지메", 青春: "세이슌", 心臓: "신조오", 恋人: "코이비토", 精一杯: "세이잇파이", 可哀想: "카와이소오", 希望: "키보오",
    帽子: "보오시", 空気: "쿠우키", 不思議: "후시기", 輝いている: "카가야이테이루", "2人": "후타리", 一人: "히토리", 君は: "키미와",
  };
  for (const [src, want] of Object.entries(words)) assert.equal(P(src).text, want, src);
});

test("일본어 발음: 조사 は/へ/を 는 문맥(품사)으로만 와/에/오", () => {
  assert.equal(P("私は学校へ行く").text.startsWith("와타시와 갓코오에"), true);
  // 조사가 아닌 は (단어 안) 는 하
  assert.equal(P("花").text, "하나");
  assert.equal(P("はなび").text.startsWith("하"), true);
  assert.equal(P("春").text, "하루");
  assert.equal(P("君を").text, "키미오");
});

test("일본어 발음: 숫자+단위, 외래어, 촉음·요음·장음", () => {
  assert.equal(P("3人で").text, "산닌데");
  assert.equal(P("1人").text, "히토리");
  assert.equal(P("二人").text, "후타리");
  assert.equal(parseNumber("十二"), 12);
  assert.equal(parseNumber("２０"), 20);
  assert.equal(numberToKana(1000), "せん");
  assert.equal(numberToKana(300), "さんびゃく");
  assert.equal(P("ラーメン").text, "라아멘");
  assert.equal(P("きょう").text.length > 0, true);
  assert.equal(P("ありがとう").text, "아리가토오");
});

test("일본어 발음: 일반 문장 (곡과 무관) 에서도 읽기와 단어 경계가 맞다", () => {
  assert.equal(P("今日は学校に行きます").text, "쿄오와 갓코오니 이키마스");
  assert.equal(P("雨が降っている").text, "아메가 훗테이루");
  assert.equal(P("友達と一緒に歌う").text, "토모다치토 잇쇼니 우타우");
});

test("일본어 발음: 읽기가 모호한 한자는 검토 필요로 표시하고 단어를 알려 준다", () => {
  const r = P("今日の人");
  assert.equal(r.status, "review");
  assert.ok(r.uncertain.includes("今日") || r.uncertain.includes("人"));
});

test("일본어 발음: 분석기 없이는 한자 줄을 추정하지 않고 검토 필요 + 원문 유지", () => {
  const [r] = generatePronunciation(["少し寂しそうな君に"]);
  assert.equal(r.status, "unsupported");
  assert.ok((r.failed ?? []).length > 0);
  // 한자가 섞인 채로 저장되는 것을 막는 규칙
  assert.equal(isSavablePron("少시寂시소나키미니"), false);
  assert.equal(isSavablePron("보쿠나리노精一杯"), false);
  assert.equal(isSavablePron("스코시 사비시"), true);
  assert.equal(isSavablePron(""), false);
});

test("일본어 발음: 한자 없는 줄·영어·한국어 줄은 그대로 규칙 처리", () => {
  const rows = generatePronunciation(["君が好きです", "안녕", "[Chorus]"], { tokenizer: tk });
  assert.equal(rows[0].status, "ok");
  assert.equal(rows[1].status, "skipped");
  assert.equal(rows[2].status, "skipped");
});

test("사전 로더: 브라우저 경로(fetch + gzip 해제)로 실제 사전을 불러와 분석한다", async () => {
  const fetchImpl = (async (url: string) => {
    const file = String(url).split("/").pop() as string;
    const buf = readFileSync(join(DICT, file));
    return new Response(new Uint8Array(buf), { status: 200 });
  }) as unknown as typeof fetch;
  let calls = 0;
  const counting = ((u: string) => (calls++, (fetchImpl as unknown as (u: string) => Promise<Response>)(u))) as unknown as typeof fetch;
  const t = await loadJaTokenizer({ fetchImpl: counting, base: "/kuromoji-dict/" });
  assert.equal(analyzeJapanese("空気", t).text, "쿠우키");
  const first = calls;
  const again = await loadJaTokenizer({ fetchImpl: counting, base: "/kuromoji-dict/" });
  assert.equal(again, t); // 중복 로드 없음
  assert.equal(calls, first);
  // 이미 풀려서 온 데이터는 그대로 통과
  const plain = new Uint8Array([1, 2, 3]).buffer;
  assert.equal((await maybeGunzip(plain)).byteLength, 3);
});

test("발음 저장 형식: {발음} 보조 줄로 들어가고 원문/시간은 그대로", () => {
  const text = formatLyricsWithTracks([
    { time: 10, text: "空気", pron: "쿠우키" },
    { time: 12, text: "不思議", pron: undefined },
  ]);
  const lines = parseLyrics(text);
  assert.equal(lines[0].pron, "쿠우키");
  assert.equal(lines[0].time, 10);
  assert.equal(lines[1].pron, undefined);
});

// ------------------------------------------------------------------ 싱크 앵커

test("현재 부분이 싱크 시작: 줄 원래 1:10, 지금 1:25 → 전체 +15초 (절대값이라 다시 맞춰도 겹치지 않는다)", () => {
  assert.equal(anchorOffset(70, 85), 15);
  // 이미 +15 가 적용된 상태에서 같은 줄을 다시 맞춰도 결과는 같다 (줄 시간은 보정 전 원본)
  assert.equal(anchorOffset(70, 85), 15);
  assert.equal(anchorOffset(70, 65.04), -5);
  assert.equal(anchorOffset(null, 10), null);
  assert.equal(anchorOffset(10, undefined), null);
  assert.equal(anchorOffset(10, Number.NaN), null);
  assert.equal(anchorOffset(0, OFFSET_LIMIT_SEC + 5), null); // 한도 초과는 적용하지 않는다
  assert.equal(clampOffset(anchorOffset(70, 85) as number + 0.5), 15.5); // ±0.5 미세조정과 같은 값 위에서 이어진다
});

// ------------------------------------------------------------------ 검색 점수

const mk = (id: string, title: string, artist = "Aimyon", duration = 250) => ({ id, title, artist, source: "t", syncedLyrics: "[00:01.00] a", duration });
const AIMYON = { artists: ["あいみょん", "Aimyon"], titles: [], trusted: true };

test("검색: 같은 가수의 다른 곡이 모두 같은 점수로 나오지 않는다 (번역 제목 ↔ 원제, 외래어 근거)", () => {
  const r = rankCandidates({ title: "너는 록을 듣지 않아", artist: "아이묭" }, [mk("2", "ハルノヒ"), mk("1", "君はロックを聞かない"), mk("3", "マリーゴールド")], AIMYON);
  assert.equal(r[0].id, "1");
  assert.ok(r[0].confidence > r[1].confidence + 0.1);
  assert.equal(r[0].evidence?.title, "loanword");
  assert.equal(r[0].evidence?.artist, "exact");
  assert.equal(r[1].evidence?.title, "unverified");
  // 번역 제목은 같은 곡이라고 단정하지 않는다: 자동 선택 수준(high)이 아니다
  assert.notEqual(r[0].evidence?.level, "high");
});

test("검색: 聞く/聴く 표기 차이는 같은 제목으로 본다", () => {
  assert.equal(normalizeText("君はロックを聴かない"), normalizeText("君はロックを聞かない"));
  assert.equal(titleSimilarityScore("君はロックを聞かない", "君はロックを聴かない"), 1);
});

test("검색: 일본어 제목 저장 곡은 아티스트 별칭 연결로 높은 근거, 같은 가수 다른 곡은 낮은 근거", () => {
  const r = rankCandidates({ title: "君はロックを聞かない", artist: "아이묭" }, [mk("1", "君はロックを聴かない"), mk("2", "ハルノヒ")], AIMYON);
  assert.equal(r[0].id, "1");
  assert.equal(r[0].evidence?.level, "high");
  assert.equal(r[1].evidence?.level, "low");
});

test("검색: 같은 제목 다른 가수는 아티스트로 구분하고 근거에 드러난다", () => {
  const r = rankCandidates({ title: "Flower", artist: "Aimyon" }, [mk("1", "Flower", "Aimyon"), mk("2", "Flower", "Someone Else")]);
  assert.equal(r[0].id, "1");
  assert.equal(r[1].evidence?.artist, "different");
  assert.ok(r[0].confidence - r[1].confidence > 0.25);
});

test("검색: 외래어 일치는 약한 근거(자동 선택 불가), 근거 없으면 0", () => {
  assert.equal(loanwordMatches("너는 록을 듣지 않아", "君はロックを聞かない").length, 1);
  assert.equal(loanwordMatches("너는 록을 듣지 않아", "ハルノヒ").length, 0);
  const s = scoreCandidate({ title: "너는 록을 듣지 않아", artist: "아이묭" }, mk("1", "君はロックを聞かない"), AIMYON);
  assert.ok(s.titleSimilarity < 0.6);
  assert.ok(s.evidence && s.evidence.label.includes("제목 일부 일치"));
});

test("검색: 가수 정보 없는 곡·별칭 없는 곡도 점수가 깨지지 않는다", () => {
  const s = scoreCandidate({ title: "Test Song", artist: "" }, mk("1", "Test Song", "Anyone"));
  assert.equal(s.evidence?.artist, "unknown");
  assert.ok(s.confidence > 0.5);
});

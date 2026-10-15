/**
 * 기본 제공 별칭(다국어 표기) 사전 — 검색용 "씨앗 데이터"다. 모든 곡을 담을 수는 없으므로 확장 구조의 시작점이다.
 * 곡마다 직접 입력하는 별칭(Song.titleAliases / artistAliases)이 이 사전보다 우선하며 함께 쓰인다.
 * 번역기로 만든 값이 아니라 공식/널리 알려진 표기만 넣는다. 틀린 항목은 이 파일에서 고치면 된다.
 */

/** 같은 가수의 서로 다른 표기 묶음 */
export const ARTIST_ALIAS_GROUPS: string[][] = [
  ["아이유", "IU", "이지은", "아이유(IU)"],
  ["방탄소년단", "BTS", "Bangtan Boys", "防弾少年団", "防弾少年団 (BTS)"],
  ["김세정", "Kim Sejeong", "Sejeong"],
  ["블랙핑크", "BLACKPINK", "BLΛƆKPIИK"],
  ["에스파", "aespa"],
  ["뉴진스", "NewJeans"],
  ["악동뮤지션", "AKMU", "Akdong Musician"],
  ["버스커 버스커", "Busker Busker", "버스커버스커"],
  ["십센치", "10cm", "10CM"],
  ["윤하", "Younha", "ユンナ"],
  ["백예린", "Yerin Baek", "Baek Yerin"],
  ["헤이즈", "Heize"],
  ["태연", "Taeyeon", "TAEYEON", "テヨン"],
  ["볼빨간사춘기", "BOL4", "Bolbbalgan4"],
  ["에픽하이", "Epik High"],
  ["레드벨벳", "Red Velvet"],
  ["여자친구", "GFRIEND", "Gfriend"],
  ["잔나비", "JANNABI"],
  ["이무진", "Lee Mujin"],
  ["싸이", "PSY"],
  ["장범준", "Jang Beom June", "Jang Bum Joon"],
  ["요아소비", "YOASOBI", "ヨアソビ"],
  ["요네즈 켄시", "米津玄師", "Kenshi Yonezu", "Yonezu Kenshi", "ハチ"],
  ["우타다 히카루", "宇多田ヒカル", "Utada Hikaru", "Hikaru Utada"],
  ["리사", "LiSA", "リサ"],
  ["히게단", "Official髭男dism", "Official HIGE DANdism", "オフィシャルヒゲダンディズム"],
  ["아이묭", "あいみょん", "Aimyon"],
  ["아도", "Ado", "アド"],
  ["킹누", "King Gnu", "キングヌー"],
  ["스피츠", "スピッツ", "Spitz"],
  ["바운디", "Vaundy", "VAUNDY"],
  ["요루시카", "ヨルシカ", "Yorushika"],
  ["후지이 카제", "藤井風", "Fujii Kaze"],
  ["래드윔프스", "RADWIMPS", "ラッドウィンプス"],
  ["미세스 그린 애플", "Mrs. GREEN APPLE", "ミセスグリーンアップル"],
  ["원 오크 락", "ONE OK ROCK", "ワンオクロック"],
];

/** 같은 곡의 서로 다른 제목 표기 묶음 (artist 가 있으면 그 가수의 곡일 때만 적용 — 동명이곡 오탐 방지) */
export interface TitleAliasEntry {
  titles: string[];
  /** ARTIST_ALIAS_GROUPS 에 있는 아무 표기. 비우면 가수와 상관없이 적용 */
  artist?: string;
}
export const TITLE_ALIAS_ENTRIES: TitleAliasEntry[] = [
  { artist: "아이유", titles: ["이름에게", "Dear Name"] },
  { artist: "아이유", titles: ["밤편지", "Through the Night"] },
  { artist: "아이유", titles: ["좋은 날", "Good Day"] },
  { artist: "아이유", titles: ["블루밍", "Blueming"] },
  { artist: "아이유", titles: ["라일락", "LILAC"] },
  { artist: "아이유", titles: ["에잇", "eight"] },
  { artist: "요아소비", titles: ["밤을 달리다", "夜に駆ける", "Yoru ni Kakeru", "Racing into the Night"] },
  { artist: "요아소비", titles: ["괴물", "怪物", "Kaibutsu", "Monster"] },
  { artist: "요아소비", titles: ["아이돌", "アイドル", "Idol"] },
  { artist: "리사", titles: ["홍련화", "紅蓮華", "Gurenge"] },
  { artist: "요네즈 켄시", titles: ["레몬", "Lemon"] },
  { artist: "히게단", titles: ["Pretender", "프리텐더"] },
];

import { TokenizerBuilder } from "@patdx/kuromoji";
import NL from "@patdx/kuromoji/node";
import { analyzeJapanese } from "./src/lyrics/pronunciation/japanese.ts";
const tk:any = await new TokenizerBuilder({ loader: new NL({ dic_path: "node_modules/@patdx/kuromoji/dict" } as any) }).build();
for (const s of ["こんにちは、世界！","こんばんは","私は今日、君に会いたかった","行かないで…","愛してる〜","どうしてそんなに悲しいの？","何もいらない","ぼくらは歩いていく","君が居なくなって","もう一度だけ","そっと触れたい","夢を見ていたんだ","Hello, 君と","生きてる","三人で","100年後","一日中","ただいま","でも、さよなら","あなたと一緒にいたい","ねぇ","ちゃんと","ラブソングが","今夜はブギー・バック","キミがスキ","笑って","行っちゃう","「ありがとう」","1番好き","ＡＢＣ","もっと","飛び立とう","ワンツー","君と僕とで","街の灯り","思い出す","恋しくて","変わらない"]) {
  const r = analyzeJapanese(s, tk); console.log(s.padEnd(16), "→", r.text, `[${r.status}]`, r.failed.join(","), r.uncertain.join(","));
}

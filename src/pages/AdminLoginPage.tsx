import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { useAuth } from "../hooks/useAuth";

export function AdminLoginPage() {
  const navigate = useNavigate();
  const { login, signup, profile, authError } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signupNotice, setSignupNotice] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      navigate(`/books/${profile.id}`);
    }
  }, [profile, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSignupNotice(null);
    setSubmitting(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        const result = await signup(email, password, name);
        if (result.needsEmailConfirmation) {
          setSignupNotice(
            "가입 확인 메일을 보냈어요. 메일함에서 확인 링크를 눌러주셔야 로그인할 수 있어요."
          );
        } else {
          // 이메일 확인이 꺼져있으면 signUp 직후 바로 세션이 생겨
          // useAuth의 onAuthStateChange가 profile을 채우고 위 useEffect가 자동으로 이동시킨다.
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "요청에 실패했어요.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls =
    "w-full rounded-lg bg-white/[0.06] border border-white/10 px-3 py-2.5 text-[15px] text-white placeholder-white/30 outline-none focus:border-amber-400/50 transition";

  return (
    <div className="max-w-md mx-auto min-h-screen px-5 pt-8">
      <button
        onClick={() => navigate("/")}
        className="p-2 -ml-2 text-white/60"
        aria-label="뒤로가기"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>

      <h1 className="text-xl font-semibold font-serif mt-4">
        관리자 {mode === "login" ? "로그인" : "회원가입"}
      </h1>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        {mode === "signup" && (
          <div>
            <label className="text-xs text-white/45 mb-1.5 block">이름 (노래책 이름으로 표시)</label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
        )}
        <div>
          <label className="text-xs text-white/45 mb-1.5 block">이메일</label>
          <input
            type="email"
            className={inputCls}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="text-xs text-white/45 mb-1.5 block">비밀번호</label>
          <input
            type="password"
            className={inputCls}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />
        </div>

        {signupNotice && (
          <p className="text-[13px] text-amber-300">{signupNotice}</p>
        )}
        {(error || authError) && (
          <p className="text-[13px] text-red-400">{error ?? authError}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 w-full rounded-xl bg-amber-400 text-[#14161F] font-medium py-3 text-[15px] disabled:opacity-50"
        >
          {submitting ? "처리 중..." : mode === "login" ? "로그인" : "회원가입"}
        </button>
      </form>

      <button
        onClick={() => setMode(mode === "login" ? "signup" : "login")}
        className="mt-4 text-[13px] text-white/40 hover:text-white/70"
      >
        {mode === "login" ? "계정이 없으신가요? 회원가입" : "이미 계정이 있으신가요? 로그인"}
      </button>
    </div>
  );
}

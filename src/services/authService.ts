import { supabase, isSupabaseConfigured } from "./supabaseClient";

export const authService = {
  isConfigured: isSupabaseConfigured,

  async signIn(email: string, password: string) {
    if (!supabase) throw new Error("Supabase가 설정되지 않았습니다.");
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data.user;
  },

  async signUp(email: string, password: string, name: string) {
    if (!supabase) throw new Error("Supabase가 설정되지 않았습니다.");
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });
    if (error) throw error;
    // 이메일 확인(Confirm email)이 켜져 있으면 signUp 성공 직후에도
    // session이 null로 온다 — 이 경우 메일 확인 전까지는 로그인이 안 된다.
    const needsEmailConfirmation = !data.session;
    return { user: data.user, needsEmailConfirmation };
  },

  async signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  async getCurrentUserId(): Promise<string | null> {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id ?? null;
  },

  onAuthStateChange(callback: (userId: string | null) => void) {
    if (!supabase) return () => {};
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      callback(session?.user.id ?? null);
    });
    return () => data.subscription.unsubscribe();
  },
};

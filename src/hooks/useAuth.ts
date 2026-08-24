import { useEffect, useState } from "react";
import type { Profile } from "../types/user";
import { authService } from "../services/authService";
import { profileRepository } from "../services/profileRepository";

export function useAuth() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadCurrent(userId: string | null) {
      if (!userId) {
        if (active) {
          setProfile(null);
          setLoading(false);
        }
        return;
      }
      try {
        const p = await profileRepository.getById(userId);
        if (active) {
          setProfile(p);
          setAuthError(null);
          setLoading(false);
        }
      } catch (e) {
        // 로그인(Auth) 자체는 성공했지만 profile 조회가 실패한 경우.
        // 보통 DB에 profiles 테이블이 없거나 스키마 캐시가 안 갱신된 상태.
        if (active) {
          setProfile(null);
          setAuthError(
            e instanceof Error
              ? e.message
              : "사용자 정보를 불러오지 못했어요."
          );
          setLoading(false);
        }
      }
    }

    authService.getCurrentUserId().then(loadCurrent);
    const unsubscribe = authService.onAuthStateChange(loadCurrent);

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function login(email: string, password: string) {
    await authService.signIn(email, password);
  }

  async function signup(email: string, password: string, name: string) {
    return authService.signUp(email, password, name);
  }

  async function logout() {
    await authService.signOut();
    setProfile(null);
  }

  return { profile, loading, authError, login, signup, logout };
}

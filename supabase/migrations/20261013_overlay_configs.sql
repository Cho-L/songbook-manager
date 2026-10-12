-- ============================================================
-- Phase 3: OBS Overlay Studio — 노래책 × 오버레이 종류별 설정 저장
-- 적용 순서: 20261011_song_requests.sql → 20261012_request_queue_v2.sql → (20261012_song_aliases.sql) → 이 파일
--   (이 파일은 앞선 마이그레이션에 의존하지 않고 schema.sql 의 profiles / set_updated_at 만 필요합니다)
-- !! 운영 DB 에는 직접 실행하세요. 자동 적용되지 않습니다. 새 테이블/함수만 추가하며 기존 것은 건드리지 않습니다. 재실행 안전. !!
-- 롤백: 20261013_overlay_configs_rollback.sql (저장된 Studio 설정이 삭제됩니다. 곡/신청 데이터는 영향 없음)
-- ============================================================

create table if not exists public.overlay_configs (
  book_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('song', 'lyrics', 'queue')),
  -- 화면 표시용 설정만 들어간다 (색/크기/표시 여부 등). 비밀값 금지. 값 검증은 앱이 읽을 때 한 번 더 한다.
  config jsonb not null check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 8192),
  rev integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (book_id, kind)
);

create or replace function public.overlay_configs_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.rev = old.rev + 1;
  return new;
end;
$$;

drop trigger if exists overlay_configs_touch on public.overlay_configs;
create trigger overlay_configs_touch
  before update on public.overlay_configs
  for each row execute procedure public.overlay_configs_touch();

-- RLS: 노래책 주인(과 super_admin)만 읽고 쓴다. 익명(OBS 포함)은 테이블을 직접 읽을 수 없고, 아래 RPC(서버=Worker 전용)로만 읽는다.
alter table public.overlay_configs enable row level security;
revoke all on table public.overlay_configs from anon;

drop policy if exists "overlay_configs_owner_all" on public.overlay_configs;
create policy "overlay_configs_owner_all"
  on public.overlay_configs for all
  to authenticated
  using (
    auth.uid() = book_id
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  )
  with check (
    auth.uid() = book_id
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );

-- OBS(로그인 없음)용 공개 조회: 설정 JSON 과 버전만 돌려준다. 없으면 {"config": null}.
create or replace function public.get_public_overlay_config(p_book_id uuid, p_kind text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select jsonb_build_object('config', config, 'rev', rev) from public.overlay_configs where book_id = p_book_id and kind = p_kind),
    jsonb_build_object('config', null, 'rev', 0)
  );
$$;

revoke all on function public.get_public_overlay_config(uuid, text) from public, anon, authenticated;
grant execute on function public.get_public_overlay_config(uuid, text) to service_role;

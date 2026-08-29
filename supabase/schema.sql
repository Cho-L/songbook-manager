-- ============================================================
-- Songbook Manager - Supabase 스키마 + RLS 정책
-- Supabase 대시보드 > SQL Editor 에서 그대로 실행하세요.
-- ============================================================

-- ------------------------------------------------------------
-- 1. profiles 테이블 (Users)
--    Supabase Auth의 auth.users를 확장하는 표준 패턴.
--    role: 'admin' | 'user' (향후 일반 사용자 계정 확장 가능)
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  name text not null,
  role text not null default 'admin' check (role in ('admin', 'user')),
  created_at timestamptz not null default now()
);

-- 회원가입(auth.users insert) 시 profiles 행을 자동 생성하는 트리거.
-- name은 가입 시 signUp options.data.name으로 전달, 없으면 이메일 앞부분 사용.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    'admin'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ------------------------------------------------------------
-- 2. songs 테이블
--    관리자별 테이블을 따로 만들지 않고 owner_id로 분리.
-- ------------------------------------------------------------
create table if not exists public.songs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,

  title text not null,
  artist text not null,
  composer text,
  lyricist text,
  genre text,
  key text,
  bpm integer,
  difficulty integer check (difficulty between 1 and 5),

  lyrics text,
  chords text,
  memo text,
  tags text[] not null default '{}',

  favorite boolean not null default false,
  youtube_video_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists songs_owner_id_idx on public.songs (owner_id);

-- updated_at 자동 갱신 트리거
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists songs_set_updated_at on public.songs;
create trigger songs_set_updated_at
  before update on public.songs
  for each row execute procedure public.set_updated_at();

-- ------------------------------------------------------------
-- 3. RLS 활성화
-- ------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.songs enable row level security;

-- ------------------------------------------------------------
-- 4. profiles 정책
--    - 노래책 선택 화면에서 관리자 목록을 보여줘야 하므로 전체 공개 read
--    - 본인 프로필만 수정 가능
-- ------------------------------------------------------------
drop policy if exists "profiles_public_read" on public.profiles;
create policy "profiles_public_read"
  on public.profiles for select
  using (true);

drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ------------------------------------------------------------
-- 5. songs 정책 (핵심: 서버=DB 레벨 권한 검사)
--    - 조회: 누구나 (로그인 불필요) - 공개 노래책
--    - 추가: 로그인한 본인만, owner_id는 반드시 자기 자신
--    - 수정/삭제: 로그인한 본인 소유 데이터만
-- ------------------------------------------------------------
drop policy if exists "songs_public_read" on public.songs;
create policy "songs_public_read"
  on public.songs for select
  using (true);

drop policy if exists "songs_owner_insert" on public.songs;
create policy "songs_owner_insert"
  on public.songs for insert
  to authenticated
  with check (auth.uid() = owner_id);

drop policy if exists "songs_owner_update" on public.songs;
create policy "songs_owner_update"
  on public.songs for update
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "songs_owner_delete" on public.songs;
create policy "songs_owner_delete"
  on public.songs for delete
  to authenticated
  using (auth.uid() = owner_id);

-- ------------------------------------------------------------
-- 6. favorites 테이블 (Phase 3: 사용자별 독립 즐겨찾기)
--    songs.favorite 컬럼은 과거 호환용으로 남겨두되, 실제 방문자별
--    즐겨찾기는 이 테이블로 관리한다. 로그인한 사용자라면(관리자든
--    아니든) 누구나 자신의 즐겨찾기를 가진다.
-- ------------------------------------------------------------
create table if not exists public.favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, song_id)
);

alter table public.favorites enable row level security;

-- 본인 즐겨찾기만 조회/추가/삭제 가능 (다른 사람 즐겨찾기는 볼 수 없음)
drop policy if exists "favorites_owner_all" on public.favorites;
create policy "favorites_owner_all"
  on public.favorites for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 참고: RLS는 PostgREST(Supabase가 생성하는 API) 레벨에서 강제되므로
-- 프론트엔드가 아니라 "서버(DB)"에서 권한을 검사하는 것과 동일한 효과입니다.
-- 즉, 일반 방문자가 REST API를 직접 호출해도 insert/update/delete는
-- 로그인 + 본인 소유가 아니면 전부 거부됩니다 (지시서 12번 요구사항 충족).
-- ============================================================


-- ============================================================
-- Phase 5 추가분 — Super Admin
-- 기존 테이블/정책은 그대로 두고, 아래만 "추가로" 실행하세요.
-- (이미 실행했다면 다시 실행해도 안전하게 덮어써지도록 작성함)
-- ============================================================

-- 1. profiles.role에 super_admin 허용 (기존 admin/user 값은 그대로 유지됨)
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'user', 'super_admin'));

-- 2. 본인 계정을 super_admin으로 지정 (본인 이메일로 바꿔서 1회 실행)
-- update public.profiles set role = 'super_admin' where email = '본인이메일@example.com';

-- 3. songs 테이블: 기존 소유자 전용 정책(songs_owner_update/delete)은 그대로 두고,
--    super_admin이면 소유자가 아니어도 수정/삭제할 수 있는 정책을 "추가"한다.
--    (Postgres RLS는 같은 명령에 대한 permissive 정책들을 OR로 합치므로,
--     기존 "본인 소유" 정책과 이 정책 중 하나만 만족해도 허용된다.)
drop policy if exists "songs_super_admin_update" on public.songs;
create policy "songs_super_admin_update"
  on public.songs for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'super_admin'
    )
  )
  with check (true);

drop policy if exists "songs_super_admin_delete" on public.songs;
create policy "songs_super_admin_delete"
  on public.songs for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'super_admin'
    )
  );
-- ============================================================


-- ============================================================
-- Phase 7 추가분 — 플레이리스트
-- 기존 테이블/정책은 그대로 두고, 아래만 "추가로" 실행하세요.
-- ============================================================

create table if not exists public.playlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.playlist_songs (
  playlist_id uuid not null references public.playlists (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  position integer not null,
  created_at timestamptz not null default now(),
  primary key (playlist_id, song_id)
);

create index if not exists playlists_owner_id_idx on public.playlists (owner_id);
create index if not exists playlist_songs_playlist_id_idx on public.playlist_songs (playlist_id);

alter table public.playlists enable row level security;
alter table public.playlist_songs enable row level security;

-- 노래책처럼 플레이리스트도 공개 조회, 관리는 소유자 또는 super_admin만
drop policy if exists "playlists_public_read" on public.playlists;
create policy "playlists_public_read" on public.playlists for select using (true);

drop policy if exists "playlists_owner_write" on public.playlists;
create policy "playlists_owner_write" on public.playlists for all
  to authenticated
  using (
    auth.uid() = owner_id
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  )
  with check (
    auth.uid() = owner_id
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );

drop policy if exists "playlist_songs_public_read" on public.playlist_songs;
create policy "playlist_songs_public_read" on public.playlist_songs for select using (true);

-- playlist_songs는 자신이 owner인 playlist에 한해서만 추가/삭제 가능
drop policy if exists "playlist_songs_owner_write" on public.playlist_songs;
create policy "playlist_songs_owner_write" on public.playlist_songs for all
  to authenticated
  using (
    exists (
      select 1 from public.playlists p
      where p.id = playlist_songs.playlist_id
        and (
          p.owner_id = auth.uid()
          or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
        )
    )
  )
  with check (
    exists (
      select 1 from public.playlists p
      where p.id = playlist_songs.playlist_id
        and (
          p.owner_id = auth.uid()
          or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
        )
    )
  );
-- ============================================================


-- ============================================================
-- Phase 8 추가분 — 사용자별 개인화 설정
-- 기존 테이블/정책은 그대로 두고, 아래만 "추가로" 실행하세요.
-- ============================================================

create table if not exists public.user_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  lyrics_font_size text not null default 'md' check (lyrics_font_size in ('sm','md','lg','xl')),
  chords_font_size text not null default 'md' check (chords_font_size in ('sm','md','lg','xl')),
  font_family text not null default 'system' check (font_family in ('system','serif','mono')),
  lyrics_color text not null default '#f2f0ea',
  chords_color text not null default '#6ee7b7',
  background_color text not null default '#000000',
  theme text not null default 'dark' check (theme in ('dark','light')),
  page_size integer not null default 30 check (page_size in (20,30,50)),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

-- 본인 설정만 조회/수정 가능 (다른 사람 설정은 완전히 비공개 — 노래책과 달리 공개 조회 아님)
drop policy if exists "user_preferences_owner_all" on public.user_preferences;
create policy "user_preferences_owner_all"
  on public.user_preferences for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists user_preferences_set_updated_at on public.user_preferences;
create trigger user_preferences_set_updated_at
  before update on public.user_preferences
  for each row execute procedure public.set_updated_at();
-- ============================================================


-- ============================================================
-- Phase 9 추가분 — 노래책 디자인 설정
-- 기존 테이블/정책은 그대로 두고, 아래만 "추가로" 실행하세요.
--
-- user_preferences(Phase 8)와 다른 개념: 이건 "노래책 자체"의 디자인이라
-- 누가 보든(로그인 여부/누구 개인 설정과 무관) 동일하게 보여야 하므로
-- 공개 조회(select true) + 소유자/super_admin만 쓰기, 로 설계한다.
-- (user_preferences는 반대로 본인만 조회 가능한 비공개 설정이었음)
-- ============================================================

create table if not exists public.book_designs (
  owner_id uuid primary key references public.profiles (id) on delete cascade,
  preset text not null default 'default' check (preset in ('default','light','dark','minimal','modern')),
  accent_color text not null default '#fbbf24',
  background_color text not null default '#14161F',
  surface_color text not null default '#ffffff',
  text_color text not null default '#f2f0ea',
  title text,
  description text,
  song_display text not null default 'list' check (song_display in ('list','card')),
  updated_at timestamptz not null default now()
);

alter table public.book_designs enable row level security;

-- 노래책 디자인은 songs/profiles처럼 누구나 조회 가능 (공개 노래책이니까)
drop policy if exists "book_designs_public_read" on public.book_designs;
create policy "book_designs_public_read"
  on public.book_designs for select
  using (true);

-- 수정은 노래책 소유자 본인이거나 super_admin만
drop policy if exists "book_designs_owner_write" on public.book_designs;
create policy "book_designs_owner_write"
  on public.book_designs for all
  to authenticated
  using (
    auth.uid() = owner_id
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  )
  with check (
    auth.uid() = owner_id
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );

drop trigger if exists book_designs_set_updated_at on public.book_designs;
create trigger book_designs_set_updated_at
  before update on public.book_designs
  for each row execute procedure public.set_updated_at();
-- ============================================================

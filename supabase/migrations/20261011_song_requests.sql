-- ============================================================
-- 2단계: 웹 신청곡 + 관리자 대기열
-- !! 운영 DB에는 docs/song-requests-deploy.md 의 절차대로 직접 실행하세요. 이 파일은 자동으로 적용되지 않습니다. !!
-- 기존 테이블/정책은 수정하지 않고 "추가"만 합니다. 여러 번 실행해도 안전합니다(idempotent).
-- 롤백: supabase/migrations/20261011_song_requests_rollback.sql
-- ============================================================

-- 1) 노래책(=관리자)별 신청 접수 설정. 행이 없으면 "접수 안 함".
create table if not exists public.song_request_settings (
  book_id uuid primary key references public.profiles (id) on delete cascade,
  accepting boolean not null default false,
  max_queue integer not null default 30 check (max_queue between 1 and 200),      -- 대기+승인 합계 상한
  per_user_max integer not null default 2 check (per_user_max between 1 and 10),  -- 시청자 1명이 동시에 올려둘 수 있는 수
  updated_at timestamptz not null default now()
);

-- 2) 신청곡 큐 (플랫폼 공통 구조: 이후 단계의 채팅 신청도 source 만 다르게 같은 테이블을 씁니다)
create table if not exists public.song_requests (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.profiles (id) on delete cascade,
  song_id uuid references public.songs (id) on delete set null,
  -- 곡 정보 사본: 노래가 나중에 지워져도 기록이 남는다
  title text not null check (char_length(title) between 1 and 200),
  artist text not null default '' check (char_length(artist) <= 200),
  requester_name text not null check (char_length(requester_name) between 1 and 30),
  -- 신청자 식별용 해시(서버가 IP+노래책+비밀 salt 로 만든 SHA-256 hex). 원본 IP 는 저장하지 않는다.
  requester_key text not null check (requester_key ~ '^[0-9a-f]{64}$'),
  source text not null default 'web' check (source in ('web', 'chzzk', 'soop', 'admin')),
  platform_user_id text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'playing', 'done', 'rejected', 'canceled')),
  position integer not null default 0,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  done_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists song_requests_book_status_idx on public.song_requests (book_id, status, position);
create index if not exists song_requests_key_idx on public.song_requests (book_id, requester_key, requested_at desc);
-- 같은 곡이 큐(대기/승인/재생중)에 이미 있으면 또 들어갈 수 없다 (RPC 검사의 최후 방어선)
create unique index if not exists song_requests_active_song_uidx
  on public.song_requests (book_id, song_id)
  where song_id is not null and status in ('pending', 'approved', 'playing');

create or replace function public.song_requests_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  if new.status is distinct from old.status then
    if new.status in ('approved', 'playing') and new.approved_at is null then new.approved_at = now(); end if;
    if new.status in ('done', 'rejected', 'canceled') then new.done_at = now(); end if;
  end if;
  return new;
end;
$$;

drop trigger if exists song_requests_touch on public.song_requests;
create trigger song_requests_touch
  before update on public.song_requests
  for each row execute procedure public.song_requests_touch();

drop trigger if exists song_request_settings_set_updated_at on public.song_request_settings;
create trigger song_request_settings_set_updated_at
  before update on public.song_request_settings
  for each row execute procedure public.set_updated_at();

-- 3) RLS: 익명(anon)에게는 정책을 하나도 주지 않는다 = 이 두 테이블을 REST 로 읽고 쓸 수 없다.
--    시청자는 아래 RPC(서버=Worker 만 호출 가능)로만 신청/조회한다.
alter table public.song_request_settings enable row level security;
alter table public.song_requests enable row level security;
revoke all on table public.song_request_settings from anon;
revoke all on table public.song_requests from anon;

drop policy if exists "song_request_settings_owner_all" on public.song_request_settings;
create policy "song_request_settings_owner_all"
  on public.song_request_settings for all
  to authenticated
  using (
    auth.uid() = book_id
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  )
  with check (
    auth.uid() = book_id
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );

drop policy if exists "song_requests_owner_all" on public.song_requests;
create policy "song_requests_owner_all"
  on public.song_requests for all
  to authenticated
  using (
    auth.uid() = book_id
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  )
  with check (
    auth.uid() = book_id
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );

-- 4) 신청 접수 RPC — 검증/중복/도배 방지를 DB 안에서 한 트랜잭션으로 수행 (노래책별 advisory lock 으로 동시 요청도 순서대로)
--    결과: {ok:true,id,position} 또는 {ok:false,code:...}
create or replace function public.submit_song_request(
  p_book_id uuid,
  p_song_id uuid,
  p_name text,
  p_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  song_row record;
  clean_name text;
  new_pos integer;
  new_id uuid;
begin
  if p_book_id is null or p_song_id is null or p_key is null or p_key !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'bad_request');
  end if;

  clean_name := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  if char_length(clean_name) < 1 or char_length(clean_name) > 30 or clean_name ~ '[[:cntrl:]]' then
    return jsonb_build_object('ok', false, 'code', 'bad_name');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_book_id::text, 0));

  select * into s from public.song_request_settings where book_id = p_book_id;
  if not found or not s.accepting then
    return jsonb_build_object('ok', false, 'code', 'closed');
  end if;

  -- 이 노래책에 실제로 있는 곡만 신청할 수 있다
  select id, title, artist into song_row from public.songs where id = p_song_id and owner_id = p_book_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'song_not_found');
  end if;

  -- 도배: 같은 사람은 20초에 1번, 1시간에 10번까지
  if exists (select 1 from public.song_requests
             where book_id = p_book_id and requester_key = p_key and requested_at > now() - interval '20 seconds') then
    return jsonb_build_object('ok', false, 'code', 'cooldown');
  end if;
  if (select count(*) from public.song_requests
      where book_id = p_book_id and requester_key = p_key and requested_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;

  -- 중복: 같은 곡이 이미 큐에 있으면 거절
  if exists (select 1 from public.song_requests
             where book_id = p_book_id and song_id = p_song_id and status in ('pending', 'approved', 'playing')) then
    return jsonb_build_object('ok', false, 'code', 'duplicate_song');
  end if;

  if (select count(*) from public.song_requests
      where book_id = p_book_id and requester_key = p_key and status in ('pending', 'approved')) >= s.per_user_max then
    return jsonb_build_object('ok', false, 'code', 'user_limit');
  end if;

  if (select count(*) from public.song_requests
      where book_id = p_book_id and status in ('pending', 'approved')) >= s.max_queue then
    return jsonb_build_object('ok', false, 'code', 'queue_full');
  end if;

  select coalesce(max(position), 0) + 1 into new_pos from public.song_requests where book_id = p_book_id;

  insert into public.song_requests (book_id, song_id, title, artist, requester_name, requester_key, source, status, position)
  values (p_book_id, p_song_id, song_row.title, coalesce(song_row.artist, ''), clean_name, p_key, 'web', 'pending', new_pos)
  returning id into new_id;

  return jsonb_build_object('ok', true, 'id', new_id, 'position', new_pos);
end;
$$;

-- 5) 시청자용 공개 큐 조회 RPC: 승인/재생 중인 곡의 제목·가수·신청자 표시명만 돌려준다 (해시/플랫폼 id 등은 절대 포함하지 않음)
create or replace function public.get_public_request_queue(p_book_id uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'accepting', coalesce((select accepting from public.song_request_settings where book_id = p_book_id), false),
    'pendingCount', (select count(*) from public.song_requests where book_id = p_book_id and status = 'pending'),
    'queue', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'artist', artist, 'requesterName', requester_name, 'status', status)
                       order by (status = 'playing') desc, position, requested_at)
      from public.song_requests
      where book_id = p_book_id and status in ('approved', 'playing')
    ), '[]'::jsonb)
  );
$$;

-- 6) RPC 는 서버(service_role)만 실행할 수 있다. 브라우저(anon/authenticated)가 직접 부르면 거부된다.
revoke all on function public.submit_song_request(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_public_request_queue(uuid) from public, anon, authenticated;
grant execute on function public.submit_song_request(uuid, uuid, text, text) to service_role;
grant execute on function public.get_public_request_queue(uuid) to service_role;

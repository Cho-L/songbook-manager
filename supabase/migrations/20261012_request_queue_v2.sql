-- ============================================================
-- 2단계 보강: 신청 대기 상태 공개 + 재생 시작 원자화 + OBS 대기열
-- !! 운영 DB 에는 20261011_song_requests.sql 적용 후, docs/song-requests-deploy.md 순서대로 직접 실행하세요. 자동 적용되지 않습니다. !!
-- 추가/교체만 합니다(테이블 구조 변경 없음). 여러 번 실행해도 안전합니다.
-- 롤백: 20261012_request_queue_v2_rollback.sql
-- ============================================================

-- 1) 공개 큐 조회 확장: 항목에 songId, 최상위에 pendingSongIds(확인 대기 중인 곡 id 목록) 추가.
--    기존 필드는 그대로라서 옛 프론트/Worker 와 호환된다. 신청자 이름·해시는 pending 쪽에 절대 노출하지 않는다.
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
    'pendingSongIds', coalesce((
      select jsonb_agg(song_id) from public.song_requests
      where book_id = p_book_id and status = 'pending' and song_id is not null
    ), '[]'::jsonb),
    'queue', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'songId', song_id, 'title', title, 'artist', artist, 'requesterName', requester_name, 'status', status)
                       order by (status = 'playing') desc, position, requested_at)
      from public.song_requests
      where book_id = p_book_id and status in ('approved', 'playing')
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.get_public_request_queue(uuid) from public, anon, authenticated;
grant execute on function public.get_public_request_queue(uuid) to service_role;

-- 2) 재생 시작을 한 트랜잭션으로: 기존 재생 중 곡은 완료 처리 + 선택한 곡을 재생 중으로.
--    SECURITY INVOKER(기본) 이므로 RLS 가 그대로 적용된다 = 자기 노래책의 신청만 바꿀 수 있다.
--    approved 상태인 곡만 시작할 수 있고, 그렇지 않으면 false (이미 다른 화면에서 처리됨).
create or replace function public.start_song_request(p_id uuid)
returns boolean
language plpgsql
as $$
declare
  b uuid;
  n integer;
begin
  select book_id into b from public.song_requests where id = p_id and status in ('approved', 'playing');
  if b is null then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(b::text, 1));
  update public.song_requests set status = 'done' where book_id = b and status = 'playing' and id <> p_id;
  update public.song_requests set status = 'playing' where id = p_id and status in ('approved', 'playing');
  get diagnostics n = row_count;
  return n = 1;
end;
$$;
revoke all on function public.start_song_request(uuid) from public, anon;
grant execute on function public.start_song_request(uuid) to authenticated;

-- 3) 노래책당 "재생 중"은 최대 1곡 (최후 방어선). 이미 2곡 이상이면 가장 최근 것만 남기고 나머지는 완료 처리한 뒤 만든다.
update public.song_requests r set status = 'done'
 where status = 'playing'
   and exists (select 1 from public.song_requests o
               where o.book_id = r.book_id and o.status = 'playing'
                 and (o.updated_at, o.id) > (r.updated_at, r.id));
create unique index if not exists song_requests_one_playing_uidx
  on public.song_requests (book_id) where status = 'playing';

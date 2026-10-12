drop index if exists public.song_requests_one_playing_uidx;
drop function if exists public.start_song_request(uuid);
-- 공개 큐 조회를 20261011 버전(songId/pendingSongIds 없음)으로 되돌린다
create or replace function public.get_public_request_queue(p_book_id uuid)
returns jsonb language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'accepting', coalesce((select accepting from public.song_request_settings where book_id = p_book_id), false),
    'pendingCount', (select count(*) from public.song_requests where book_id = p_book_id and status = 'pending'),
    'queue', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'artist', artist, 'requesterName', requester_name, 'status', status)
                       order by (status = 'playing') desc, position, requested_at)
      from public.song_requests where book_id = p_book_id and status in ('approved', 'playing')
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.get_public_request_queue(uuid) from public, anon, authenticated;
grant execute on function public.get_public_request_queue(uuid) to service_role;

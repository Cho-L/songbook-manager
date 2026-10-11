-- 2단계 롤백: 신청곡 데이터가 모두 삭제됩니다. 기존 songs/profiles 등은 영향 없음.
drop function if exists public.submit_song_request(uuid, uuid, text, text);
drop function if exists public.get_public_request_queue(uuid);
drop table if exists public.song_requests;
drop table if exists public.song_request_settings;
drop function if exists public.song_requests_touch();

-- 곡 제목/가수 별칭 (다국어 검색용). 추가 전용, 기존 데이터 영향 없음. 운영 적용은 별도 승인 후.
alter table public.songs add column if not exists title_aliases text[] not null default '{}';
alter table public.songs add column if not exists artist_aliases text[] not null default '{}';

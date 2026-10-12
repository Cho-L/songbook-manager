-- 저장된 Overlay Studio 설정이 모두 삭제됩니다 (앱은 URL 설정/기본값으로 계속 동작).
drop function if exists public.get_public_overlay_config(uuid, text);
drop table if exists public.overlay_configs;
drop function if exists public.overlay_configs_touch();

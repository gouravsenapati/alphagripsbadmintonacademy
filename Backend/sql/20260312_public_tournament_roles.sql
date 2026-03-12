select setval(
  'public.roles_id_seq',
  coalesce((select max(id) from public.roles), 0) + 1,
  false
);

insert into public.roles (name)
select seed.role_name
from (
  values
    ('tournament_admin'),
    ('tournament_manager'),
    ('tournament_staff'),
    ('referee'),
    ('tournament_referee'),
    ('court_official')
) as seed(role_name)
where not exists (
  select 1
  from public.roles existing
  where lower(existing.name) = lower(seed.role_name)
);

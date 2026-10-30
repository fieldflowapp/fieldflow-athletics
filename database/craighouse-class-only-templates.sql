alter table public.athletics_events add column if not exists class_only boolean not null default false;
comment on column public.athletics_events.class_only is 'Class Mode template; excluded from official event selectors. Athlete category and gender are selected per class activity.';

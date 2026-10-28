-- Class high jump follows the school's Competition Mode: pass first only,
-- O closes a height, XXX at one height eliminates. Official tables are untouched.
create table public.athletics_class_hj_heights(
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references public.athletics_class_sessions(id),
 height_m numeric not null check(height_m>=0.5 and height_m<=3 and height_m=round(height_m,2)),
 sequence_no integer not null check(sequence_no>0),
 unique(session_id,height_m),unique(session_id,sequence_no)
);
create table public.athletics_class_hj_cards(
 session_id uuid not null references public.athletics_class_sessions(id),
 athlete_id uuid not null references public.athletics_athletes(id),
 trials jsonb not null default '{}'::jsonb,
 version integer not null default 1,
 mark_attempt integer not null,
 best_height numeric,
 primary key(session_id,athlete_id)
);
create index class_hj_cards_athlete on public.athletics_class_hj_cards(athlete_id);
alter table public.athletics_class_hj_heights enable row level security;
alter table public.athletics_class_hj_cards enable row level security;
create policy class_hj_heights_admin on public.athletics_class_hj_heights for all to authenticated
 using(exists(select 1 from public.athletics_class_sessions s where s.id=session_id and public.is_athletics_admin(s.tournament_id)))
 with check(exists(select 1 from public.athletics_class_sessions s where s.id=session_id and public.is_athletics_admin(s.tournament_id)));
create policy class_hj_cards_admin on public.athletics_class_hj_cards for all to authenticated
 using(exists(select 1 from public.athletics_class_sessions s where s.id=session_id and public.is_athletics_admin(s.tournament_id)))
 with check(exists(select 1 from public.athletics_class_sessions s where s.id=session_id and public.is_athletics_admin(s.tournament_id)));
revoke all on public.athletics_class_hj_heights,public.athletics_class_hj_cards from public,anon,authenticated;
grant select,insert on public.athletics_class_hj_heights,public.athletics_class_hj_cards to authenticated;
grant update(trials) on public.athletics_class_hj_cards to authenticated;

create function public.athletics_class_hj_guard() returns trigger language plpgsql security invoker set search_path=public as $$
declare h athletics_class_hj_heights; r jsonb; i integer; ended boolean; eliminated boolean:=false; v text; pair record;
begin
 perform athletics_class_lock(new.session_id);
 if not exists(select 1 from athletics_class_sessions s join athletics_events e on e.id=s.template_event_id where s.id=new.session_id and s.attendance_recorded and e.code='HJ') then raise exception 'Save attendance for a High Jump event first';end if;
 if tg_table_name='athletics_class_hj_heights' then
  if new.height_m<=coalesce((select max(height_m) from athletics_class_hj_heights where session_id=new.session_id),0) then raise exception 'New height must be higher than the previous height';end if;
  new.sequence_no:=coalesce((select max(sequence_no) from athletics_class_hj_heights where session_id=new.session_id),0)+1;
  return new;
 end if;
 if not exists(select 1 from athletics_class_attendance where session_id=new.session_id and athlete_id=new.athlete_id and present) then raise exception 'Athlete must have attendance for this event';end if;
 if jsonb_typeof(new.trials)<>'object' or octet_length(new.trials::text)>50000 then raise exception 'Invalid attempt sheet';end if;
 for pair in select * from jsonb_each(new.trials) loop
  if not exists(select 1 from athletics_class_hj_heights where session_id=new.session_id and id::text=pair.key) then raise exception 'Height does not belong to this event';end if;
 end loop;
 new.best_height:=null;
 for h in select * from athletics_class_hj_heights where session_id=new.session_id order by sequence_no loop
  r:=new.trials->h.id::text;
  if r is null then continue;end if;
  if jsonb_typeof(r)<>'array' or jsonb_array_length(r)<>3 then raise exception 'Each height needs three attempt slots';end if;
  ended:=false;
  for i in 0..2 loop
   v:=r->>i;
   if v is null or jsonb_typeof(r->i)<>'string' or v not in ('','O','X','-') then raise exception 'Use O, X or -';end if;
   if v='' then continue;end if;
   if eliminated then raise exception 'There are results after elimination. Correct those heights first.';end if;
   if ended then raise exception 'No attempts after a clear or pass';end if;
   if i>0 and r->>(i-1)<>'X' then raise exception 'Record the previous miss before the next attempt';end if;
   if v='-' and i<>0 then raise exception 'Pass is allowed only on the first attempt';end if;
   if v in ('O','-') then ended:=true;end if;
   if v='O' then new.best_height:=greatest(new.best_height,h.height_m);end if;
  end loop;
  if r='["X","X","X"]'::jsonb then eliminated:=true;end if;
 end loop;
 if tg_op='INSERT' then
  new.version:=1;
  select coalesce(max(attempt_no),0)+1 into new.mark_attempt from athletics_class_marks where session_id=new.session_id and athlete_id=new.athlete_id;
 else new.version:=old.version+1;new.mark_attempt:=old.mark_attempt;end if;
 return new;
end $$;
revoke all on function public.athletics_class_hj_guard() from public,anon;
create trigger class_hj_height_guard before insert on public.athletics_class_hj_heights for each row execute function public.athletics_class_hj_guard();
create trigger class_hj_card_guard before insert or update on public.athletics_class_hj_cards for each row execute function public.athletics_class_hj_guard();

create function public.athletics_class_hj_sync_best() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 perform athletics_save_class_marks(new.session_id,new.mark_attempt,jsonb_build_array(jsonb_build_object(
 'athlete_id',new.athlete_id,'mark',new.best_height,
 'status',case when new.best_height is not null then 'valid' when new.trials::text like '%"X"%' then 'foul' else 'pass' end,
 'notes','High jump · best cleared height · attempts retained in event sheet','timing_method','not_applicable')));
 return new;
end $$;
revoke all on function public.athletics_class_hj_sync_best() from public,anon;
create trigger class_hj_sync_best after insert or update on public.athletics_class_hj_cards for each row execute function public.athletics_class_hj_sync_best();

create function public.athletics_save_class_hj(p_session_id uuid,p_athlete_id uuid,p_trials jsonb,p_version integer)
returns public.athletics_class_hj_cards language plpgsql security invoker set search_path=public as $$
declare saved athletics_class_hj_cards;
begin
 perform athletics_class_lock(p_session_id);
 select * into saved from athletics_class_hj_cards where session_id=p_session_id and athlete_id=p_athlete_id;
 if coalesce(saved.version,0) is distinct from p_version then raise exception 'High jump was changed on another device. Refresh before editing.';end if;
 if saved.session_id is null then
  insert into athletics_class_hj_cards(session_id,athlete_id,trials,mark_attempt) values(p_session_id,p_athlete_id,p_trials,1) returning * into saved;
 else update athletics_class_hj_cards set trials=p_trials where session_id=p_session_id and athlete_id=p_athlete_id returning * into saved;end if;
 return saved;
end $$;
revoke all on function public.athletics_save_class_hj(uuid,uuid,jsonb,integer) from public,anon;
grant execute on function public.athletics_save_class_hj(uuid,uuid,jsonb,integer) to authenticated;

-- The derived history record can only agree with the saved attempt sheet,
-- including when an old browser still shows the generic field editor.
create function public.athletics_class_hj_best_guard() returns trigger language plpgsql security invoker set search_path=public as $$
declare c athletics_class_hj_cards; expected_status text;
begin
 perform athletics_class_lock(new.session_id);
 select * into c from athletics_class_hj_cards where session_id=new.session_id and athlete_id=new.athlete_id and mark_attempt=new.attempt_no;
 if found then
  expected_status:=case when c.best_height is not null then 'valid' when c.trials::text like '%"X"%' then 'foul' else 'pass' end;
  if new.mark is distinct from c.best_height or new.status<>expected_status then raise exception 'Edit the high jump attempt sheet; the best height is calculated automatically';end if;
 end if;
 return new;
end $$;
revoke all on function public.athletics_class_hj_best_guard() from public,anon;
create trigger class_hj_best_guard before insert or update on public.athletics_class_marks for each row execute function public.athletics_class_hj_best_guard();

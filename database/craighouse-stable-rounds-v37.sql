-- Stable class series across rounds. Existing heats, entries and marks stay unchanged.
create or replace function public.athletics_generate_class_heats(p_session_id uuid,p_mode text default 'mixed',p_capacity integer default 8,p_heat_count integer default 0,p_athletes uuid[] default null)
returns setof public.athletics_class_heats language plpgsql security invoker set search_path=public as $$
declare s athletics_class_sessions; r integer; g text; ids uuid[]; n integer; c integer; h uuid; j integer; k integer; heatno integer:=0; first_round integer; latest_round integer; base record; runner record; original record; mixed boolean; target_number integer; target_lane integer;
begin
 perform athletics_class_lock(p_session_id);
 select * into s from athletics_class_sessions where id=p_session_id;
 if s.id is null or not is_athletics_admin(s.tournament_id) then raise exception 'Not authorized'; end if;
 if not s.attendance_recorded then raise exception 'Save attendance first'; end if;
 if not exists(select 1 from athletics_events where id=s.template_event_id and discipline='track') then raise exception 'Individual track events only'; end if;
 if p_mode is null or p_mode not in ('mixed','gender') or p_capacity is null or p_capacity<1 or p_capacity>1000 or p_heat_count is null or p_heat_count<0 then raise exception 'Invalid series settings'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_session_id::text,0));
 select greatest(coalesce((select max(round_no) from athletics_class_heats where session_id=p_session_id),0),coalesce((select max(attempt_no) from athletics_class_marks where session_id=p_session_id),0))+1 into r;
 if p_athletes is not null and (cardinality(p_athletes)=0 or array_position(p_athletes,null) is not null or exists(select 1 from unnest(p_athletes) x(id) where not exists(select 1 from athletics_class_attendance att where att.session_id=p_session_id and att.athlete_id=x.id and att.present and att.available))) then raise exception 'Select available participants for this round';end if;
 -- Subsequent rounds retain the original series, gender and lane assignments.
 select min(round_no),max(round_no) into first_round,latest_round from athletics_class_heats where session_id=p_session_id;
 if first_round is not null then
  select exists(select 1 from athletics_class_heats where session_id=p_session_id and round_no=first_round and gender='All') into mixed;
  if not exists(select 1 from athletics_class_attendance att join athletics_athletes ath on ath.id=att.athlete_id where att.session_id=p_session_id and att.present and att.available and ath.active and (p_athletes is null or ath.id=any(p_athletes))) then raise exception 'Select at least one present athlete';end if;
  -- Copy shells, including empty series, to keep numbering stable across rounds.
  for base in select distinct on(heat_number) heat_number,gender from athletics_class_heats where session_id=p_session_id and round_no<r order by heat_number,round_no loop
   insert into athletics_class_heats(session_id,round_no,heat_number,gender) values(p_session_id,r,base.heat_number,base.gender);
  end loop;
  for runner in select ath.id,ath.gender from athletics_class_attendance att join athletics_athletes ath on ath.id=att.athlete_id where att.session_id=p_session_id and att.present and att.available and ath.active and (p_athletes is null or ath.id=any(p_athletes)) order by ath.last_name,ath.first_name,ath.id loop
   select oldheat.heat_number,entry.lane into original from athletics_class_heat_entries entry join athletics_class_heats oldheat on oldheat.id=entry.heat_id where entry.session_id=p_session_id and entry.athlete_id=runner.id and entry.round_no<r order by entry.round_no limit 1;
   if found then
    target_number:=original.heat_number;target_lane:=original.lane;
   else
    select max(heat_number) into target_number from athletics_class_heats where session_id=p_session_id and round_no=r and (case when mixed then gender='All' else gender=runner.gender end);
    if target_number is null then
     -- First arrival of a gender that had no participants in round one.
     select coalesce(max(heat_number),0)+1 into target_number from athletics_class_heats where session_id=p_session_id and round_no=r;
     insert into athletics_class_heats(session_id,round_no,heat_number,gender) values(p_session_id,r,target_number,case when mixed then 'All' else runner.gender end);
    end if;
    select coalesce(max(entry.lane),0)+1 into target_lane from athletics_class_heat_entries entry join athletics_class_heats oldheat on oldheat.id=entry.heat_id where entry.session_id=p_session_id and oldheat.heat_number=target_number;
   end if;
   select id into h from athletics_class_heats where session_id=p_session_id and round_no=r and heat_number=target_number;
   insert into athletics_class_heat_entries(heat_id,session_id,round_no,athlete_id,lane) values(h,p_session_id,r,runner.id,target_lane);
  end loop;
  return query select * from athletics_class_heats where session_id=p_session_id and round_no=r order by heat_number;
  return;
 end if;
 for g in select unnest(case when p_mode='mixed' then array[s.gender] else case when s.gender='All' then array['F','M'] else array[s.gender] end end) loop
  select array_agg(a.id order by random()) into ids from athletics_class_attendance att join athletics_athletes a on a.id=att.athlete_id where att.session_id=p_session_id and att.present and att.available and a.active and (p_athletes is null or a.id=any(p_athletes)) and (g='All' or a.gender=g);
  n:=coalesce(cardinality(ids),0);if n=0 then continue;end if;
  c:=case when p_heat_count=0 then ceil(n::numeric/p_capacity)::integer else p_heat_count end;
  if c>n or c*p_capacity<n then raise exception 'Choose enough series for the capacity, without creating empty series'; end if;
  for j in 1..c loop
   heatno:=heatno+1;
   insert into athletics_class_heats(session_id,round_no,heat_number,gender) values(p_session_id,r,heatno,g) returning id into h;
   k:=0;
   for i in 1..n loop
    if (i-1)%c=j-1 then k:=k+1;insert into athletics_class_heat_entries(heat_id,session_id,round_no,athlete_id,lane) values(h,p_session_id,r,ids[i],k);end if;
   end loop;
  end loop;
 end loop;
 if heatno=0 then raise exception 'Select at least one present athlete'; end if;
 return query select * from athletics_class_heats where session_id=p_session_id and round_no=r order by heat_number;
end $$;
revoke all on function public.athletics_generate_class_heats(uuid,text,integer,integer,uuid[]) from public,anon;
grant execute on function public.athletics_generate_class_heats(uuid,text,integer,integer,uuid[]) to authenticated;


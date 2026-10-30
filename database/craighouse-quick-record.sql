-- Atomic manual import. Client request UUID makes retries safe, without inventing attempts.
alter table public.athletics_class_sessions add column quick_payload jsonb;
create function public.athletics_quick_record(p_id uuid,p_event uuid,p_date date,p_source text,p_rows jsonb,p_notes text default '',p_conditions text default '',p_weight numeric default null)
returns uuid language plpgsql security invoker set search_path=public as $$
declare e athletics_events; s athletics_class_sessions; ids uuid[]; levels text[]; genders text[]; payload jsonb; r jsonb; team uuid; ordinal integer:=0;
begin
 select * into e from athletics_events where id=p_event;
 if auth.uid() is null or e.id is null or not is_athletics_admin(e.tournament_id) then raise exception 'Not authorized';end if;
 if p_id is null or p_date is null or p_source is null or p_source not in ('class','training','external') or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 200 then raise exception 'Choose date, source and 1–200 marks';end if;
 payload:=jsonb_build_object('event',p_event,'date',p_date,'source',p_source,'rows',p_rows,'notes',p_notes,'conditions',p_conditions,'weight',p_weight);
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,47));
 select * into s from athletics_class_sessions where id=p_id;
 if s.id is not null then
  if s.created_by=auth.uid() and s.quick_payload=payload then return s.id;end if;
  raise exception 'This request was already saved with different data. Start a new record.';
 end if;
 select array_agg(distinct (x->>'athlete_id')::uuid) into ids from jsonb_array_elements(p_rows) x;
 if exists(select 1 from unnest(ids) i where not exists(select 1 from athletics_athletes a where a.id=i and a.active and a.tournament_id=e.tournament_id)) then raise exception 'Select active athletes from this school';end if;
 if exists(select 1 from jsonb_array_elements(p_rows) x where (x->>'mark') is null or not ((x->>'mark')::numeric>0 and (x->>'mark')::numeric<1000000)) then raise exception 'Each mark must be positive';end if;
 select array_agg(distinct level),array_agg(distinct gender) into levels,genders from athletics_athletes where id=any(ids);
 if e.discipline='relay' and (cardinality(genders)<>1 or cardinality(ids)<>jsonb_array_length(p_rows) or cardinality(ids)>20 or exists(select 1 from jsonb_array_elements(p_rows) x where (x->>'mark')::numeric<>(p_rows->0->>'mark')::numeric)) then raise exception 'Select unique runners of one gender and one team time';end if;
 insert into athletics_class_sessions(id,tournament_id,template_event_id,title,session_date,source,category,categories,gender,conditions,timing_method,implement_kg,quick_payload)
 values(p_id,e.tournament_id,e.id,'Quick record · '||e.name,p_date,p_source,case when cardinality(levels)=1 then levels[1] else 'All' end,levels,case when cardinality(genders)=1 then genders[1] else 'All' end,p_conditions,case when e.discipline='field' then 'not_applicable' else 'manual' end,p_weight,payload);
 perform athletics_save_class_attendance(p_id,ids);
 if e.discipline='relay' then
  perform athletics_configure_class_relay(p_id,1,jsonb_build_array(jsonb_build_object('name','Quick record','athletes',(select jsonb_agg(x->>'athlete_id') from jsonb_array_elements(p_rows) x))));
  select id into team from athletics_class_relay_teams where session_id=p_id;
  perform athletics_save_class_relay(team,(p_rows->0->>'mark')::numeric,'valid','manual');
  update athletics_class_marks set notes=left(notes||' · '||p_notes,500) where session_id=p_id;
 else
  for r in select * from jsonb_array_elements(p_rows) loop
   select coalesce(max(attempt_no),0)+1 into ordinal from athletics_class_marks where session_id=p_id and athlete_id=(r->>'athlete_id')::uuid;
   perform athletics_save_class_marks(p_id,ordinal,jsonb_build_array(jsonb_build_object('athlete_id',r->>'athlete_id','mark',r->'mark','status','valid','notes',p_notes)));
  end loop;
 end if;
 return p_id;
end $$;
revoke all on function public.athletics_quick_record(uuid,uuid,date,text,jsonb,text,text,numeric) from public,anon;
grant execute on function public.athletics_quick_record(uuid,uuid,date,text,jsonb,text,text,numeric) to authenticated;

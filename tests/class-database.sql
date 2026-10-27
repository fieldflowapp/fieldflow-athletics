-- Rollback-only integration checks. Run as project database administrator.
begin;
do $$
declare
 tid uuid; admin_id uuid; eid uuid; girl uuid; boy uuid; sid uuid; n integer; before_scores text; after_scores text;
begin
 select id into tid from public.tournaments where slug='intercolour-athletics-2026';
 select user_id into admin_id from public.system_admins limit 1;
 if admin_id is null then select user_id into admin_id from public.tournament_admins where tournament_id=tid and role in ('owner','admin') limit 1; end if;
 if admin_id is null then raise exception 'No authorized test administrator'; end if;
 select md5(coalesce(jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text)::text,'')) into before_scores from public.athletics_scoreboard_overall s;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 execute 'set local role authenticated';
 select id into eid from public.athletics_events where tournament_id=tid and name='100 m' limit 1;
 select id into girl from public.athletics_athletes where tournament_id=tid and gender='F' and active limit 1;
 select id into boy from public.athletics_athletes where tournament_id=tid and gender='M' and active limit 1;
 if girl is null or boy is null then raise exception 'Missing test athletes'; end if;
 insert into public.athletics_class_sessions(tournament_id,template_event_id,title,session_date,category,gender)
 values(tid,eid,'ROLLBACK ONLY integration test',current_date,'All','All') returning id into sid;
 perform public.athletics_save_class_attendance(sid,array[girl,boy]);
 perform public.athletics_save_class_marks(sid,1,jsonb_build_array(jsonb_build_object('athlete_id',girl,'mark',13.2,'status','valid'),jsonb_build_object('athlete_id',boy,'mark',12.8,'status','valid')));
 select count(*) into n from public.athletics_class_marks where session_id=sid;
 if n<>2 then raise exception 'Mixed-gender save failed'; end if;
 if (select count(distinct gender) from public.athletics_class_marks where session_id=sid)<>2 then raise exception 'Individual gender was lost'; end if;
 perform public.athletics_save_class_marks(sid,1,jsonb_build_array(jsonb_build_object('athlete_id',girl,'mark',13.1,'status','valid')));
 if (select count(*) from public.athletics_class_marks where session_id=sid)<>2 then raise exception 'Retry duplicated results'; end if;
 perform public.athletics_save_class_marks(sid,2,jsonb_build_array(jsonb_build_object('athlete_id',girl,'mark',12.9,'status','valid')));
 if (select count(*) from public.athletics_class_marks where session_id=sid)<>3 then raise exception 'Repeated attempt overwrote history'; end if;
 begin
  perform public.athletics_save_class_marks(sid,3,jsonb_build_array(jsonb_build_object('athlete_id',girl,'mark',12,'status','valid'),jsonb_build_object('athlete_id',boy,'mark',-1,'status','valid')));
  raise exception 'Invalid mark accepted';
 exception when check_violation then null; end;
 if exists(select 1 from public.athletics_class_marks where session_id=sid and attempt_no=3) then raise exception 'Partial batch committed'; end if;
 if (select count(*) from public.athletics_craighouse_history where source_label='ROLLBACK ONLY integration test')<>3 then raise exception 'History missing records'; end if;
 if exists(select record_id from public.athletics_craighouse_history group by record_id having count(*)>1) then raise exception 'History contains duplicate source records'; end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
 if exists(select 1 from public.athletics_class_marks) or exists(select 1 from public.athletics_class_sessions) or exists(select 1 from public.athletics_craighouse_history) then raise exception 'Unauthorized history access'; end if;
 execute 'set local role postgres';
 select md5(coalesce(jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text)::text,'')) into after_scores from public.athletics_scoreboard_overall s;
 if before_scores is distinct from after_scores then raise exception 'Class Mode changed official points'; end if;
 if has_table_privilege('anon','public.athletics_craighouse_history','select') then raise exception 'Anonymous history exposure'; end if;
end $$;
rollback;
select 'PASS: mixed genders, per-athlete history, idempotent retries, repeated attempts, atomic validation, RLS, unchanged official points; all test records rolled back' as result;

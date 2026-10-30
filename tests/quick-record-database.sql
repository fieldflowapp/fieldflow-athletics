begin;
do $$
declare tid uuid; uid uuid; athlete uuid; ev uuid; sid uuid:=gen_random_uuid(); rows jsonb; n integer; failed boolean:=false;
begin
 select id into tid from tournaments where slug='intercolour-athletics-2026';select user_id into uid from system_admins limit 1;
 perform set_config('request.jwt.claim.sub',uid::text,true);execute 'set local role authenticated';
 select id into athlete from athletics_athletes where tournament_id=tid and active and gender='F' limit 1;
 select id into ev from athletics_events where tournament_id=tid and code='HJ' limit 1;
 rows:=jsonb_build_array(jsonb_build_object('athlete_id',athlete,'mark',1.80),jsonb_build_object('athlete_id',athlete,'mark',1.85));
 perform athletics_quick_record(sid,ev,'2026-10-20','class',rows,'Reported by teacher');
 perform athletics_quick_record(sid,ev,'2026-10-20','class',rows,'Reported by teacher');
 select count(*) into n from athletics_class_marks where session_id=sid;
 if n<>2 then raise exception 'Repeated marks or idempotency failed';end if;
 if not exists(select 1 from athletics_craighouse_history where record_id in (select 'class:'||id from athletics_class_marks where session_id=sid) and mark=1.85 and performance_date='2026-10-20' and gender='F') then raise exception 'History failed';end if;
 begin perform athletics_quick_record(sid,ev,current_date,'class',rows);exception when others then failed:=true;end;
 if not failed then raise exception 'Changed retry accepted';end if;
 sid:=gen_random_uuid();failed:=false;
 begin perform athletics_quick_record(sid,ev,current_date,'class',jsonb_build_array(jsonb_build_object('athlete_id',athlete,'mark',-1)));exception when others then failed:=true;end;
 if not failed or exists(select 1 from athletics_class_sessions where id=sid) then raise exception 'Invalid batch was not atomic';end if;
 select id into ev from athletics_events where tournament_id=tid and code='CLASS_4X400' limit 1;
 sid:=gen_random_uuid();perform athletics_quick_record(sid,ev,current_date,'training',jsonb_build_array(jsonb_build_object('athlete_id',athlete,'mark',252.34)));
 if not exists(select 1 from athletics_class_marks where session_id=sid and mark=252.34 and notes like '%Team time%') then raise exception 'Relay failed';end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);failed:=false;
 begin perform athletics_quick_record(gen_random_uuid(),ev,current_date,'class',rows);exception when others then failed:=true;end;
 if not failed then raise exception 'Unauthorized accepted';end if;
end $$;
rollback;

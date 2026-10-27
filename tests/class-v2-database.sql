begin;
do $$
declare tid uuid; admin_id uuid; eid uuid; sid uuid; relayid uuid; rid uuid; ids uuid[]; absent uuid; cats text[]; h uuid; entry uuid; first_round integer; n integer; scores text; after_scores text;
begin
 select id into tid from tournaments where slug='intercolour-athletics-2026';
 select user_id into admin_id from system_admins limit 1;
 select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text)::text,'')) into scores from athletics_scoreboard_overall x;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);execute 'set local role authenticated';
 select id into eid from athletics_events where tournament_id=tid and name='100 m' limit 1;
 select array_agg(id),array_agg(distinct level) into ids,cats from (
 (select id,level from athletics_athletes where tournament_id=tid and active and gender='F' and level='Y7' order by id limit 2)
 union all (select id,level from athletics_athletes where tournament_id=tid and active and gender='M' and level='Y8' order by id limit 2)) x;
 if cardinality(ids)<>4 or cardinality(cats)<>2 then raise exception 'Insufficient fixture athletes';end if;
 select id into absent from athletics_athletes where tournament_id=tid and active and level=any(cats) and not id=any(ids) limit 1;
 insert into athletics_class_sessions(tournament_id,template_event_id,title,session_date,category,categories,gender) values(tid,eid,'ROLLBACK v2',current_date,'All',cats,'All') returning id into sid;
 begin
  perform athletics_generate_class_heats(sid,'mixed',2,0);raise exception 'Attendance gate bypassed';
 exception when raise_exception then if sqlerrm<>'Save attendance first' then raise;end if;end;
 perform athletics_save_class_attendance(sid,ids);
 begin
  perform athletics_save_class_marks(sid,1,jsonb_build_array(jsonb_build_object('athlete_id',absent,'mark',10,'status','valid')));raise exception 'Absent athlete saved';
 exception when insufficient_privilege then null;end;
 perform athletics_generate_class_heats(sid,'mixed',2,0);
 select min(round_no) into first_round from athletics_class_heats where session_id=sid;
 if (select count(*) from athletics_class_heats where session_id=sid)<>2 then raise exception 'Expected two mixed heats';end if;
 if (select count(distinct athlete_id) from athletics_class_heat_entries where session_id=sid)<>4 then raise exception 'Missing/duplicated present athletes';end if;
 if exists(select 1 from athletics_class_heat_entries where session_id=sid and athlete_id=absent) then raise exception 'Absent athlete in heat';end if;
 select id into h from athletics_class_heats where session_id=sid order by heat_number limit 1;
 select id into entry from athletics_class_heat_entries where heat_id=h limit 1;
 perform athletics_save_class_heat(h,jsonb_build_array(jsonb_build_object('id',entry,'official_time',12.345,'status','finished')),false);
 if (select official_time from athletics_class_series_sheet where id=entry)<>12.345 then raise exception 'Photo time missing from class sheet';end if;
 if (select count(*) from athletics_craighouse_history where source_label='ROLLBACK v2' and mark=12.345)<>1 then raise exception 'Individual history not synchronized';end if;
 perform athletics_save_class_heat(h,jsonb_build_array(jsonb_build_object('id',entry,'official_time',12.346,'status','finished')),false);
 if (select count(*) from athletics_class_marks where session_id=sid)<>1 then raise exception 'Photo retry duplicated mark';end if;
 begin
  perform athletics_save_class_heat(h,'[]',true);raise exception 'Incomplete heat completed';
 exception when raise_exception then if sqlerrm<>'Enter a time or DNS / DNF / DQ for every runner before completing' then raise;end if;end;
 perform athletics_save_class_heat(h,(select jsonb_agg(jsonb_build_object('id',id,'official_time',12.4,'status','finished')) from athletics_class_heat_entries where heat_id=h),true);
 if (select status from athletics_class_heats where id=h)<>'completed' then raise exception 'Heat not completed';end if;
 begin
  perform athletics_save_class_attendance(sid,'{}');raise exception 'Attendance cleared generated athletes';
 exception when raise_exception then if sqlerrm<>'An athlete with saved results or generated heats must remain present in this session' then raise;end if;end;
 perform athletics_generate_class_heats(sid,'gender',8,0);
 if (select max(round_no) from athletics_class_heats where session_id=sid)<>first_round+1 then raise exception 'Round not appended';end if;
 if exists(select 1 from athletics_class_heats ch join athletics_class_heat_entries ce on ce.heat_id=ch.id join athletics_athletes a on a.id=ce.athlete_id where ch.session_id=sid and ch.round_no=first_round+1 and ch.gender<>a.gender) then raise exception 'Split-gender series mixed';end if;
 if (select count(*) from athletics_class_marks where session_id=sid)<>2 then raise exception 'Generating next round changed old marks';end if;
 select id into relayid from athletics_events where tournament_id=tid and discipline='relay' limit 1;
 begin
  insert into athletics_class_sessions(tournament_id,template_event_id,title,session_date,category,categories,gender) values(tid,relayid,'INVALID mixed relay',current_date,'All',cats,'All');raise exception 'Mixed relay accepted';
 exception when insufficient_privilege then null;end;
 insert into athletics_class_sessions(tournament_id,template_event_id,title,session_date,category,categories,gender) values(tid,relayid,'ROLLBACK relay',current_date,'All',cats,'F') returning id into rid;
 perform athletics_save_class_attendance(rid,(select array_agg(id) from athletics_athletes where id=any(ids) and gender='F'));
 begin
  perform athletics_save_class_attendance(rid,ids);raise exception 'Male accepted into female relay';
 exception when raise_exception then if sqlerrm<>'An athlete does not belong to the selected categories / gender' then raise;end if;end;
 perform athletics_save_class_marks(rid,1,(select jsonb_agg(jsonb_build_object('athlete_id',id,'mark',60,'status','valid','notes','Team time')) from athletics_athletes where id=any(ids) and gender='F'));
 if exists(select 1 from athletics_craighouse_history where source_label like 'ROLLBACK relay%' and unit<>'s') then raise exception 'Relay unit incorrect';end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
 if exists(select 1 from athletics_class_attendance) or exists(select 1 from athletics_class_heats) or exists(select 1 from athletics_class_series_sheet) then raise exception 'Unauthorized class access';end if;
 execute 'set local role postgres';
 select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text)::text,'')) into after_scores from athletics_scoreboard_overall x;
 if scores is distinct from after_scores then raise exception 'Official points changed';end if;
end $$;
rollback;
select 'PASS: multi-category attendance, absent exclusion, multiple mixed/split-gender heats, Photo Finish save and retry, history, repeated rounds, relay gender, RLS and official score isolation. Test data rolled back.' as result;

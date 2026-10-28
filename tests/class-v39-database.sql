begin;
do $$
declare tid uuid; uid uuid; eid uuid; sid uuid; aid uuid; bid uuid; hid uuid; h2 uuid; h3 uuid; c athletics_class_hj_cards; trials jsonb; rejected boolean; before_official text;
begin
 select md5(coalesce(jsonb_agg(to_jsonb(x))::text,'')) into before_official from athletics_high_jump_attempts x;
 select id into tid from tournaments where slug='intercolour-athletics-2026';select user_id into uid from system_admins limit 1;
 perform set_config('request.jwt.claim.sub',uid::text,true);execute 'set local role authenticated';
 select id into eid from athletics_events where tournament_id=tid and code='HJ' limit 1;
 select id into aid from athletics_athletes where tournament_id=tid and active and level='Y7' and gender='F' limit 1;
 select id into bid from athletics_athletes where tournament_id=tid and active and level='Y8' and gender='M' limit 1;
 insert into athletics_class_sessions(tournament_id,template_event_id,title,session_date,category,categories,gender) values(tid,eid,'ROLLBACK high jump',current_date,'All',array['Y7','Y8'],'All') returning id into sid;
 perform athletics_save_class_attendance(sid,array[aid,bid]);
 -- A legacy mark must not be overwritten by the derived best.
 perform athletics_save_class_marks(sid,1,jsonb_build_array(jsonb_build_object('athlete_id',aid,'mark',1.05,'status','valid')));
 insert into athletics_class_hj_heights(session_id,height_m,sequence_no) values(sid,1.10,1) returning id into hid;
 insert into athletics_class_hj_heights(session_id,height_m,sequence_no) values(sid,1.20,2) returning id into h2;
 insert into athletics_class_hj_heights(session_id,height_m,sequence_no) values(sid,1.30,3) returning id into h3;
 trials:=jsonb_build_object(hid::text,jsonb_build_array('X','X','O'));
 select * into c from athletics_save_class_hj(sid,aid,trials,0);
 if c.best_height<>1.10 or c.mark_attempt<>2 then raise exception 'Initial best or legacy preservation failed';end if;
 trials:=trials||jsonb_build_object(h2::text,jsonb_build_array('X','O',''));
 select * into c from athletics_save_class_hj(sid,aid,trials,1);
 if c.best_height<>1.20 then raise exception 'Best not updated';end if;
 trials:=trials||jsonb_build_object(h3::text,jsonb_build_array('X','X','X'));
 select * into c from athletics_save_class_hj(sid,aid,trials,2);
 if c.best_height<>1.20 or (select count(*) from athletics_class_marks where session_id=sid and athlete_id=aid)<>2 then raise exception 'Best duplicated or lost on elimination';end if;
 -- Correct a clear: recalculation must decrease the derived record, preserving legacy.
 trials:=jsonb_set(trials,array[h2::text],'["X","X",""]'::jsonb);
 select * into c from athletics_save_class_hj(sid,aid,trials,3);
 if c.best_height<>1.10 or not exists(select 1 from athletics_class_marks where session_id=sid and athlete_id=aid and attempt_no=2 and mark=1.10) then raise exception 'Correction not reflected';end if;
 if not exists(select 1 from athletics_class_marks where session_id=sid and athlete_id=aid and attempt_no=1 and mark=1.05) then raise exception 'Legacy result changed';end if;
 rejected:=false;begin perform athletics_save_class_hj(sid,aid,trials,3);exception when others then rejected:=true;end;if not rejected then raise exception 'Stale version accepted';end if;
 rejected:=false;begin perform athletics_save_class_hj(sid,bid,jsonb_build_object(hid::text,'["X","-",""]'::jsonb),0);exception when others then rejected:=true;end;if not rejected then raise exception 'Pass after attempt 1 accepted';end if;
 rejected:=false;begin perform athletics_save_class_hj(sid,bid,jsonb_build_object(hid::text,'["O","X",""]'::jsonb),0);exception when others then rejected:=true;end;if not rejected then raise exception 'Attempt after O accepted';end if;
 rejected:=false;begin perform athletics_save_class_hj(sid,bid,jsonb_build_object(hid::text,'["X","X","X"]'::jsonb,h2::text,'["O","",""]'::jsonb),0);exception when others then rejected:=true;end;if not rejected then raise exception 'Post elimination result accepted';end if;
 select * into c from athletics_save_class_hj(sid,bid,jsonb_build_object(hid::text,'["-","",""]'::jsonb,h2::text,'["X","X",""]'::jsonb,h3::text,'["X","O",""]'::jsonb),0);
 if c.best_height<>1.30 then raise exception 'Pass/cross-height miss rules differ from competition';end if;
 if not exists(select 1 from athletics_craighouse_history where athlete_id=bid and mark=1.30 and source='class') then raise exception 'History missing automatic best';end if;
 rejected:=false;begin perform athletics_save_class_marks(sid,1,jsonb_build_array(jsonb_build_object('athlete_id',bid,'mark',2.50,'status','valid')));exception when others then rejected:=true;end;if not rejected then raise exception 'Derived best manually overwritten';end if;
 update athletics_class_sessions set closed_at=now() where id=sid;
 rejected:=false;begin perform athletics_save_class_hj(sid,bid,c.trials,1);exception when others then rejected:=true;end;if not rejected then raise exception 'Closed session accepted';end if;
 execute 'reset role';
 if before_official is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(x))::text,'')) from athletics_high_jump_attempts x) then raise exception 'Official attempts changed';end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);execute 'set local role authenticated';
 if exists(select 1 from athletics_class_hj_cards where session_id=sid) then raise exception 'Unauthorized read';end if;
 rejected:=false;begin perform athletics_save_class_hj(sid,bid,'{}'::jsonb,1);exception when others then rejected:=true;end;if not rejected then raise exception 'Unauthorized write';end if;
end $$;
rollback;
select 'PASS high jump O/X/pass, elimination, corrections, automatic best, legacy data, history, stale saves, closed session, RLS and official isolation. All test data rolled back.' as result;

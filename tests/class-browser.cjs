// Browser integration against an in-memory transport. Never writes competition data.
const {chromium}=require(require.resolve('playwright',{paths:process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES]:[__dirname]}));
const assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const mock=()=>{
 const athletes=[{id:'girl',first_name:'Student',last_name:'One',gender:'F',level:'Y7',color:'Blue',external_code:'TEST1',active:true},{id:'boy',first_name:'Student',last_name:'Two',gender:'M',level:'Y8',color:'Red',external_code:'TEST2',active:true},{id:'absent',first_name:'Absent',last_name:'Three',gender:'M',level:'Y8',color:'White',external_code:'TEST3',active:true}];
 const events=[{id:'event',name:'Long Jump',discipline:'field',category:'Y8'},{id:'track',name:'100 m',discipline:'track',category:'Y8',start_mode:'lanes'},{id:'relay',name:'Relay 4x100 m',discipline:'relay',category:'Y8'}];
 for(const distance of [400,600,800])events.push({id:'track'+distance,name:distance+' m',discipline:'track',category:'Y7',start_mode:'mass_start'});
 const db=JSON.parse(localStorage.getItem('test-db')||'{"sessions":[],"marks":[],"attendance":[],"heats":[],"entries":[],"sequence":0,"teams":[],"legs":[],"audit":[]}');const {sessions,marks,attendance,heats,entries,teams,legs,audit}=db;
 const persist=()=>localStorage.setItem('test-db',JSON.stringify(db));const next=prefix=>prefix+'-'+(++db.sequence);
 const sheet=()=>entries.map(e=>{const a=athletes.find(a=>a.id===e.athlete_id),m=marks.find(m=>m.session_id===e.session_id&&m.athlete_id===e.athlete_id&&m.attempt_no===e.round_no);return {...e,first_name:a.first_name,last_name:a.last_name,gender:a.gender,level:a.level,color:a.color,official_time:m?.mark??null,status:m?(m.status==='valid'?'finished':m.status):'scheduled',notes:m?.notes||''}});
 function saveMarks(sid,attempt,rows){const session=sessions.find(s=>s.id===sid);const result=rows.map(r=>{let m=marks.find(m=>m.athlete_id===r.athlete_id&&m.session_id===sid&&m.attempt_no===attempt);const previous=m?structuredClone(m):null;const a=athletes.find(a=>a.id===r.athlete_id);if(!m){m={id:next('mark'),session_id:sid,attempt_no:attempt,category:a.level,gender:a.gender,conditions:session.conditions||'',timing_method:session.timing_method||'unspecified',implement_kg:session.implement_kg??null};marks.push(m)}Object.assign(m,r);if(previous&&JSON.stringify(previous)!==JSON.stringify(m))audit.push({id:next('audit'),session_id:sid,athlete_id:r.athlete_id,changed_at:new Date().toISOString(),changed_by:'teacher',actor_label:'Teacher',before_value:previous,after_value:structuredClone(m)});return m});persist();return structuredClone(result)}
 window.testState={...db,failSave:false};
 class Query{
  constructor(table){this.table=table;this.filters=[];this.start=0;this.end=499}
  select(){return this}eq(k,v){this.filters.push(r=>k==='tournament_id'||r[k]===v);return this}in(k,v){this.filters.push(r=>v.includes(r[k]));return this}order(){return this}range(a,b){this.start=a;this.end=b;return this}single(){this.one=true;return this}insert(value){this.value=value;return this}update(value){this.changes=value;return this}
  then(resolve,reject){try{let rows;
   if(this.table==='tournaments')rows=[{id:'tournament',name:'Test tournament',slug:'intercolour-athletics-2026'}];
   else if(this.table==='athletics_athletes')rows=athletes;
   else if(this.table==='athletics_events')rows=events;
   else if(this.table==='athletics_class_sessions'){if(this.value){sessions.push({id:next('session'),attendance_recorded:false,...this.value});persist();rows=[sessions.at(-1)]}else {rows=sessions;if(this.changes){rows=rows.filter(r=>this.filters.every(fn=>fn(r)));rows.forEach(r=>Object.assign(r,this.changes));persist()}}}
   else if(this.table==='athletics_class_relay_teams')rows=teams;
   else if(this.table==='athletics_class_relay_legs')rows=legs;
   else if(this.table==='athletics_class_mark_audit')rows=audit;
   else if(this.table==='athletics_class_marks')rows=marks;
   else if(this.table==='athletics_class_attendance')rows=attendance;
   else if(this.table==='athletics_class_heats')rows=heats;
   else if(this.table==='athletics_class_series_sheet')rows=sheet();
   else if(this.table==='athletics_craighouse_history')rows=marks.map(m=>{const s=sessions.find(x=>x.id===m.session_id),ev=events.find(e=>e.id===s.template_event_id);return {...m,record_id:'class:'+m.id,event_name:ev.name,discipline:ev.discipline,unit:ev.discipline==='field'?'m':'s',performance_date:s.session_date,source:s.source,source_label:s.title,conditions:s.conditions,tournament_id:'tournament'}});
   else throw Error('Unexpected / official table access: '+this.table);
   rows=rows.filter(r=>this.filters.every(fn=>fn(r))).slice(this.start,this.end+1);
   return Promise.resolve({data:this.one?structuredClone(rows[0]):structuredClone(rows),error:null}).then(resolve,reject);
  }catch(e){return Promise.reject(e).then(resolve,reject)}}
 }
 window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'teacher'}}}}),onAuthStateChange:()=>{},signOut:async()=>{}},from:t=>new Query(t),rpc:async(fn,p)=>{
  if(fn==='is_athletics_admin')return {data:true};
  if(window.testState.failSave)return {error:{message:'Test network error'}};
  if(fn==='athletics_save_class_marks')return {data:saveMarks(p.p_session_id,p.p_attempt,p.p_marks)};
  if(fn==='athletics_add_class_activity'){
   const selected=sessions.find(s=>s.id===p.p_session_id),root=sessions.find(s=>s.id===(selected.parent_session_id||selected.id));const child={...root,id:next('session'),parent_session_id:root.id,template_event_id:p.p_event_id,gender:p.p_gender,conditions:p.p_conditions,timing_method:p.p_timing,implement_kg:p.p_implement,attendance_recorded:false};sessions.push(child);persist();return {data:structuredClone(child)};
  }
  if(fn==='athletics_save_class_attendance'){
   const selected=sessions.find(s=>s.id===p.p_session_id),root=sessions.find(s=>s.id===(selected.parent_session_id||selected.id));
   for(const s of sessions.filter(s=>s.id===p.p_session_id)){for(const a of athletes.filter(a=>s.gender==='All'||a.gender===s.gender)){let att=attendance.find(r=>r.session_id===s.id&&r.athlete_id===a.id);if(!att){att={session_id:s.id,athlete_id:a.id,present:false};attendance.push(att)}att.available=p.p_present.includes(a.id);att.present=att.present||att.available}s.attendance_recorded=true}persist();return {data:p.p_present.length};
  }
  if(fn==='athletics_edit_class_series'){
   for(const r of p.p_entries){const e=entries.find(e=>e.id===r.id);e.heat_id=r.heat_id;e.lane=r.lane}persist();return {data:null};
  }
  if(fn==='athletics_configure_class_relay'){
   for(let i=legs.length-1;i>=0;i--)if(legs[i].session_id===p.p_session_id&&legs[i].attempt_no===p.p_attempt)legs.splice(i,1);
   for(let i=teams.length-1;i>=0;i--)if(teams[i].session_id===p.p_session_id&&teams[i].attempt_no===p.p_attempt)teams.splice(i,1);
   for(const t of p.p_teams){const team={id:next('team'),name:t.name,session_id:p.p_session_id,attempt_no:p.p_attempt};teams.push(team);t.athletes.forEach((id,i)=>legs.push({team_id:team.id,session_id:team.session_id,attempt_no:team.attempt_no,athlete_id:id,leg_order:i+1}))}persist();return {data:null};
  }
  if(fn==='athletics_save_class_relay'){
   const team=teams.find(t=>t.id===p.p_team_id);return {data:saveMarks(team.session_id,team.attempt_no,legs.filter(l=>l.team_id===team.id).map(l=>({athlete_id:l.athlete_id,mark:p.p_mark,status:p.p_status,timing_method:p.p_timing,notes:'Relay '+team.name+' · Leg '+l.leg_order+' · Team time, not an individual split'})))};
  }
  if(fn==='athletics_generate_class_heats'){
   const s=sessions.find(s=>s.id===p.p_session_id),round=Math.max(0,...heats.filter(h=>h.session_id===s.id).map(h=>h.round_no),...marks.filter(m=>m.session_id===s.id).map(m=>m.attempt_no))+1;
   const present=athletes.filter(a=>attendance.some(att=>att.session_id===s.id&&att.athlete_id===a.id&&att.present&&att.available)&&(p.p_athletes==null||p.p_athletes.includes(a.id)));let number=0;const created=[];
   for(const gender of p.p_mode==='gender'?['F','M']:[s.gender]){const group=present.filter(a=>gender==='All'||a.gender===gender);if(!group.length)continue;const count=p.p_heat_count||Math.ceil(group.length/p.p_capacity);for(let i=0;i<count;i++){const h={id:next('heat'),session_id:s.id,round_no:round,heat_number:++number,gender,status:'scheduled'};heats.push(h);created.push(h);group.filter((a,j)=>j%count===i).forEach((a,j)=>entries.push({id:next('entry'),heat_id:h.id,session_id:s.id,round_no:round,athlete_id:a.id,lane:j+1}))}}
   persist();return {data:structuredClone(created)};
  }
  if(fn==='athletics_save_class_heat'){
   const h=heats.find(h=>h.id===p.p_heat_id);saveMarks(h.session_id,h.round_no,p.p_results.map(r=>({athlete_id:entries.find(e=>e.id===r.id).athlete_id,mark:r.official_time,status:r.status==='finished'?'valid':r.status,notes:r.notes||'',timing_method:r.timing_method||'manual'})));h.status=p.p_complete?'completed':'scheduled';persist();return {data:sheet().filter(r=>r.heat_id===h.id)};
  }
  throw Error('Unexpected / official RPC: '+fn);
 }})};
};
(async()=>{
 const server=http.createServer((req,res)=>{let p=path.join(root,new URL(req.url,'http://localhost').pathname);if(p.endsWith('/'))p+='index.html';if(!p.startsWith(root)){res.writeHead(403);return res.end()}fs.readFile(p,(err,data)=>{if(err){res.writeHead(404);return res.end()}res.setHeader('Content-Type',p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':p.endsWith('.png')?'image/png':'text/html');res.end(data)})}).listen(0,'127.0.0.1');
 await new Promise(r=>server.on('listening',r));let browser;try{browser=await chromium.launch({headless:true})}catch(e){server.close();throw e}
 try{
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route(url=>url.hostname==='cdn.jsdelivr.net'&&url.pathname.includes('/@supabase/'),r=>r.fulfill({contentType:'application/javascript',body:'('+mock.toString()+')()'}));
  await page.route('**/app-updater.js*',r=>r.fulfill({contentType:'application/javascript',body:''}));
  await page.goto(`http://127.0.0.1:${server.address().port}/craighouse/`);
  await page.locator('#app').waitFor({state:'visible'});
  assert.equal(await page.locator('#gender').inputValue(),'All');
  await page.locator('#categoryChoices input[value="Y7"]').check();await page.locator('#categoryChoices input[value="Y8"]').check();
  await page.fill('#title','Mixed class');await page.click('#createSession');await page.locator('#attendanceList input').first().waitFor();
  assert.equal(await page.locator('#sheetControls').isVisible(),false);
  await page.locator('[data-present="girl"]').check();await page.locator('[data-present="boy"]').check();await page.click('#saveAttendance');await page.locator('#sheet tr').first().waitFor();
  assert.equal(await page.locator('[data-athlete="absent"]').count(),0);
  assert.deepEqual(await page.evaluate(()=>testState.sessions[0].categories),['Y7','Y8']);
  assert.equal(await page.locator('#sheet tr').count(),2);
  await page.locator('[data-athlete="girl"] .mark').fill('13,20');await page.locator('[data-athlete="boy"] .mark').fill('12.8');await page.click('#saveMarks');
  await page.waitForFunction(()=>document.getElementById('message').textContent.includes('2 individual results saved'));
  let result=await page.evaluate(()=>testState.marks);assert.equal(result.length,2);assert.deepEqual(result.map(r=>r.gender).sort(),['F','M']);
  await page.locator('[data-athlete="girl"] .mark').fill('13.1');await page.click('#saveMarks');await page.waitForFunction(()=>document.getElementById('message').textContent.includes('1 individual results saved'));
  assert.equal(await page.evaluate(()=>testState.marks.length),2);
  await page.click('#nextAttempt');assert.equal(await page.locator('#attempt').inputValue(),'2');assert.equal(await page.locator('[data-athlete="girl"] .mark').inputValue(),'');
  await page.locator('[data-athlete="girl"] .mark').fill('12.9');await page.evaluate(()=>testState.failSave=true);await page.click('#saveMarks');await page.waitForFunction(()=>document.getElementById('message').textContent==='Test network error');assert.equal(await page.locator('[data-athlete="girl"] .mark').inputValue(),'12.9');
  await page.evaluate(()=>testState.failSave=false);await page.click('#saveMarks');await page.waitForFunction(()=>testState.marks.length===3);await page.waitForFunction(()=>!document.getElementById('app').inert);
  await page.screenshot({path:'/tmp/class-sheet-'+viewport.width+'.png',fullPage:true});
  await page.click('#databaseTab');await page.locator('#history tbody tr').first().waitFor();assert.equal(await page.locator('#history tbody tr').count(),2);assert.equal(await page.locator('#progress svg').count(),1);
  await page.click('#rankTab');await page.selectOption('#rankSource','class');await page.selectOption('#rankCategory','Y7');await page.click('#loadRanking');await page.locator('#ranking tbody tr').first().waitFor();assert.equal(await page.locator('#ranking tbody tr').count(),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.click('#classTab');if(!await page.locator('#sessionForm').isVisible())await page.locator('#sessionSetup summary').click();await page.selectOption('#event','track');await page.fill('#title','Mixed track');await page.click('#createSession');
  await page.locator('[data-present="girl"]').check();await page.locator('[data-present="boy"]').check();await page.click('#saveAttendance');await page.fill('#heatCapacity','1');await page.click('#generateHeats');await page.locator('.heat-card').first().waitFor();
  assert.equal(await page.locator('.heat-card').count(),2);
  await page.screenshot({path:'/tmp/class-series-'+viewport.width+'.png',fullPage:true});
  await page.locator('#seriesEditor summary').click();
  const originalAssignments=await page.locator('.assign-heat').evaluateAll(xs=>xs.map(x=>x.value));
  await page.locator('.assign-heat').nth(0).selectOption(originalAssignments[1]);await page.locator('.assign-heat').nth(1).selectOption(originalAssignments[0]);await page.click('#saveSeriesLayout');await page.waitForFunction(()=>document.getElementById('message').textContent.includes('Series and lanes saved'));
  const href=await page.locator('.photo-link').first().getAttribute('href');assert.ok(href.includes('classHeat='));
  await page.evaluate(()=>{const s=testState.sessions.at(-1),h=testState.heats.find(h=>h.session_id===s.id),en=testState.entries.find(e=>e.heat_id===h.id);localStorage.setItem('ff-photo-pending-v1:class-heat:'+h.id,JSON.stringify({savedAt:Date.now(),assignments:[[en.id,12.345]]}))});
  await page.locator('.photo-link').first().click();await page.locator('#saveResultsBtn').waitFor({state:'visible'});assert.ok((await page.locator('#heatContext').textContent()).includes('CLASS'));
  await page.click('#saveResultsBtn');await page.waitForFunction(()=>document.getElementById('mode').textContent==='RESULTS SAVED');await page.click('#backBtn');await page.locator('#trackControls').waitFor({state:'visible'});
  assert.equal(await page.locator('.heat-time').first().inputValue(),'12.345');
  await page.selectOption('#heatMode','gender');await page.fill('#heatCapacity','8');await page.click('#generateHeats');await page.waitForFunction(()=>document.getElementById('roundPicker').value==='2');
  assert.equal(await page.locator('.heat-card').count(),2);assert.ok((await page.locator('#heatList').textContent()).includes('Female'));assert.ok((await page.locator('#heatList').textContent()).includes('Male'));
  await page.selectOption('#roundPicker','1');assert.equal(await page.locator('.heat-time').first().inputValue(),'12.345');
  // A selected subset repeats while other present students keep their earlier marks.
  await page.click('#noneRound');await page.locator('[data-round-athlete="girl"]').check();await page.click('#generateHeats');await page.waitForFunction(()=>document.getElementById('roundPicker').value==='3');assert.equal(await page.locator('.heat-runner').count(),1);
  const trackRoot=await page.evaluate(()=>testState.sessions.at(-1).id);
  // A departure and late arrival preserve historical attendance and previous times.
  await page.click('#attendanceStepBtn');await page.locator('[data-present="girl"]').uncheck();await page.locator('[data-present="absent"]').check();await page.click('#saveAttendance');await page.waitForFunction(()=>document.getElementById('message').textContent.includes('available students saved'));
  assert.equal(await page.locator('[data-round-athlete="girl"]').count(),0);assert.equal(await page.locator('[data-round-athlete="absent"]').count(),1);
  assert.equal(await page.evaluate(id=>testState.attendance.find(a=>a.session_id===id&&a.athlete_id==='girl').present,trackRoot),true);
  await page.click('#attendanceStepBtn');await page.locator('[data-present="girl"]').check();await page.click('#saveAttendance');
  // Each new activity starts with a blank attendance checklist.
  await page.locator('#activityControls details').first().locator('summary').click();await page.selectOption('#addEvent','event');await page.click('#addActivity');await page.locator('#attendancePane').waitFor({state:'visible'});
  assert.equal(await page.locator('#attendanceList input:checked').count(),0);assert.equal(await page.locator('#sheetControls').isVisible(),false);
  const fieldActivity=await page.locator('#activityPicker').inputValue();
  await page.click('#recordStepBtn');assert.equal(await page.locator('#sheetControls').isVisible(),false);
  // Combined filters and select-visible retain selections hidden by another filter.
  await page.selectOption('#attendanceGender','F');await page.selectOption('#attendanceColour','Blue');assert.equal(await page.locator('#attendanceList input').count(),1);await page.click('#selectPresent');
  await page.selectOption('#attendanceGender','M');assert.equal(await page.locator('#attendanceList input').count(),0);
  await page.selectOption('#attendanceColour','White');await page.click('#selectPresent');await page.click('#clearPresent');
  await page.selectOption('#attendanceGender','All');await page.selectOption('#attendanceColour','All');assert.equal(await page.locator('#attendanceList input:checked').count(),1);assert.equal(await page.locator('[data-present="girl"]').isChecked(),true);
  await page.fill('#attendanceSearch','TEST3');assert.equal(await page.locator('#attendanceList input').count(),1);await page.click('#selectPresent');await page.fill('#attendanceSearch','');
  await page.screenshot({path:'/tmp/class-attendance-'+viewport.width+'.png',fullPage:true});
  await page.click('#saveAttendance');await page.locator('#sheetControls').waitFor({state:'visible'});
  assert.equal(await page.locator('#sheet tr').count(),2);
  assert.equal(await page.evaluate(id=>testState.attendance.filter(a=>a.session_id===id&&a.available).length,trackRoot),3);
  // Switching activities restores each event's own list.
  await page.selectOption('#activityPicker',trackRoot);await page.click('#attendanceStepBtn');assert.equal(await page.locator('#attendanceList input:checked').count(),3);
  await page.selectOption('#activityPicker',fieldActivity);await page.click('#attendanceStepBtn');assert.equal(await page.locator('#attendanceList input:checked').count(),2);await page.click('#recordStepBtn');
  assert.equal(await page.locator('#activityPicker option').count(),2);assert.equal(await page.locator('#sessionPicker option').count(),3);
  await page.locator('#activityControls details').nth(1).locator('summary').click();await page.fill('#activityWeight','3');await page.fill('#activityConditions','Dry surface');await page.click('#saveActivitySettings');await page.waitForFunction(()=>document.getElementById('message').textContent.includes('Defaults saved'));
  await page.locator('[data-athlete="girl"] .mark').fill('4.5');await page.click('#saveMarks');await page.waitForFunction(()=>document.getElementById('message').textContent.includes('individual results saved'));
  await page.locator('[data-athlete="girl"] .mark').fill('4.6');await page.click('#saveMarks');await page.waitForFunction(()=>!document.getElementById('app').inert);
  // A relay in the same mixed session has only Male / Female activity choices.
  await page.locator('#activityControls details').first().locator('summary').click();await page.selectOption('#addEvent','relay');assert.deepEqual(await page.locator('#addGender option').evaluateAll(xs=>xs.map(x=>x.value)),['M','F']);await page.selectOption('#addGender','F');await page.click('#addActivity');await page.locator('#attendancePane').waitFor({state:'visible'});assert.equal(await page.locator('#attendanceList input:checked').count(),0);assert.equal(await page.locator('#attendanceList input').count(),1);await page.locator('[data-present="girl"]').check();await page.click('#saveAttendance');await page.locator('#relayControls').waitFor({state:'visible'});
  await page.locator('.team-name').fill('Falcons');await page.locator('.team-athlete').first().selectOption('girl');assert.equal(await page.locator('.team-athlete').first().locator('option[value="boy"]').count(),0);await page.click('#saveRelayTeams');await page.locator('.relay-time').waitFor();
  assert.equal(await page.locator('#relayTimeFormat').inputValue(),'clock');await page.locator('.relay-time').fill('1:00.45');await page.click('#saveRelay');await page.waitForFunction(()=>document.getElementById('message').textContent.includes('individual results saved'));assert.equal(await page.locator('.team-name').count(),0);assert.equal(await page.locator('.relay-time').inputValue(),'1:00.45');assert.equal(await page.evaluate(()=>testState.marks.at(-1).mark),60.45);
  await page.click('#summaryStepBtn');await page.locator('#toggleSessionClosed').waitFor();assert.ok((await page.locator('#summaryPane').textContent()).includes('Correction history · 1'));assert.ok((await page.locator('#summaryPane').textContent()).includes('No results yet'));
  await page.locator('#summaryPane summary').click();assert.ok((await page.locator('#summaryPane').textContent()).includes('Teacher'));assert.ok((await page.locator('#summaryPane').textContent()).includes('4.5'));assert.ok((await page.locator('#summaryPane').textContent()).includes('4.6'));
  await page.click('#toggleSessionClosed');await page.waitForFunction(()=>document.getElementById('toggleSessionClosed').textContent==='Reopen session');await page.click('#recordStepBtn');assert.equal(await page.locator('#relayControls').isVisible(),false);
  await page.click('#toggleSessionClosed');await page.waitForFunction(()=>document.getElementById('toggleSessionClosed').textContent==='Close session');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'/tmp/class-mode-'+viewport.width+'.png',fullPage:true});
  await page.click('#recordStepBtn');
  for(const [distance,clock,seconds] of [[400,'1:23.45',83.45],[600,'2:01.23',121.23],[800,'2:45.67',165.67]]){
   await page.locator('#activityControls details').first().locator('summary').click();await page.selectOption('#addEvent','track'+distance);await page.click('#addActivity');await page.locator('#attendancePane').waitFor({state:'visible'});await page.locator('[data-present="girl"]').check();await page.click('#saveAttendance');await page.click('#generateHeats');await page.locator('#heatList .heat-time').waitFor();
   assert.equal(await page.locator('#trackTimeFormat').inputValue(),'clock');await page.locator('#heatList .heat-time').fill(clock);await page.locator('#heatList .save-heat').click();await page.waitForFunction(()=>!document.getElementById('app').inert);assert.equal(await page.evaluate(()=>testState.marks.at(-1).mark),seconds);assert.equal(await page.locator('#heatList .heat-time').inputValue(),clock);
   await page.selectOption('#trackTimeFormat','seconds');assert.equal(await page.locator('#heatList .heat-time').inputValue(),String(seconds));await page.selectOption('#trackTimeFormat','clock');
  }
  // Existing Photo Finish precision survives display rounding and metadata edits.
  await page.evaluate(()=>{testState.marks.at(-1).mark=165.678});await page.click('#refreshSeries');await page.waitForFunction(()=>!document.getElementById('app').inert);assert.equal(await page.locator('#heatList .heat-time').inputValue(),'2:45.68');await page.selectOption('#heatList .heat-timing','photo_finish');await page.locator('#heatList .save-heat').click();await page.waitForFunction(()=>!document.getElementById('app').inert);assert.equal(await page.evaluate(()=>testState.marks.at(-1).mark),165.678);
  await page.click('#rankTab');await page.selectOption('#rankEvent','800 m');await page.selectOption('#rankCategory','Y7');await page.selectOption('#rankGender','F');await page.selectOption('#rankSource','class');await page.evaluate(()=>{window.print=()=>{window.printCalled=true}});await page.click('#printRanking');await page.waitForFunction(()=>window.printCalled);
  assert.ok((await page.locator('#rankingPrint').textContent()).includes('800 m'));assert.ok((await page.locator('#rankingPrint').textContent()).includes('2:45.68'));assert.ok((await page.locator('#rankingPrint').textContent()).includes('Y7 · Girls · Class'));
  await page.emulateMedia({media:'print'});assert.equal(await page.locator('main').isVisible(),false);assert.equal(await page.locator('#rankingPrint').isVisible(),true);
  await page.screenshot({path:'/tmp/class-ranking-print-'+viewport.width+'.png',fullPage:true});
  if(viewport.width===1440){
   await page.evaluate(()=>{const tbody=document.querySelector('#rankingPrint tbody'),row=tbody.firstElementChild;for(let i=0;i<150;i++)tbody.append(row.cloneNode(true))});
   const pdf=await page.pdf({path:'/tmp/class-ranking-a4.pdf',preferCSSPageSize:true,printBackground:true});const text=pdf.toString('latin1'),box=/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/.exec(text);assert.ok(box);assert.ok(Math.abs(Number(box[1])-841.89)<2);assert.ok(Math.abs(Number(box[2])-595.28)<2);assert.ok((text.match(/\/Type \/Page\b/g)||[]).length>1);
  }
  await page.emulateMedia({media:'screen'});await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));assert.equal(await page.locator('main').isVisible(),true);assert.equal(await page.locator('#rankingPrint').isVisible(),false);assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS desktop + mobile v3 multi-activity, selected repeaters, independent event attendance, combined gender/colour filters and departures, series editing, custom relay, conditions, audit and close/reopen, attendance, class Photo Finish round-trip, gender heats and relays: mixed class, save/retry, individual gender, repeated attempts, failed-save recovery, history, chart, ranking, responsive layout');
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

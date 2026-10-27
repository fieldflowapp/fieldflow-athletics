// Browser integration against an in-memory transport. Never writes competition data.
const {chromium}=require(require.resolve('playwright',{paths:process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES]:[__dirname]}));
const assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const mock=()=>{
 const athletes=[{id:'girl',first_name:'Student',last_name:'One',gender:'F',level:'Y7',color:'Blue',external_code:'TEST1',active:true},{id:'boy',first_name:'Student',last_name:'Two',gender:'M',level:'Y8',color:'Red',external_code:'TEST2',active:true},{id:'absent',first_name:'Absent',last_name:'Three',gender:'M',level:'Y8',color:'White',external_code:'TEST3',active:true}];
 const events=[{id:'event',name:'Long Jump',discipline:'field',category:'Y8'},{id:'track',name:'100 m',discipline:'track',category:'Y8',start_mode:'lanes'},{id:'relay',name:'Relay 4x100 m',discipline:'relay',category:'Y8'}];
 const db=JSON.parse(localStorage.getItem('test-db')||'{"sessions":[],"marks":[],"attendance":[],"heats":[],"entries":[],"sequence":0}');const {sessions,marks,attendance,heats,entries}=db;
 const persist=()=>localStorage.setItem('test-db',JSON.stringify(db));const next=prefix=>prefix+'-'+(++db.sequence);
 const sheet=()=>entries.map(e=>{const a=athletes.find(a=>a.id===e.athlete_id),m=marks.find(m=>m.session_id===e.session_id&&m.athlete_id===e.athlete_id&&m.attempt_no===e.round_no);return {...e,first_name:a.first_name,last_name:a.last_name,gender:a.gender,level:a.level,color:a.color,official_time:m?.mark??null,status:m?(m.status==='valid'?'finished':m.status):'scheduled',notes:m?.notes||''}});
 function saveMarks(sid,attempt,rows){const result=rows.map(r=>{let m=marks.find(m=>m.athlete_id===r.athlete_id&&m.session_id===sid&&m.attempt_no===attempt);const a=athletes.find(a=>a.id===r.athlete_id);if(!m){m={id:next('mark'),session_id:sid,attempt_no:attempt,category:a.level,gender:a.gender};marks.push(m)}Object.assign(m,r);return m});persist();return structuredClone(result)}
 window.testState={...db,failSave:false};
 class Query{
  constructor(table){this.table=table;this.filters=[];this.start=0;this.end=499}
  select(){return this}eq(k,v){this.filters.push(r=>k==='tournament_id'||r[k]===v);return this}in(k,v){this.filters.push(r=>v.includes(r[k]));return this}order(){return this}range(a,b){this.start=a;this.end=b;return this}single(){this.one=true;return this}insert(value){this.value=value;return this}
  then(resolve,reject){try{let rows;
   if(this.table==='tournaments')rows=[{id:'tournament',name:'Test tournament',slug:'intercolour-athletics-2026'}];
   else if(this.table==='athletics_athletes')rows=athletes;
   else if(this.table==='athletics_events')rows=events;
   else if(this.table==='athletics_class_sessions'){if(this.value){sessions.push({id:next('session'),attendance_recorded:false,...this.value});persist();rows=[sessions.at(-1)]}else rows=sessions}
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
  if(fn==='athletics_save_class_attendance'){
   for(const a of athletes){let att=attendance.find(r=>r.session_id===p.p_session_id&&r.athlete_id===a.id);if(!att){att={session_id:p.p_session_id,athlete_id:a.id};attendance.push(att)}att.present=p.p_present.includes(a.id)}sessions.find(s=>s.id===p.p_session_id).attendance_recorded=true;persist();return {data:p.p_present.length};
  }
  if(fn==='athletics_generate_class_heats'){
   const s=sessions.find(s=>s.id===p.p_session_id),round=Math.max(0,...heats.filter(h=>h.session_id===s.id).map(h=>h.round_no),...marks.filter(m=>m.session_id===s.id).map(m=>m.attempt_no))+1;
   const present=athletes.filter(a=>attendance.some(att=>att.session_id===s.id&&att.athlete_id===a.id&&att.present));let number=0;const created=[];
   for(const gender of p.p_mode==='gender'?['F','M']:[s.gender]){const group=present.filter(a=>gender==='All'||a.gender===gender);if(!group.length)continue;const count=p.p_heat_count||Math.ceil(group.length/p.p_capacity);for(let i=0;i<count;i++){const h={id:next('heat'),session_id:s.id,round_no:round,heat_number:++number,gender,status:'scheduled'};heats.push(h);created.push(h);group.filter((a,j)=>j%count===i).forEach((a,j)=>entries.push({id:next('entry'),heat_id:h.id,session_id:s.id,round_no:round,athlete_id:a.id,lane:j+1}))}}
   persist();return {data:structuredClone(created)};
  }
  if(fn==='athletics_save_class_heat'){
   const h=heats.find(h=>h.id===p.p_heat_id);saveMarks(h.session_id,h.round_no,p.p_results.map(r=>({athlete_id:entries.find(e=>e.id===r.id).athlete_id,mark:r.official_time,status:r.status==='finished'?'valid':r.status,notes:r.notes||''})));h.status=p.p_complete?'completed':'scheduled';persist();return {data:sheet().filter(r=>r.heat_id===h.id)};
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
  const href=await page.locator('.photo-link').first().getAttribute('href');assert.ok(href.includes('classHeat='));
  await page.evaluate(()=>{const s=testState.sessions.at(-1),h=testState.heats.find(h=>h.session_id===s.id),en=testState.entries.find(e=>e.heat_id===h.id);localStorage.setItem('ff-photo-pending-v1:class-heat:'+h.id,JSON.stringify({savedAt:Date.now(),assignments:[[en.id,12.345]]}))});
  await page.locator('.photo-link').first().click();await page.locator('#saveResultsBtn').waitFor({state:'visible'});assert.ok((await page.locator('#heatContext').textContent()).includes('CLASS'));
  await page.click('#saveResultsBtn');await page.waitForFunction(()=>document.getElementById('mode').textContent==='RESULTS SAVED');await page.click('#backBtn');await page.locator('#trackControls').waitFor({state:'visible'});
  assert.equal(await page.locator('.heat-time').first().inputValue(),'12.345');
  await page.selectOption('#heatMode','gender');await page.fill('#heatCapacity','8');await page.click('#generateHeats');await page.waitForFunction(()=>document.getElementById('roundPicker').value==='2');
  assert.equal(await page.locator('.heat-card').count(),2);assert.ok((await page.locator('#heatList').textContent()).includes('Female'));assert.ok((await page.locator('#heatList').textContent()).includes('Male'));
  await page.selectOption('#roundPicker','1');assert.equal(await page.locator('.heat-time').first().inputValue(),'12.345');
  if(!await page.locator('#sessionForm').isVisible())await page.locator('#sessionSetup summary').click();await page.selectOption('#event','relay');assert.deepEqual(await page.locator('#gender option').evaluateAll(xs=>xs.map(x=>x.value)),['M','F']);
  await page.selectOption('#gender','F');await page.fill('#title','Female relay');await page.locator('#categoryChoices input[value="Y7"]').check();await page.locator('#categoryChoices input[value="Y8"]').check();await page.click('#createSession');assert.equal(await page.locator('#attendanceList input').count(),1);await page.locator('[data-present="girl"]').check();await page.click('#saveAttendance');await page.locator('.relay-time').fill('60');await page.click('#saveRelay');await page.waitForFunction(()=>document.getElementById('message').textContent.includes('individual results saved'));
  assert.deepEqual(errors,[]);await page.screenshot({path:'/tmp/class-mode-'+viewport.width+'.png',fullPage:true});await page.close();
 }
 console.log('PASS desktop + mobile v2, attendance, class Photo Finish round-trip, gender heats and relays: mixed class, save/retry, individual gender, repeated attempts, failed-save recovery, history, chart, ranking, responsive layout');
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

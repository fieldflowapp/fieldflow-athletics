// Browser integration against an in-memory transport. Never writes competition data.
const {chromium}=require(require.resolve('playwright',{paths:process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES]:[__dirname]}));
const assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const mock=()=>{
 const athletes=[{id:'girl',first_name:'Student',last_name:'One',gender:'F',level:'Y8',color:'Blue',external_code:'TEST1',active:true},{id:'boy',first_name:'Student',last_name:'Two',gender:'M',level:'Y8',color:'Red',external_code:'TEST2',active:true}];
 const events=[{id:'event',name:'100 m',discipline:'track',category:'Y8'}];
 const sessions=[],marks=[];let sequence=0;
 window.testState={sessions,marks,failSave:false};
 class Query{
  constructor(table){this.table=table;this.filters=[];this.start=0;this.end=499}
  select(){return this}eq(k,v){this.filters.push([k,v]);return this}order(){return this}range(a,b){this.start=a;this.end=b;return this}single(){this.one=true;return this}insert(value){this.value=value;return this}
  then(resolve,reject){try{let rows;
   if(this.table==='tournaments')rows=[{id:'tournament',name:'Test tournament'}];
   else if(this.table==='athletics_athletes')rows=athletes;
   else if(this.table==='athletics_events')rows=events;
   else if(this.table==='athletics_class_sessions'){if(this.value){sessions.push({id:'session-'+(++sequence),...this.value});rows=[sessions.at(-1)]}else rows=sessions}
   else if(this.table==='athletics_class_marks')rows=marks;
   else if(this.table==='athletics_craighouse_history')rows=marks.map(m=>{const s=sessions.find(x=>x.id===m.session_id);return {...m,record_id:'class:'+m.id,event_name:'100 m',discipline:'track',unit:'s',performance_date:s.session_date,source:s.source,source_label:s.title,conditions:s.conditions,tournament_id:'tournament'}});
   else throw Error('Unexpected table: '+this.table);
   rows=rows.filter(r=>this.filters.every(([k,v])=>k==='tournament_id'||r[k]===v)).slice(this.start,this.end+1);
   return Promise.resolve({data:this.one?rows[0]:structuredClone(rows),error:null}).then(resolve,reject);
  }catch(e){return Promise.reject(e).then(resolve,reject)}}
 }
 window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'teacher'}}}}),onAuthStateChange:()=>{},signOut:async()=>{}},from:t=>new Query(t),rpc:async(fn,p)=>{
  if(fn==='is_athletics_admin')return {data:true};
  if(fn!=='athletics_save_class_marks')throw Error('Unexpected RPC');
  if(window.testState.failSave)return {error:{message:'Test network error'}};
  const result=p.p_marks.map(r=>{let m=marks.find(m=>m.athlete_id===r.athlete_id&&m.session_id===p.p_session_id&&m.attempt_no===p.p_attempt);const a=athletes.find(a=>a.id===r.athlete_id);if(!m){m={id:'mark-'+(++sequence),session_id:p.p_session_id,attempt_no:p.p_attempt,category:a.level,gender:a.gender};marks.push(m)}Object.assign(m,r);return m});return {data:structuredClone(result)};
 }})};
};
(async()=>{
 const server=http.createServer((req,res)=>{let p=path.join(root,new URL(req.url,'http://localhost').pathname);if(p.endsWith('/'))p+='index.html';if(!p.startsWith(root)){res.writeHead(403);return res.end()}fs.readFile(p,(err,data)=>{if(err){res.writeHead(404);return res.end()}res.setHeader('Content-Type',p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':p.endsWith('.png')?'image/png':'text/html');res.end(data)})}).listen(0,'127.0.0.1');
 await new Promise(r=>server.on('listening',r));let browser;try{browser=await chromium.launch({headless:true})}catch(e){server.close();throw e}
 try{
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/supabase.js',r=>r.fulfill({contentType:'application/javascript',body:'('+mock.toString()+')()'}));
  await page.route('**/app-updater.js*',r=>r.fulfill({contentType:'application/javascript',body:''}));
  await page.goto(`http://127.0.0.1:${server.address().port}/craighouse/`);
  await page.locator('#app').waitFor({state:'visible'});
  assert.equal(await page.locator('#gender').inputValue(),'All');
  await page.fill('#title','Mixed class');await page.click('#createSession');await page.locator('#sheet tr').first().waitFor();
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
  await page.click('#rankTab');await page.selectOption('#rankSource','class');await page.click('#loadRanking');await page.locator('#ranking tbody tr').first().waitFor();assert.equal(await page.locator('#ranking tbody tr').count(),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);await page.screenshot({path:'/tmp/class-mode-'+viewport.width+'.png',fullPage:true});await page.close();
 }
 console.log('PASS desktop + mobile: mixed class, save/retry, individual gender, repeated attempts, failed-save recovery, history, chart, ranking, responsive layout');
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

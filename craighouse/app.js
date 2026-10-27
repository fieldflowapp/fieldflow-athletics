'use strict';
const sb=supabase.createClient('https://qhsvvlcgwdmxxappplzh.supabase.co','sb_publishable_AzlSdUYiNA5DM7BXGOe5OA_M8wrJGoO');
const $=id=>document.getElementById(id),L=ClassLogic;
const S={tournament:null,athletes:[],events:[],sessions:[],session:null,marks:[],draft:new Map(),dirty:false,busy:false,history:[],historyToken:0,attempt:1};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const name=a=>`${a.last_name}, ${a.first_name}`;
const option=(v,t)=>`<option value="${esc(v)}">${esc(t)}</option>`;
function notice(text,type=''){ $('message').textContent=text;$('message').className=type }
async function checked(q){const {data,error}=await q;if(error)throw Error(error.message);return data}
async function allRows(make){const all=[];for(let i=0;;i+=500){const batch=await checked(make().range(i,i+499));all.push(...batch);if(batch.length<500)return all}}
function proceed(){return !S.busy&&(!S.dirty||confirm('Discard unsaved class results?'))}
window.ffCanUpdate=()=>!S.dirty&&!S.busy;
window.addEventListener('beforeunload',e=>{if(S.dirty||S.busy){e.preventDefault();e.returnValue=''}});
async function run(fn){if(S.busy)return;S.busy=true;$('app').inert=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn()}catch(e){notice(e.message,'error')}finally{S.busy=false;$('app').inert=false;document.querySelectorAll('button').forEach(b=>b.disabled=false)}}
function tab(mode,initial=false){if(!initial&&!proceed())return;S.dirty=false;S.draft.clear();for(const key of ['class','database','rank']){$(key+'Pane').hidden=key!==mode;$(key+'Tab').classList.toggle('active',key===mode)}if(mode==='database')loadHistory();if(mode==='class'&&S.session)renderSheet();location.hash=mode}
function populateEvents(){const events=[...new Map(S.events.filter(e=>e.discipline!=='relay').map(e=>[e.name,e])).values()];$('event').innerHTML=events.map(e=>option(e.id,e.name+(e.discipline==='track'?' · seconds':' · metres'))).join('');$('rankEvent').innerHTML=[...new Set(S.events.map(e=>e.name))].map(x=>option(x,x)).join('')}
async function sessions(){S.sessions=await allRows(()=>sb.from('athletics_class_sessions').select('*').eq('tournament_id',S.tournament.id).order('session_date',{ascending:false}).order('id'));$('sessionPicker').innerHTML=option('','Choose session')+S.sessions.map(s=>option(s.id,`${s.session_date} · ${s.title} · ${s.gender==='All'?'All Genders':s.gender}`)).join('');if(S.session)$('sessionPicker').value=S.session.id}
async function boot(){
 const {data:{session}}=await sb.auth.getSession();$('login').hidden=!!session;$('app').hidden=true;$('logout').hidden=!session;if(!session){notice('');return}
 S.tournament=await checked(sb.from('tournaments').select('id,name').eq('slug','intercolour-athletics-2026').single());
 const allowed=await checked(sb.rpc('is_athletics_admin',{p_tournament_id:S.tournament.id}));if(!allowed)throw Error('This module requires an Athletics administrator account.');
 [S.athletes,S.events]=await Promise.all([
 allRows(()=>sb.from('athletics_athletes').select('id,external_code,first_name,last_name,level,gender,color,active').eq('tournament_id',S.tournament.id).order('last_name').order('id')),
 allRows(()=>sb.from('athletics_events').select('id,name,discipline,category').eq('tournament_id',S.tournament.id).order('sort_order').order('id'))]);
 const levels=[...new Set(S.athletes.map(a=>a.level))].sort((a,b)=>['Y1','Y2','Y3','Y4','Y5','Y6','Y7','Y8','Intermediate','Senior'].indexOf(a)-['Y1','Y2','Y3','Y4','Y5','Y6','Y7','Y8','Intermediate','Senior'].indexOf(b));
 $('category').innerHTML=option('All','All categories')+levels.map(l=>option(l,l)).join('');$('rankCategory').innerHTML=levels.map(l=>option(l,l)).join('');
 $('date').value=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 populateEvents();athleteOptions();await sessions();$('app').hidden=false;notice('');
 const target=location.hash.slice(1);if(['database','rank'].includes(target))tab(target,true);
}
async function createSession(e){e.preventDefault();if(!proceed())return;await run(async()=>{const s=await checked(sb.from('athletics_class_sessions').insert({tournament_id:S.tournament.id,template_event_id:$('event').value,title:$('title').value.trim(),session_date:$('date').value,source:$('source').value,category:$('category').value,gender:$('gender').value,conditions:$('conditions').value.trim()}).select().single());await sessions();await openSession(s);notice('Session created. Results will be stored individually.','success')})}
async function openSession(s){
 const marks=await allRows(()=>sb.from('athletics_class_marks').select('*').eq('session_id',s.id).order('attempt_no').order('id'));
 S.session=s;S.marks=marks;S.attempt=1;S.draft.clear();S.dirty=false;$('attempt').value=1;$('sessionPicker').value=s.id;
 const event=S.events.find(e=>e.id===s.template_event_id);$('sessionSummary').innerHTML=`<h2>${esc(s.title)}</h2><p>${esc(s.session_date)} · ${esc(event.name)} · ${esc(s.category)} · <b>${s.gender==='All'?'All Genders':esc(s.gender)}</b> · ${esc(s.source)}<br>${esc(s.conditions)}</p>`;
 $('markHeading').textContent=event.discipline==='track'?'Time (seconds)':'Distance / height (m)';$('sheetControls').hidden=false;if(matchMedia('(max-width:800px)').matches)$('sessionSetup').open=false;renderSheet();
 $('sessionSummary').insertAdjacentHTML('beforeend',`<p class="muted">Record ${event.discipline==='track'?'time in seconds':'distance / height in metres'}.</p>`);
}
function renderSheet(){
 const q=$('search').value.trim().toLowerCase(),n=S.attempt;
 const athletes=S.athletes.filter(a=>L.eligible(a,S.session)&&(!q||`${name(a)} ${a.external_code}`.toLowerCase().includes(q)));
 $('sheet').innerHTML=athletes.map(a=>{const m=S.draft.get(a.id)||S.marks.find(m=>m.athlete_id===a.id&&m.attempt_no===n)||{};return `<tr data-athlete="${a.id}"><td><b>${esc(name(a))}</b><small>${esc(a.level)} · ${esc(a.external_code)}</small></td><td>${a.gender==='F'?'Girls':'Boys'}</td><td>${esc(a.color)}</td><td><select class="status" aria-label="Status for ${esc(name(a))}">${['valid','foul','dns','dnf','dq','pass'].map(v=>`<option value="${v}" ${v===(m.status||'valid')?'selected':''}>${v.toUpperCase()}</option>`).join('')}</select></td><td><input class="mark" aria-label="Mark for ${esc(name(a))}" inputmode="decimal" value="${esc(m.mark??'')}" ${m.status&&m.status!=='valid'?'disabled':''}></td><td><input class="note" aria-label="Notes for ${esc(name(a))}" maxlength="500" value="${esc(m.notes||'')}"></td></tr>`}).join('');
 $('savedStatus').textContent=`${athletes.length} athletes shown · attempt ${n}`;
}
function editRow(e){const row=e.target.closest('[data-athlete]');if(!row)return;const status=row.querySelector('.status').value,mark=row.querySelector('.mark');if(status!=='valid'){mark.value='';mark.disabled=true}else mark.disabled=false;S.draft.set(row.dataset.athlete,{status,mark:mark.value,notes:row.querySelector('.note').value});S.dirty=true}
function changeAttempt(n){if(!Number.isInteger(n)||n<1){$('attempt').value=S.attempt;notice('Choose a positive whole-number attempt.','error');return}if(!proceed()){$('attempt').value=S.attempt;return}S.attempt=n;$('attempt').value=n;S.draft.clear();S.dirty=false;renderSheet()}
async function saveMarks(){await run(async()=>{
 const payload=[];for(const [athlete_id,row] of S.draft){const mark=L.parseMark(row.mark);if(row.status==='valid'&&mark===null){if(S.marks.some(m=>m.athlete_id===athlete_id&&m.attempt_no===S.attempt))throw Error('A saved valid result cannot be blank. Enter a mark or select a status.');continue}payload.push({athlete_id,mark:row.status==='valid'?mark:null,status:row.status,notes:row.notes})}
 if(!payload.length){notice('Enter a mark or a status before saving.');return}
 const result=await checked(sb.rpc('athletics_save_class_marks',{p_session_id:S.session.id,p_attempt:S.attempt,p_marks:payload}));
 if(result.length!==payload.length)throw Error('Unable to verify every saved result. Keep this session open and retry.');
 const verified=await allRows(()=>sb.from('athletics_class_marks').select('*').eq('session_id',S.session.id).eq('attempt_no',S.attempt).order('id'));
 for(const row of payload){const match=verified.find(x=>x.athlete_id===row.athlete_id);if(!match||match.status!==row.status||String(match.mark)!==String(row.mark)||match.notes!==row.notes)throw Error('Verification failed. Your entries are retained; retry saving.')}
 S.marks=S.marks.filter(m=>m.attempt_no!==S.attempt).concat(verified);S.dirty=false;S.draft.clear();renderSheet();notice(`${payload.length} individual results saved and verified. Official competition scores are unchanged.`,'success');
})}
function athleteOptions(){const old=$('athletePicker').value,q=$('athleteSearch').value.toLowerCase().trim();$('athletePicker').innerHTML=S.athletes.filter(a=>!q||`${name(a)} ${a.external_code}`.toLowerCase().includes(q)).map(a=>option(a.id,`${name(a)} · ${a.level} · ${a.gender} · ${a.external_code||''}`)).join('');if([...$('athletePicker').options].some(o=>o.value===old))$('athletePicker').value=old}
async function loadHistory(){const token=++S.historyToken,id=$('athletePicker').value;if(!id){S.history=[];$('profile').textContent='No matching athletes.';$('history').innerHTML='';$('progress').innerHTML='';return}try{
 const rows=await allRows(()=>sb.from('athletics_craighouse_history').select('*').eq('tournament_id',S.tournament.id).eq('athlete_id',id).order('performance_date').order('record_id'));
 if(token!==S.historyToken)return;S.history=rows;const old=$('historyEvent').value;$('historyEvent').innerHTML=option('All','All events')+[...new Set(rows.map(r=>r.event_name))].map(n=>option(n,n)).join('');if([...$('historyEvent').options].some(o=>o.value===old))$('historyEvent').value=old;renderHistory();
 }catch(e){if(token===S.historyToken)notice(e.message,'error')}}
const fmt=r=>r.mark==null?'—':`${Number(r.mark).toFixed(r.unit==='s'?3:2)} ${r.unit}`;
function renderHistory(){
 const a=S.athletes.find(a=>a.id===$('athletePicker').value);if(!a)return;
 const rows=S.history.filter(r=>($('historyEvent').value==='All'||r.event_name===$('historyEvent').value)&&($('historySource').value==='All'||r.source===$('historySource').value));
 $('profile').innerHTML=`<h2>${esc(name(a))}</h2><p>${esc(a.external_code)} · ${esc(a.level)} · ${a.gender==='F'?'Girls':'Boys'} · ${esc(a.color)}</p><div class="stats"><div class="stat"><b>${rows.length}</b><span>Recorded attempts</span></div>${L.bestMarks(rows).map(r=>`<div class="stat"><b>${fmt(r)}</b><span>${esc(r.event_name)} · ${esc(r.category)} · ${esc(r.conditions||'Conditions unspecified')}<br>Personal best in this selection</span></div>`).join('')}</div>`;
 $('history').innerHTML=historyTable([...rows].reverse());
 const groups=new Map();for(const r of rows.filter(r=>r.status==='valid'&&r.mark!=null)){const k=L.comparisonKey(r);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r)}
 $('progress').innerHTML=[...groups.values()].map(chart).join('');
}
function historyTable(rows){if(!rows.length)return '<p>No results in this selection yet.</p>';return `<div class="tablewrap"><table><thead><tr><th>Date</th><th>Event</th><th>Source</th><th>Series / attempt</th><th>Mark</th><th>Status</th><th>Conditions / notes</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.performance_date)}</td><td>${esc(r.event_name)}<small>${esc(r.category)} · ${esc(r.gender)}</small></td><td>${esc(r.source)}<small>${esc(r.source_label)}</small></td><td>${r.attempt_no}</td><td>${fmt(r)}</td><td>${esc(r.status)}</td><td>${esc(r.conditions)} ${esc(r.notes)}</td></tr>`).join('')}</tbody></table></div>`}
function chart(rows){if(rows.length<2)return '';const values=rows.map(r=>Number(r.mark)),lo=Math.min(...values),hi=Math.max(...values),span=hi-lo||1;const xs=rows.map(r=>Date.parse(r.performance_date)),first=Math.min(...xs),last=Math.max(...xs);const points=rows.map((r,i)=>[50+(last===first?i/(rows.length-1):(xs[i]-first)/(last-first))*700,150-(values[i]-lo)/span*105]);const title=`${rows[0].event_name} · ${rows[0].category} · ${rows[0].gender} · ${rows[0].conditions||'Conditions unspecified'}`;return `<h3>${esc(title)}</h3><p class="muted">Progress over recorded dates · ${rows[0].unit==='s'?'Lower is better':'Higher is better'}</p><svg viewBox="0 0 800 195" role="img" aria-label="${esc(title)} progress"><text x="8" y="40" fill="#a6bdca" font-size="12">${hi.toFixed(2)}</text><text x="8" y="155" fill="#a6bdca" font-size="12">${lo.toFixed(2)}</text><polyline points="${points.map(p=>p.join(',')).join(' ')}" fill="none" stroke="#12c8ff" stroke-width="2"/>${points.map((p,i)=>`<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#18d39e"><title>${esc(rows[i].performance_date)}: ${fmt(rows[i])} (${esc(rows[i].source)})</title></circle>`).join('')}<text x="50" y="184" fill="#a6bdca" font-size="12">${esc(rows[0].performance_date)}</text><text x="750" y="184" text-anchor="end" fill="#a6bdca" font-size="12">${esc(rows.at(-1).performance_date)}</text></svg>`}
async function ranking(){await run(async()=>{
 const source=$('rankSource').value;
 const rows=await allRows(()=>{let q=sb.from('athletics_craighouse_history').select('*').eq('tournament_id',S.tournament.id).eq('event_name',$('rankEvent').value).eq('category',$('rankCategory').value).eq('gender',$('rankGender').value).eq('status','valid');if(source!=='All')q=q.eq('source',source);return q.order('record_id')});
 const groups=new Map();for(const r of L.bestMarks(rows)){const k=L.comparisonKey(r);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r)}
 $('ranking').innerHTML=[...groups.values()].map(g=>{g.sort((a,b)=>a.unit==='s'?a.mark-b.mark:b.mark-a.mark);let place=0;return `<h2>${esc(g[0].conditions||'Conditions unspecified')}</h2><p>Best recorded mark: <b>${fmt(g[0])}</b> · ${esc(source)}. This is a database best, not a ratified school record.</p><div class="tablewrap"><table><thead><tr><th>Place</th><th>Athlete</th><th>Best</th><th>Date</th><th>Source</th></tr></thead><tbody>${g.map((r,i)=>{if(!i||Number(r.mark)!==Number(g[i-1].mark))place=i+1;const a=S.athletes.find(a=>a.id===r.athlete_id);return `<tr><td>${place}</td><td>${esc(a?name(a):'Athlete')}</td><td>${fmt(r)}</td><td>${esc(r.performance_date)}</td><td>${esc(r.source)}</td></tr>`}).join('')}</tbody></table></div>`}).join('')||'<p>No valid results in this comparison group.</p>';
})}
$('loginForm').onsubmit=e=>{e.preventDefault();run(async()=>{const {error}=await sb.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw error;$('password').value='';await boot()})};
$('logout').onclick=()=>{if(proceed())run(async()=>{S.dirty=false;await sb.auth.signOut();location.reload()})};
for(const key of ['class','database','rank'])$(key+'Tab').onclick=()=>tab(key);
$('sessionForm').onsubmit=createSession;
$('openSession').onclick=()=>{const s=S.sessions.find(s=>s.id===$('sessionPicker').value);if(s&&proceed())run(()=>openSession(s))};
$('sheet').addEventListener('input',editRow);$('sheet').addEventListener('change',editRow);$('search').oninput=()=>{if(S.session)renderSheet()};
$('attempt').onchange=()=>changeAttempt(Number($('attempt').value));$('nextAttempt').onclick=()=>changeAttempt(S.attempt+1);$('saveMarks').onclick=saveMarks;
$('athleteSearch').oninput=()=>{athleteOptions();loadHistory()};$('athletePicker').onchange=loadHistory;$('historyEvent').onchange=renderHistory;$('historySource').onchange=renderHistory;$('refreshHistory').onclick=loadHistory;$('loadRanking').onclick=ranking;
sb.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){S.dirty=false;location.reload()}});
run(boot);

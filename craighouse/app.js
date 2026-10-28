'use strict';
const sb=supabase.createClient('https://qhsvvlcgwdmxxappplzh.supabase.co','sb_publishable_AzlSdUYiNA5DM7BXGOe5OA_M8wrJGoO');
const $=id=>document.getElementById(id),L=ClassLogic;
const S={tournament:null,athletes:[],events:[],sessions:[],session:null,marks:[],draft:new Map(),dirty:false,busy:false,history:[],historyToken:0,attempt:1,round:1,attendance:[],present:new Set(),attendanceSelection:new Set(),attendanceDirty:false,heats:[],series:[],heatDraft:new Map(),relayDraft:new Map(),root:null,activities:[],roundSelection:new Set(),roundSelectionKey:null,teams:[],legs:[],configDirty:false,rankSnapshot:null};
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
function tab(mode,initial=false){if(!initial&&!proceed())return;S.dirty=false;S.draft.clear();S.heatDraft.clear();S.relayDraft.clear();S.attendanceDirty=false;S.configDirty=false;S.attendanceSelection=new Set(S.attendance.filter(x=>x.present&&x.available!==false).map(x=>x.athlete_id));for(const key of ['class','database','rank']){$(key+'Pane').hidden=key!==mode;$(key+'Tab').classList.toggle('active',key===mode)}if(mode==='database')loadHistory();if(mode==='class'&&S.session)showSessionStep(S.session.attendance_recorded?'record':'attendance');location.hash=mode}
function eventForSession(){return S.events.find(e=>e.id===S.session?.template_event_id)}
function selectedCategories(){return [...document.querySelectorAll('#categoryChoices input:checked')].map(x=>x.value)}
function updateGenderOptions(){const e=S.events.find(e=>e.id===$('event').value),old=$('gender').value;const relay=e?.discipline==='relay';$('gender').innerHTML=(relay?'':option('All','All Genders'))+option('M','Male')+option('F','Female');$('gender').value=relay?(old==='F'?'F':'M'):(old||'All')}
function populateEvents(){const events=[...new Map(S.events.map(e=>[e.name,e])).values()];$('event').innerHTML=events.map(e=>option(e.id,e.name+(e.discipline==='field'?' · metres':' · seconds'))).join('');$('rankEvent').innerHTML=[...new Set(S.events.map(e=>e.name))].map(x=>option(x,x)).join('');updateGenderOptions()}
async function sessions(){S.sessions=await allRows(()=>sb.from('athletics_class_sessions').select('*').eq('tournament_id',S.tournament.id).order('session_date',{ascending:false}).order('id'));$('sessionPicker').innerHTML=option('','Choose session')+S.sessions.filter(s=>!s.parent_session_id).map(s=>option(s.id,`${s.session_date} · ${s.title} · ${s.gender==='All'?'All Genders':s.gender}`)).join('');if(S.session)$('sessionPicker').value=S.session.parent_session_id||S.session.id}
async function boot(){
 const {data:{session}}=await sb.auth.getSession();$('login').hidden=!!session;$('app').hidden=true;$('logout').hidden=!session;if(!session){notice('');return}
 S.tournament=await checked(sb.from('tournaments').select('id,name').eq('slug','intercolour-athletics-2026').single());
 const allowed=await checked(sb.rpc('is_athletics_admin',{p_tournament_id:S.tournament.id}));if(!allowed)throw Error('This module requires an Athletics administrator account.');
 [S.athletes,S.events]=await Promise.all([
 allRows(()=>sb.from('athletics_athletes').select('id,external_code,first_name,last_name,level,gender,color,active').eq('tournament_id',S.tournament.id).order('last_name').order('id')),
 allRows(()=>sb.from('athletics_events').select('id,name,discipline,category,start_mode').eq('tournament_id',S.tournament.id).order('sort_order').order('id'))]);
 const levels=[...new Set(S.athletes.map(a=>a.level))].sort((a,b)=>['Y1','Y2','Y3','Y4','Y5','Y6','Y7','Y8','Intermediate','Senior'].indexOf(a)-['Y1','Y2','Y3','Y4','Y5','Y6','Y7','Y8','Intermediate','Senior'].indexOf(b));
 $('categoryChoices').innerHTML=levels.map(l=>`<label><input type="checkbox" value="${esc(l)}">${esc(l)}</label>`).join('');$('rankCategory').innerHTML=levels.map(l=>option(l,l)).join('');
 $('date').value=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 populateEvents();athleteOptions();await sessions();$('app').hidden=false;notice('');
 const target=location.hash.slice(1);if(['database','rank'].includes(target))tab(target,true);
 const requested=S.sessions.find(s=>s.id===new URLSearchParams(location.search).get('session'));if(requested)await openSession(requested);
}
async function createSession(e){e.preventDefault();if(!proceed())return;await run(async()=>{const categories=selectedCategories();if(!categories.length)throw Error('Select at least one category.');const s=await checked(sb.from('athletics_class_sessions').insert({tournament_id:S.tournament.id,template_event_id:$('event').value,title:$('title').value.trim(),session_date:$('date').value,source:$('source').value,category:categories.length===1?categories[0]:'All',categories,gender:$('gender').value,conditions:$('conditions').value.trim(),timing_method:S.events.find(e=>e.id===$('event').value).discipline==='field'?'not_applicable':'manual'}).select().single());await sessions();await openSession(s);notice('Session created. Select the students present to continue.','success')})}
async function loadSessionData(){
 const id=S.session.id;S.root=S.sessions.find(s=>s.id===(S.session.parent_session_id||id))||S.session;S.activities=S.sessions.filter(s=>s.id===S.root.id||s.parent_session_id===S.root.id);
 [S.marks,S.attendance,S.heats,S.series,S.teams,S.legs]=await Promise.all([
 allRows(()=>sb.from('athletics_class_marks').select('*').eq('session_id',id).order('attempt_no').order('id')),
 allRows(()=>sb.from('athletics_class_attendance').select('*').eq('session_id',id).order('athlete_id')),
 allRows(()=>sb.from('athletics_class_heats').select('*').eq('session_id',id).order('round_no').order('heat_number')),
 allRows(()=>sb.from('athletics_class_series_sheet').select('*').eq('session_id',id).order('round_no').order('id')),
 allRows(()=>sb.from('athletics_class_relay_teams').select('*').eq('session_id',id).order('attempt_no').order('id')),
 allRows(()=>sb.from('athletics_class_relay_legs').select('*').eq('session_id',id).order('attempt_no').order('leg_order'))]);
 S.present=new Set(S.attendance.filter(x=>x.present).map(x=>x.athlete_id));S.attendanceSelection=new Set(S.attendance.filter(x=>x.present&&x.available!==false).map(x=>x.athlete_id));
}
async function openSession(s){
 const previous=S.session;S.session=s;try{await loadSessionData()}catch(e){S.session=previous;throw e}
 S.attempt=1;S.draft.clear();S.heatDraft.clear();S.relayDraft.clear();S.dirty=false;S.attendanceDirty=false;S.configDirty=false;$('attempt').value=1;$('relayAttempt').value=1;$('sessionPicker').value=S.root.id;
 const event=eventForSession();$('trackTimeFormat').value=L.usesClock(event)?'clock':'seconds';$('relayTimeFormat').value='clock';S.trackFormat=$('trackTimeFormat').value;S.relayFormat='clock';$('sessionSummary').innerHTML=`<h2>${esc(s.title)}</h2><p>${esc(s.session_date)} · ${esc(event.name)} · ${esc(s.categories?.join(' + ')||s.category)} · <b>${s.gender==='All'?'All Genders':s.gender==='F'?'Female':'Male'}</b> · ${esc(s.source)}<br>${esc(s.conditions)}</p>`;
 $('markHeading').textContent='Distance / height (m)';$('sessionSteps').hidden=false;if(matchMedia('(max-width:800px)').matches)$('sessionSetup').open=false;
 $('heatCapacity').value=event.start_mode==='mass_start'?25:8;
 $('heatMode').value=s.gender==='All'?'mixed':'gender';
 const rounds=[...new Set(S.heats.map(h=>h.round_no))];S.round=Number(new URLSearchParams(location.search).get('round'))||rounds.at(-1)||1;
 $('attendanceSearch').value='';$('attendanceGender').value='All';$('attendanceColour').innerHTML=option('All','All colours')+[...new Set(S.athletes.filter(a=>L.eligible(a,s)).map(a=>a.color).filter(Boolean))].sort().map(c=>option(c,c)).join('');renderActivityControls();showSessionStep(S.root.closed_at?'summary':s.attendance_recorded?'record':'attendance');
 const url=new URL(location.href);url.searchParams.set('session',s.id);history.replaceState(null,'',url);
}
function showSessionStep(step){
 $('summaryPane').hidden=step!=='summary';$('activityControls').hidden=step==='summary';$('summaryStepBtn').classList.toggle('active',step==='summary');$('attendancePane').hidden=step!=='attendance';for(const id of ['trackControls','relayControls','sheetControls'])$(id).hidden=true;
 $('attendanceStepBtn').classList.toggle('active',step==='attendance');$('recordStepBtn').classList.toggle('active',step==='record');
 if(step==='summary'){renderSessionReview();return}if(S.root.closed_at){showSessionStep('summary');notice('Session closed. Reopen it from the summary to make changes.');return}
 if(step==='attendance'){renderAttendance();return}
 if(!S.session.attendance_recorded||S.attendanceDirty){showSessionStep('attendance');notice('Save present students before opening results.','error');return}
 const type=eventForSession().discipline;if(type==='track'){$('trackControls').hidden=false;renderHeats()}else if(type==='relay'){$('relayControls').hidden=false;renderRelay()}else{$('sheetControls').hidden=false;renderSheet()}
}
function eligibleAttendance(){const q=$('attendanceSearch').value.toLowerCase().trim();return S.athletes.filter(a=>L.attendanceMatches(a,S.session,{query:q,gender:$('attendanceGender').value,color:$('attendanceColour').value}))}
function renderAttendance(){
 $('attendanceList').innerHTML=eligibleAttendance().map(a=>`<label class="attendance-student"><input type="checkbox" data-present="${a.id}" ${S.attendanceSelection.has(a.id)?'checked':''}><span><b>${esc(name(a))}</b><small>${esc(a.level)} · ${a.gender==='F'?'Female':'Male'} · ${esc(a.color)} · ${esc(a.external_code)}</small></span></label>`).join('');
 $('attendanceCount').textContent=`${eligibleAttendance().length} shown · ${S.attendanceSelection.size} selected for this event`;
}
function setDirty(){S.dirty=S.attendanceDirty||S.draft.size>0||S.heatDraft.size>0||S.relayDraft.size>0||S.configDirty}
async function saveAttendance(){await run(async()=>{
 const desired=[...S.attendanceSelection];const count=await checked(sb.rpc('athletics_save_class_attendance',{p_session_id:S.session.id,p_present:desired}));
 await loadSessionData();const verified=new Set(S.attendance.filter(r=>r.present&&r.available!==false).map(r=>r.athlete_id));
 if(verified.size!==desired.length||desired.some(id=>!verified.has(id)))throw Error('Attendance verification failed. Retry before continuing.');
 S.session.attendance_recorded=true;const stored=S.sessions.find(s=>s.id===S.session.id);if(stored)stored.attendance_recorded=true;S.roundSelectionKey=null;S.attendanceDirty=false;setDirty();showSessionStep('record');notice(`${count} available students saved for this event. Other event attendance is unchanged.`, 'success');
})}
function presentAthletes(){return S.athletes.filter(a=>S.attendance.some(x=>x.athlete_id===a.id&&x.present&&x.available!==false)||S.marks.some(m=>m.athlete_id===a.id&&m.attempt_no===S.attempt))}
function renderSheet(){
 const q=$('search').value.trim().toLowerCase(),n=S.attempt;
 const athletes=presentAthletes().filter(a=>!q||`${name(a)} ${a.external_code}`.toLowerCase().includes(q));
 $('sheet').innerHTML=athletes.map(a=>{const m=S.draft.get(a.id)||S.marks.find(m=>m.athlete_id===a.id&&m.attempt_no===n)||{};return `<tr data-athlete="${a.id}"><td><b>${esc(name(a))}</b><small>${esc(a.level)} · ${esc(a.external_code)}</small></td><td>${a.gender==='F'?'Girls':'Boys'}</td><td>${esc(a.color)}</td><td><select class="status" aria-label="Status for ${esc(name(a))}">${['valid','foul','dns','dnf','dq','pass'].map(v=>`<option value="${v}" ${v===(m.status||'valid')?'selected':''}>${v.toUpperCase()}</option>`).join('')}</select></td><td><input class="mark" aria-label="Mark for ${esc(name(a))}" inputmode="decimal" value="${esc(m.mark??'')}" ${m.status&&m.status!=='valid'?'disabled':''}></td><td><input class="note" aria-label="Notes for ${esc(name(a))}" maxlength="500" value="${esc(m.notes||'')}">${markConditionInputs(m)}</td></tr>`}).join('');
 $('savedStatus').textContent=`${athletes.length} present athletes shown · attempt ${n}`;
}
function editRow(e){const row=e.target.closest('[data-athlete]');if(!row)return;const status=row.querySelector('.status').value,mark=row.querySelector('.mark');if(status!=='valid'){mark.value='';mark.disabled=true}else mark.disabled=false;S.draft.set(row.dataset.athlete,{status,mark:mark.value,notes:row.querySelector('.note').value,...readMarkConditions(row)});setDirty()}
function changeAttempt(n){if(!Number.isInteger(n)||n<1){$('attempt').value=S.attempt;$('relayAttempt').value=S.attempt;notice('Choose a positive whole-number attempt.','error');return}if(!proceed()){$('attempt').value=S.attempt;$('relayAttempt').value=S.attempt;return}S.attempt=n;$('attempt').value=n;$('relayAttempt').value=n;S.draft.clear();S.relayDraft.clear();S.configDirty=false;setDirty();if(eventForSession().discipline==='relay')renderRelay();else renderSheet()}
async function saveIndividualPayload(payload){
 if(!payload.length)throw Error('Enter a mark or a status before saving.');
 const result=await checked(sb.rpc('athletics_save_class_marks',{p_session_id:S.session.id,p_attempt:S.attempt,p_marks:payload}));
 if(result.length!==payload.length)throw Error('Unable to verify every saved result. Keep this session open and retry.');
 const verified=await allRows(()=>sb.from('athletics_class_marks').select('*').eq('session_id',S.session.id).eq('attempt_no',S.attempt).order('id'));
 for(const row of payload){const match=verified.find(x=>x.athlete_id===row.athlete_id);if(!match||match.status!==row.status||String(match.mark)!==String(row.mark)||match.notes!==row.notes)throw Error('Verification failed. Your entries are retained; retry saving.')}
 S.marks=S.marks.filter(m=>m.attempt_no!==S.attempt).concat(verified);S.draft.clear();S.relayDraft.clear();setDirty();notice(`${payload.length} individual results saved and verified. Official competition scores are unchanged.`,'success');
}
async function saveMarks(){await run(async()=>{
 const payload=[];for(const [athlete_id,row] of S.draft){const mark=L.parseMark(row.mark);if(row.status==='valid'&&mark===null){if(S.marks.some(m=>m.athlete_id===athlete_id&&m.attempt_no===S.attempt))throw Error('A saved valid result cannot be blank. Enter a mark or select a status.');continue}payload.push({athlete_id,mark:row.status==='valid'?mark:null,status:row.status,notes:row.notes,timing_method:row.timing_method,implement_kg:row.implement_kg,conditions:row.conditions})}
 await saveIndividualPayload(payload);renderSheet();
})}
function renderHeats(){
 renderRoundParticipants();
 const rounds=[...new Set(S.heats.map(h=>h.round_no))];if(!rounds.includes(S.round))S.round=rounds.at(-1)||1;$('roundPicker').innerHTML=rounds.map(r=>option(r,'Round '+r)).join('');$('roundPicker').value=S.round;
 $('heatList').innerHTML=S.heats.filter(h=>h.round_no===S.round).map(h=>{
 const entries=S.series.filter(x=>x.heat_id===h.id).sort((a,b)=>a.lane-b.lane);
 const back='../craighouse/?session='+encodeURIComponent(S.session.id)+'&round='+h.round_no+'#class';const href='../photo-finish/?classHeat='+encodeURIComponent(h.id)+'&return='+encodeURIComponent(back);
 return `<article class="heat-card"><h3>Series ${h.heat_number} · ${h.gender==='All'?'Mixed':h.gender==='F'?'Female':'Male'} <small>${esc(h.status)}</small></h3><a class="photo-link" href="${href}">Open Photo Finish</a><div class="heat-runners">${entries.map(en=>{const d=S.heatDraft.get(en.id);return `<div class="heat-runner" data-heat-entry="${en.id}"><div><b>Lane ${en.lane} · ${esc(en.last_name)}, ${esc(en.first_name)}</b><small>${esc(en.level)} · ${en.gender==='F'?'Female':'Male'} · ${esc(en.color)}</small></div><label>Status<select class="heat-status">${['scheduled','finished','dns','dnf','dq'].map(v=>`<option value="${v}" ${v===(d?.status||en.status)?'selected':''}>${v.toUpperCase()}</option>`).join('')}</select></label>${timeInput('heat-time',d?d.official_time:en.official_time,!!d,$('trackTimeFormat').value)}<label>Timing<select class="heat-timing">${timingOptions(d?.timing_method||S.marks.find(m=>m.athlete_id===en.athlete_id&&m.attempt_no===en.round_no)?.timing_method||S.session.timing_method||'manual')}</select></label></div>`}).join('')}</div><div class="filters"><button class="save-heat primary" data-heat="${h.id}">Save times</button><button class="complete-heat" data-heat="${h.id}">Complete series</button></div></article>`
 }).join('')||'<p>No series yet. Create a round from the present students.</p>';
 renderSeriesEditor();
 document.querySelectorAll('.save-heat').forEach(b=>b.onclick=()=>saveHeat(b.dataset.heat,false));document.querySelectorAll('.complete-heat').forEach(b=>b.onclick=()=>saveHeat(b.dataset.heat,true));
 document.querySelectorAll('.photo-link').forEach(a=>a.onclick=e=>{if(!proceed())e.preventDefault();else S.dirty=false});
}
async function generateHeats(){if(!proceed())return;await run(async()=>{
 const capacity=Number($('heatCapacity').value),count=Number($('heatCount').value);if(!Number.isInteger(capacity)||capacity<1||capacity>1000||!Number.isInteger(count)||count<0)throw Error('Choose valid series settings.');
 const rows=await checked(sb.rpc('athletics_generate_class_heats',{p_session_id:S.session.id,p_mode:$('heatMode').value,p_capacity:capacity,p_heat_count:count,p_athletes:[...S.roundSelection]}));
 S.round=rows[0].round_no;S.heatDraft.clear();await loadSessionData();setDirty();renderHeats();notice(`${rows.length} series created in round ${S.round}. Previous results are preserved.`,'success');
})}
function editHeat(e){const row=e.target.closest('[data-heat-entry]');if(!row)return;const status=row.querySelector('.heat-status');const input=row.querySelector('.heat-time');if(e.target===input&&input.value.trim()&&status.value==='scheduled')status.value='finished';if(['dns','dnf','dq'].includes(status.value))input.value='';S.heatDraft.set(row.dataset.heatEntry,{status:status.value,official_time:timeInputValue(input),timing_method:row.querySelector('.heat-timing').value});setDirty()}
async function saveHeat(id,complete){await run(async()=>{
 const entries=S.series.filter(en=>en.heat_id===id),payload=[];
 for(const en of entries){const row=S.heatDraft.get(en.id);if(!row)continue;const value=L.parseTime(row.official_time);if(row.status==='scheduled')throw Error('Select Finished, DNS, DNF or DQ for an edited runner.');if(row.status==='finished'&&value==null)throw Error('A finished runner needs a time.');payload.push({id:en.id,official_time:row.status==='finished'?value:null,status:row.status,notes:'Class heat · '+row.timing_method,timing_method:row.timing_method})}
 if(!payload.length&&!complete){notice('No edited times to save.');return}
 const verified=await checked(sb.rpc('athletics_save_class_heat',{p_heat_id:id,p_results:payload,p_complete:complete}));
 for(const row of payload){const saved=verified.find(x=>x.id===row.id);if(!saved||saved.status!==row.status||String(saved.official_time)!==String(row.official_time))throw Error('Could not verify saved times. Your entries are retained.');}
 for(const en of entries)S.heatDraft.delete(en.id);await loadSessionData();setDirty();renderHeats();notice(complete?'Series completed.':'Times saved to individual class histories.','success');
})}
function athleteOptions(){const old=$('athletePicker').value,q=$('athleteSearch').value.toLowerCase().trim();$('athletePicker').innerHTML=S.athletes.filter(a=>!q||`${name(a)} ${a.external_code}`.toLowerCase().includes(q)).map(a=>option(a.id,`${name(a)} · ${a.level} · ${a.gender} · ${a.external_code||''}`)).join('');if([...$('athletePicker').options].some(o=>o.value===old))$('athletePicker').value=old}
async function loadHistory(){const token=++S.historyToken,id=$('athletePicker').value;if(!id){S.history=[];$('profile').textContent='No matching athletes.';$('history').innerHTML='';$('progress').innerHTML='';return}try{
 const rows=await allRows(()=>sb.from('athletics_craighouse_history').select('*').eq('tournament_id',S.tournament.id).eq('athlete_id',id).order('performance_date').order('record_id'));
 if(token!==S.historyToken)return;S.history=rows;const old=$('historyEvent').value;$('historyEvent').innerHTML=option('All','All events')+[...new Set(rows.map(r=>r.event_name))].map(n=>option(n,n)).join('');if([...$('historyEvent').options].some(o=>o.value===old))$('historyEvent').value=old;renderHistory();
 }catch(e){if(token===S.historyToken)notice(e.message,'error')}}
const fmt=r=>r.mark==null?'—':r.unit==='s'&&L.usesClock(r)?L.formatTime(r.mark):`${Number(r.mark).toFixed(r.unit==='s'?3:2)} ${r.unit}`;
function renderHistory(){
 const a=S.athletes.find(a=>a.id===$('athletePicker').value);if(!a)return;
 const rows=S.history.filter(r=>($('historyEvent').value==='All'||r.event_name===$('historyEvent').value)&&($('historySource').value==='All'||r.source===$('historySource').value));
 $('profile').innerHTML=`<h2>${esc(name(a))}</h2><p>${esc(a.external_code)} · ${esc(a.level)} · ${a.gender==='F'?'Girls':'Boys'} · ${esc(a.color)}</p><div class="stats"><div class="stat"><b>${rows.length}</b><span>Recorded attempts</span></div>${L.bestMarks(rows).map(r=>`<div class="stat"><b>${fmt(r)}</b><span>${esc(r.event_name)} · ${esc(r.category)} · ${esc(r.conditions||'Conditions unspecified')}<br>Personal best in this selection</span></div>`).join('')}</div>`;
 $('history').innerHTML=historyTable([...rows].reverse());
 const groups=new Map();for(const r of rows.filter(r=>r.status==='valid'&&r.mark!=null)){const k=L.comparisonKey(r);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r)}
 $('progress').innerHTML=[...groups.values()].map(chart).join('');
}
function historyTable(rows){if(!rows.length)return '<p>No results in this selection yet.</p>';return `<div class="tablewrap"><table><thead><tr><th>Date</th><th>Event</th><th>Source</th><th>Series / attempt</th><th>Mark</th><th>Status</th><th>Conditions / notes</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.performance_date)}</td><td>${esc(r.event_name)}<small>${esc(r.category)} · ${esc(r.gender)}</small></td><td>${esc(r.source)}<small>${esc(r.source_label)}</small></td><td>${r.attempt_no}</td><td>${fmt(r)}</td><td>${esc(r.status)}</td><td>${esc(r.conditions)} ${esc(r.notes)}</td></tr>`).join('')}</tbody></table></div>`}
function chart(rows){if(rows.length<2)return '';const values=rows.map(r=>Number(r.mark)),lo=Math.min(...values),hi=Math.max(...values),span=hi-lo||1;const xs=rows.map(r=>Date.parse(r.performance_date)),first=Math.min(...xs),last=Math.max(...xs);const points=rows.map((r,i)=>[50+(last===first?i/(rows.length-1):(xs[i]-first)/(last-first))*700,150-(values[i]-lo)/span*105]);const title=`${rows[0].event_name} · ${rows[0].category} · ${rows[0].gender} · ${rows[0].conditions||'Conditions unspecified'}`;return `<h3>${esc(title)}</h3><p class="muted">Progress over recorded dates · ${rows[0].unit==='s'?'Lower is better':'Higher is better'}</p><svg viewBox="0 0 800 195" role="img" aria-label="${esc(title)} progress"><text x="8" y="40" fill="#a6bdca" font-size="12">${rows[0].unit==='s'&&L.usesClock(rows[0])?L.formatTime(hi):hi.toFixed(2)}</text><text x="8" y="155" fill="#a6bdca" font-size="12">${rows[0].unit==='s'&&L.usesClock(rows[0])?L.formatTime(lo):lo.toFixed(2)}</text><polyline points="${points.map(p=>p.join(',')).join(' ')}" fill="none" stroke="#12c8ff" stroke-width="2"/>${points.map((p,i)=>`<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#18d39e"><title>${esc(rows[i].performance_date)}: ${fmt(rows[i])} (${esc(rows[i].source)})</title></circle>`).join('')}<text x="50" y="184" fill="#a6bdca" font-size="12">${esc(rows[0].performance_date)}</text><text x="750" y="184" text-anchor="end" fill="#a6bdca" font-size="12">${esc(rows.at(-1).performance_date)}</text></svg>`}
async function ranking(){await run(async()=>{
 const source=$('rankSource').value;S.rankSnapshot=null;
 const rows=await allRows(()=>{let q=sb.from('athletics_craighouse_history').select('*').eq('tournament_id',S.tournament.id).eq('event_name',$('rankEvent').value).eq('category',$('rankCategory').value).eq('gender',$('rankGender').value).eq('status','valid');if(source!=='All')q=q.eq('source',source);return q.order('record_id')});
 const groups=new Map();for(const r of L.bestMarks(rows)){const k=L.comparisonKey(r);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r)}
 $('ranking').innerHTML=[...groups.values()].map(g=>{g.sort((a,b)=>a.unit==='s'?a.mark-b.mark:b.mark-a.mark);let place=0;return `<h2>${esc(g[0].conditions||'Conditions unspecified')}</h2><p>Best recorded mark: <b>${fmt(g[0])}</b> · ${esc(source)}. This is a database best, not a ratified school record.</p><div class="tablewrap"><table><thead><tr><th>Place</th><th>Athlete</th><th>Best</th><th>Date</th><th>Source</th></tr></thead><tbody>${g.map((r,i)=>{if(!i||Number(r.mark)!==Number(g[i-1].mark))place=i+1;const a=S.athletes.find(a=>a.id===r.athlete_id);return `<tr><td>${place}</td><td>${esc(a?name(a):'Athlete')}</td><td>${fmt(r)}</td><td>${esc(r.performance_date)}</td><td>${esc(r.source)}</td></tr>`}).join('')}</tbody></table></div>`}).join('')||'<p>No valid results in this comparison group.</p>';
S.rankSnapshot={html:$('ranking').innerHTML,event:$('rankEvent').selectedOptions[0]?.textContent||'',category:$('rankCategory').value,gender:$('rankGender').selectedOptions[0]?.textContent||'',source:$('rankSource').selectedOptions[0]?.textContent||''};
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
$('event').onchange=updateGenderOptions;
$('attendanceSearch').oninput=renderAttendance;$('attendanceGender').onchange=renderAttendance;$('attendanceColour').onchange=renderAttendance;
$('attendanceList').onchange=e=>{const id=e.target.dataset.present;if(!id)return;if(e.target.checked)S.attendanceSelection.add(id);else S.attendanceSelection.delete(id);S.attendanceDirty=true;setDirty();$('attendanceCount').textContent=S.attendanceSelection.size+' present selected'};
for(const [id,checked] of [['selectPresent',true],['clearPresent',false]])$(id).onclick=()=>{for(const a of eligibleAttendance()){if(checked)S.attendanceSelection.add(a.id);else S.attendanceSelection.delete(a.id)}S.attendanceDirty=true;setDirty();renderAttendance()};
$('saveAttendance').onclick=saveAttendance;
$('attendanceStepBtn').onclick=()=>{if(proceed()){S.draft.clear();S.heatDraft.clear();S.relayDraft.clear();S.configDirty=false;setDirty();showSessionStep('attendance')}};
$('recordStepBtn').onclick=()=>{if(S.attendanceDirty){notice('Save present students before continuing.','error');return}showSessionStep('record')};
$('generateHeats').onclick=generateHeats;
$('roundPicker').onchange=()=>{if(!proceed()){$('roundPicker').value=S.round;return}S.round=Number($('roundPicker').value);S.heatDraft.clear();setDirty();renderHeats()};
$('refreshSeries').onclick=()=>{if(proceed())run(async()=>{S.heatDraft.clear();await loadSessionData();setDirty();renderHeats()})};
$('heatList').addEventListener('input',editHeat);$('heatList').addEventListener('change',editHeat);
$('relayRows').addEventListener('input',e=>editRelay(e));$('relayRows').addEventListener('change',e=>editRelay(e));
$('relayAttempt').onchange=()=>changeAttempt(Number($('relayAttempt').value));$('nextRelayAttempt').onclick=()=>changeAttempt(S.attempt+1);$('saveRelay').onclick=()=>saveRelay();
window.addEventListener('pageshow',e=>{if(e.persisted&&S.session&&!S.dirty)run(async()=>{await loadSessionData();showSessionStep('record')})});

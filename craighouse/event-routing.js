'use strict';
// Class Mode event-first navigation; existing saved sessions remain the storage identity.
(function(){
 const route=$('eventRoute'),chooser=$('eventChooser'),setup=$('eventSetupRoute'),previous=$('previousRoute');
 let selectedEvent=null,discipline='track',historyLimit=30;
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const normalize=x=>String(x).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const routeTo=(page,addHistory=true)=>{

  chooser.hidden=page!=='choose';setup.hidden=page!=='setup';previous.hidden=page!=='previous';
  route.hidden=page==='workspace';
  $('sessionHome').hidden=true;
  $('sessionWorkspace').hidden=page!=='workspace';
  document.body.classList.toggle('class-event-home',page!=='workspace');
  document.body.classList.toggle('class-event-workspace',page==='workspace');
  if(page!=='workspace'){S.sessionHome=true;document.body.classList.remove('session-open','heat-focus');}
  if(addHistory){const url=new URL(location.href);url.searchParams.delete('session');url.searchParams.delete('focusHeat');url.searchParams.delete('round');url.searchParams.set('classRoute',page);history.pushState({classRoute:page},'',url);}
  lastRoute=location.href;window.scrollTo(0,0);
 };
 const groups=()=>[...new Map(S.events.map(e=>[e.name,e])).values()];
 const renderEvents=()=>{
  document.querySelectorAll('.class-event-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.discipline===discipline));
  $('eventTiles').innerHTML=groups().filter(e=>e.discipline===discipline).map(e=>'<button type="button" class="class-event-tile" data-event="'+esc(e.id)+'"><span><b>'+esc(e.name)+'</b><small>'+esc(e.discipline==='field'?'Distance / height':e.discipline==='relay'?'Team time':'Running times')+'</small></span><span>›</span></button>').join('')||'<p>No events available.</p>';
  $('eventTiles').querySelectorAll('[data-event]').forEach(b=>b.onclick=()=>selectEvent(b.dataset.event));
 };
 const selectEvent=id=>{
  selectedEvent=S.events.find(e=>e.id===id);if(!selectedEvent)return;
  $('event').value=id;updateGenderOptions();
  $('chosenEventTitle').textContent=selectedEvent.name;
  const years=[...document.querySelectorAll('#categoryChoices input')].map(x=>x.value);
  $('quickYears').innerHTML=years.map(l=>'<label><input type="checkbox" value="'+esc(l)+'">'+esc(l)+'</label>').join('');
  $('quickGender').value=selectedEvent.discipline==='relay'?'M':'All';
  $('quickGender').querySelector('option[value="All"]').disabled=selectedEvent.discipline==='relay';
  $('quickDate').value=today();
  $('routeHeading').textContent='Set up event';$('routeHint').textContent='Choose the Years, then add athletes.';
  routeTo('setup');
 };
 const renderPrevious=()=>{
  const old=$('previousYear').value,years=[...new Set(S.athletes.map(a=>a.level))];$('previousYear').innerHTML=option('All','All Years')+years.map(y=>option(y,y)).join('');$('previousYear').value=years.includes(old)?old:'All';
  const q=normalize($('previousSearch').value.trim()),year=$('previousYear').value,gender=$('previousGender').value,from=$('previousFrom').value,to=$('previousTo').value,status=$('previousStatus').value;
  const root=s=>S.sessions.find(r=>r.id===(s.parent_session_id||s.id))||s;
  const rows=S.sessions.filter(s=>{
   const name=S.events.find(e=>e.id===s.template_event_id)?.name||'';
   return normalize([name,s.title,s.session_date,...(s.categories||[s.category])].join(' ')).includes(q)&&(year==='All'||(s.categories||[s.category]).includes(year))&&(gender==='All'||s.gender===(gender==='mixed'?'All':gender))&&(!from||s.session_date>=from)&&(!to||s.session_date<=to)&&(status==='All'||!!root(s).closed_at===(status==='closed'));
  }).sort((a,b)=>b.session_date.localeCompare(a.session_date)||a.id.localeCompare(b.id));
  $('previousCount').textContent=from&&to&&from>to?'Choose an end date on or after the start date.':`${rows.length} saved events`;
  $('previousTiles').innerHTML=rows.slice(0,historyLimit).map(s=>`<article class="past-event"><button class="class-event-tile" data-old="${esc(s.id)}"><span><b>${esc(S.events.find(e=>e.id===s.template_event_id)?.name||s.title)}</b><small>${esc(s.session_date+' · '+(s.categories?.join(' + ')||s.category)+' · '+(s.gender==='F'?'Girls':s.gender==='M'?'Boys':'Mixed'))}</small><small>${esc(s.title)} · ${root(s).closed_at?'Closed':'Open'}</small></span><span>›</span></button>${root(s).closed_at?`<button class="reopen-event" data-reopen="${s.id}">Reopen to add results</button>`:''}</article>`).join('')||'<p>No matching saved events. Try other filters.</p>';
  $('previousMore').hidden=rows.length<=historyLimit;
  $('previousTiles').querySelectorAll('[data-old]').forEach(b=>b.onclick=()=>{const session=S.sessions.find(s=>s.id===b.dataset.old);if(session&&proceed())run(()=>openSession(session));});
  $('previousTiles').querySelectorAll('[data-reopen]').forEach(b=>b.onclick=()=>run(async()=>{
   const session=S.sessions.find(s=>s.id===b.dataset.reopen),parent=root(session);
   const saved=await checked(sb.from('athletics_class_sessions').update({closed_at:null}).eq('id',parent.id).select().single());Object.assign(parent,saved);await openSession(session);notice('Reopened for late results. The original event date is preserved.','success');
  }));
 };
 for(const id of ['previousSearch','previousYear','previousGender','previousFrom','previousTo','previousStatus'])$(id).addEventListener(id==='previousSearch'?'input':'change',()=>{historyLimit=30;renderPrevious()});
 $('previousClear').onclick=()=>{for(const id of ['previousSearch','previousFrom','previousTo'])$(id).value='';for(const id of ['previousYear','previousGender','previousStatus'])$(id).value='All';historyLimit=30;renderPrevious()};
 $('previousMore').onclick=()=>{historyLimit+=30;renderPrevious()};
 $('previousRefresh').onclick=()=>run(async()=>{await sessions();renderPrevious()});
 document.querySelectorAll('.class-event-tabs button').forEach(b=>b.onclick=()=>{discipline=b.dataset.discipline;renderEvents();});
 $('previousEvents').onclick=()=>{renderPrevious();$('routeHeading').textContent='Previous events';$('routeHint').textContent='Reopen an event and add late results.';routeTo('previous');};
 $('previousSearch').oninput=renderPrevious;
 const home=()=>{if(!proceed())return;clearClassDrafts();S.session=null;S.sessionHome=true;selectedEvent=null;$('routeHeading').textContent='Select event';$('routeHint').textContent='Choose a discipline to record a class performance.';renderEvents();routeTo('choose');};
 $('backToEvents').onclick=home;$('backFromPrevious').onclick=home;
 $('quickEventForm').onsubmit=e=>{
  e.preventDefault();
  if(!selectedEvent)return;
  const years=[...$('quickYears').querySelectorAll('input:checked')].map(x=>x.value);
  if(!years.length){notice('Choose at least one Year.','error');return;}
  document.querySelectorAll('#categoryChoices input').forEach(x=>x.checked=years.includes(x.value));
  $('gender').value=$('quickGender').value;$('date').value=$('quickDate').value;
  $('title').value=selectedEvent.name+' · '+years.join(' + ')+' · '+($('gender').value==='F'?'Girls':$('gender').value==='M'?'Boys':'Mixed');
  $('source').value='class';$('conditions').value='';
  createSession(e);
 };
 const originalOpen=openSession;
 openSession=async function(session){await originalOpen(session);routeTo('workspace',false);const u=new URL(location.href);u.searchParams.delete('classRoute');u.searchParams.set('session',session.id);history.replaceState({classRoute:'workspace'},'',u);lastRoute=location.href;};
 $('sessionsBack').onclick=home;
 const originalSync=syncWorkspace;
 syncWorkspace=function(){originalSync();if(S.session&&!S.sessionHome){route.hidden=true;$('sessionHome').hidden=true;$('sessionWorkspace').hidden=false;}else{$('sessionWorkspace').hidden=true;$('sessionHome').hidden=true;}};
 let lastRoute=location.href;
 window.addEventListener('popstate',()=>{
  if(!proceed()){history.pushState(null,'',lastRoute);return}clearClassDrafts();
  const url=new URL(location.href),page=url.searchParams.get('classRoute'),saved=S.sessions.find(s=>s.id===url.searchParams.get('session'));
  if(saved){run(()=>openSession(saved));return}
  S.session=null;
  if(page==='previous'){renderPrevious();$('routeHeading').textContent='Previous events';routeTo('previous',false)}else if(page==='setup'&&selectedEvent)routeTo('setup',false);else{renderEvents();$('routeHeading').textContent='Select event';routeTo('choose',false)}lastRoute=location.href;
 });

 const initialize=()=>{
  if($('app').hidden||!S.tournament)return false;
  renderEvents();
  if(!S.session){routeTo('choose',false);}else{routeTo('workspace',false);}
  return true;
 };
 if(!initialize()){const observer=new MutationObserver(()=>{if(initialize())observer.disconnect()});observer.observe($('app'),{attributes:true,attributeFilter:['hidden']});}
})();
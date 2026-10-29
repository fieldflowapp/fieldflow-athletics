'use strict';
// Read-only comparison of the existing administrator-protected history view.
const C={ids:[],rows:[],loaded:false,request:0,chosen:new Set(),colors:['#FF408F','#FFB800','#BF83FF','#00E58F','#FF8754','#72C8FF']};
const CL=CompareLogic;
function prepareCompare(){
 if(!databaseWorkspace)return;
 $('compareLevel').innerHTML=option('All','All categories')+[...new Set(S.athletes.map(a=>a.level))].map(x=>option(x,x)).join('');
 renderComparePicker();
}
function compareAthletes(){return C.ids.map(id=>S.athletes.find(a=>a.id===id)).filter(Boolean)}
function compareColor(id){return C.colors[C.ids.indexOf(id)%C.colors.length]||C.colors[0]}
function compareNotice(text){$('compareStatus').textContent=text}
function renderComparePicker(){
 if(!databaseWorkspace)return;
 const q=$('compareSearch').value.trim().toLowerCase();const matches=S.athletes.filter(a=>(!q||`${name(a)} ${a.external_code||''}`.toLowerCase().includes(q))&&($('compareLevel').value==='All'||a.level===$('compareLevel').value)&&($('compareGender').value==='All'||a.gender===$('compareGender').value));
 $('compareCandidates').innerHTML=matches.slice(0,30).map(a=>`<button type="button" class="compare-candidate" data-compare-add="${esc(a.id)}" ${C.ids.includes(a.id)||C.ids.length>=6?'disabled':''}><span><b>${esc(name(a))}</b><small>${esc(a.level)} · ${esc(a.gender)} · ${esc(a.color)} · ${esc(a.external_code||'')}</small></span><span>${C.ids.includes(a.id)?'Added':'+'}</span></button>`).join('')||'<p>No matching athletes.</p>';
 $('compareMatchCount').textContent=matches.length>30?`Showing 30 of ${matches.length}. Search or filter to narrow the list.`:`${matches.length} athletes`;
 $('compareSelected').innerHTML=compareAthletes().map(a=>`<button class="compare-chip" data-compare-remove="${esc(a.id)}" style="--athlete:${compareColor(a.id)}" aria-label="Remove ${esc(name(a))}"><span class="compare-dot"></span><span class="compare-chip-name">${esc(name(a))}</span><span aria-hidden="true"> ×</span></button>`).join('')||'<span class="muted">Add 2–6 athletes to compare.</span>';
 $('compareCount').textContent=`${C.ids.length}/6 athletes`;
 $('compareLoad').disabled=C.ids.length<2;
}
function changeCompareAthlete(id,remove=false){
 if(remove)C.ids=C.ids.filter(x=>x!==id);else if(!C.ids.includes(id)&&C.ids.length<6)C.ids.push(id);else return;
 C.request++;C.loaded=false;C.rows=[];C.chosen.clear();$('compareResults').innerHTML='';$('compareFilters').hidden=true;compareNotice(C.ids.length>=2?'Ready to compare. Choose Compare athletes to load their records.':'Add at least two athletes.');renderComparePicker();
}
async function loadCompare(){
 if(C.ids.length<2){compareNotice('Add at least two athletes.');return}
 const token=++C.request,ids=[...C.ids];C.loaded=false;C.rows=[];C.chosen.clear();$('compareResults').innerHTML='';$('compareFilters').hidden=true;compareNotice('Loading athlete histories…');$('compareLoad').disabled=true;
 try{
  const rows=await allRows(()=>sb.from('athletics_craighouse_history').select('*').eq('tournament_id',S.tournament.id).in('athlete_id',ids).order('performance_date').order('record_id'));
  if(token!==C.request)return;
  C.rows=CL.unique(rows);C.loaded=true;
  const events=[...new Set(rows.map(r=>r.event_name))].sort();const previous=$('compareEvent').value;
  $('compareEvent').innerHTML=option('','Choose an event')+events.map(e=>option(e,e)).join('');if(events.includes(previous))$('compareEvent').value=previous;
  $('compareFilters').hidden=false;$('comparePane').querySelector('.compare-picker details').open=false;compareNotice(`${rows.length} records loaded for ${ids.length} athletes.`);renderCompare(true);
 }catch(e){if(token===C.request)compareNotice('Could not load the comparison. '+e.message+' Use Compare athletes to retry.');}
 finally{if(token===C.request)renderComparePicker()}
}
function compareFilters(){return {event:$('compareEvent').value,source:$('compareSource').value,from:$('compareFrom').value,to:$('compareTo').value}}
function compareGroupLabel(r){return `${r.category} · ${r.gender==='F'?'Girls':r.gender==='M'?'Boys':r.gender} · ${r.conditions||'Conditions unspecified'}`}
function compareFormat(value,row){return value==null?'—':fmt({...row,mark:value})}
function renderCompare(resetGroup=false){
 if(!C.loaded)return;C.chosen.clear();
 const f=compareFilters();if(f.from&&f.to&&f.from>f.to){$('compareResults').innerHTML='<p class="error">The end date must be on or after the start date.</p>';$('compareGroup').innerHTML='';return}
 const rows=CL.filter(C.rows,f);
 if(!f.event){$('compareGroup').innerHTML=option('','Select an event first');$('compareResults').innerHTML=`<div class="compare-empty"><h2>Which event are you selecting for?</h2><p>Explore the athletes’ recorded events, then compare one event and condition group at a time.</p><div class="compare-event-grid">${[...new Set(rows.map(r=>r.event_name))].map(e=>{const eventRows=rows.filter(r=>r.event_name===e);return `<button data-compare-event="${esc(e)}"><b>${esc(e)}</b><small>${new Set(eventRows.filter(CL.valid).map(r=>r.athlete_id)).size}/${C.ids.length} athletes with valid marks · ${eventRows.length} records</small><span aria-hidden="true">→</span></button>`}).join('')||'<p>No records match the selected source and dates.</p>'}</div></div>`;return}
 const grouped=CL.groups(rows),previous=$('compareGroup').value;
 $('compareGroup').innerHTML=[...grouped].map(([key,g])=>option(key,compareGroupLabel(g[0]))).join('');
 if(!resetGroup&&grouped.has(previous))$('compareGroup').value=previous;
 if(!grouped.size){$('compareResults').innerHTML='<div class="compare-empty"><h2>No records in this selection</h2><p>Try a different event, source or date range.</p></div>';return}
 renderCompareGroup();
}
function renderCompareGroup(){
 C.chosen.clear();const rows=CL.filter(C.rows,compareFilters()).filter(r=>CL.key(r)===$('compareGroup').value);if(!rows.length)return;
 const base=rows[0],metric=$('compareMetric').value,slots=Math.max(1,Math.min(6,Math.floor(Number($('compareSlots').value))||3));$('compareSlots').value=slots;
 const ranked=CL.rank(compareAthletes(),rows,metric,slots),relay=base.discipline==='relay';
 const labels={best:'Best mark',latest:'Latest valid attempt',recent:'Average of last 3 daily bests'};
 const max=Math.max(0,...ranked.list.map(x=>x.value||0));
 $('compareResults').innerHTML=`<div class="compare-context"><div><span class="eyebrow">${esc(base.event_name)}</span><h2>${esc(labels[metric])}</h2><p>${esc(compareGroupLabel(base))} · ${base.unit==='s'?'Lower is better':'Higher is better'}</p></div><span class="badge">${slots} places to select</span></div>
 <p class="compare-note">Only this event, category, gender and exact recorded conditions are compared. Unspecified conditions have not been verified. Sources and dates are shown in the records below.</p>
 ${relay?'<p class="compare-warning">Relay marks are team times, not individual splits. Use individual events to assess each runner.</p>':''}
 ${ranked.cutoffTie?'<p class="compare-warning">Tie at the selection cutoff. The data does not distinguish the final place: review recent results before choosing.</p>':''}
 <nav class="compare-view-tabs" aria-label="Comparison views"><button data-compare-view="summary" class="active" aria-pressed="true">Summary</button><button data-compare-view="progress" aria-pressed="false">Progress</button><button data-compare-view="records" aria-pressed="false">Records</button></nav><div data-compare-panel="summary"><div class="compare-bars" aria-label="${esc(labels[metric])} comparison">${ranked.list.map(x=>`<div class="compare-bar-row"><span class="compare-bar-name"><i class="compare-dot" style="--athlete:${compareColor(x.athlete.id)}"></i>${esc(name(x.athlete))}</span><div class="compare-bar-track"><span style="width:${max&&x.value!==null?x.value/max*100:0}%;background:${compareColor(x.athlete.id)}"></span></div><b>${compareFormat(x.value,base)}</b></div>`).join('')}</div>
 <div class="compare-summary">${ranked.list.map(x=>`<article class="compare-athlete-card" style="--athlete:${compareColor(x.athlete.id)}"><div class="compare-card-title"><span class="compare-position">${x.rank===null?'—':'#'+x.rank}</span><h3>${esc(name(x.athlete))}</h3></div><div class="compare-primary">${compareFormat(x.value,base)}</div><p>${x.validCount} valid attempts · ${x.days.length} recorded days${!x.validCount?' · No valid marks':''}</p><details class="compare-more"><summary>More data</summary><dl><div><dt>Best</dt><dd>${compareFormat(x.best?.mark??null,base)}<small>${esc(x.best?.performance_date||'')}</small></dd></div><div><dt>Latest valid</dt><dd>${compareFormat(x.latest?.mark??null,base)}<small>${esc(x.latest?.performance_date||'')}</small></dd></div><div><dt>Recent average</dt><dd>${compareFormat(x.mean,base)}<small>${x.recentDays}/3 daily bests available</small></dd></div><div><dt>First → last day</dt><dd>${x.change===null?'—':(x.change>=0?'+':'−')+compareFormat(Math.abs(x.change),base)}<small>Positive = improvement</small></dd></div></dl></details><label class="compare-shortlist"><input type="checkbox" data-compare-pick="${esc(x.athlete.id)}"> Select athlete</label></article>`).join('')}</div>
 <div id="compareShortlist" class="compare-shortlist-status" role="status">0/${slots} selected · Your selection stays on this screen only; it does not create official entries. Changing comparison filters clears the selection.</div>
 </div><section class="compare-chart-panel" data-compare-panel="progress" hidden><h2>Progress over time</h2><p>Best valid mark per athlete per day · ${base.unit==='s'?'Lower is better':'Higher is better'}. Tap a point for the date and source. Tap a name to show or hide that athlete. Lines only connect recorded days.</p>${compareChart(ranked.list,base)}<div id="comparePoint" class="compare-point-detail" aria-live="polite">Select a point to inspect its result.</div></section>
 <section class="compare-records" data-compare-panel="records" hidden><h2>Every recorded attempt</h2><p>All statuses are included below. Invalid attempts do not enter the graphs or calculations. “Latest” uses the recorded timestamp and attempt order within each day.</p>${ranked.list.map(x=>`<details><summary><span class="compare-dot" style="--athlete:${compareColor(x.athlete.id)}"></span>${esc(name(x.athlete))}<span>${x.total} records</span></summary>${historyTable(rows.filter(r=>r.athlete_id===x.athlete.id).sort(CL.chronological).reverse())}</details>`).join('')}</section>`;
}
function compareChart(list,base){
 const points=list.flatMap(x=>x.days);if(!points.length)return '<p>No valid marks to plot.</p>';
 const dates=points.map(r=>Date.parse(r.performance_date)),values=points.map(r=>Number(r.mark));const start=Math.min(...dates),end=Math.max(...dates);const lo=Math.min(...values),hi=Math.max(...values),pad=(hi-lo)*.12||Math.max(hi*.03,.1),min=Math.max(0,lo-pad),max=hi+pad;
 const x=r=>end===start?320:65+(Date.parse(r.performance_date)-start)/(end-start)*530,y=r=>210-(Number(r.mark)-min)/(max-min)*180;
 let drawing='';for(let i=0;i<4;i++){const v=min+(max-min)*i/3,Y=210-i*60;drawing+=`<line x1="65" y1="${Y}" x2="595" y2="${Y}" stroke="#214155"/><text x="57" y="${Y+4}" text-anchor="end" fill="#a6bdca" font-size="11">${esc(compareFormat(v,base))}</text>`}
 drawing+=list.map(a=>`<g data-compare-series="${esc(a.athlete.id)}"><polyline points="${a.days.map(r=>`${x(r)},${y(r)}`).join(' ')}" stroke="${compareColor(a.athlete.id)}" fill="none" stroke-width="2.5"/>${a.days.map(r=>{const detail=`${name(a.athlete)} · ${r.performance_date} · ${fmt(r)} · ${r.source} · ${r.source_label||''}`;return `<circle cx="${x(r)}" cy="${y(r)}" r="7" fill="${compareColor(a.athlete.id)}" stroke="#061722" stroke-width="2" tabindex="0" role="button" aria-label="${esc(detail)}" data-compare-point="${esc(detail)}"><title>${esc(detail)}</title></circle>`}).join('')}</g>`).join('');
 return `<div class="compare-legend">${list.map(a=>`<button data-compare-legend="${esc(a.athlete.id)}" aria-pressed="true"><i class="compare-dot" style="--athlete:${compareColor(a.athlete.id)}"></i>${esc(name(a.athlete))}</button>`).join('')}</div><div class="compare-chart-scroll"><svg viewBox="0 0 640 260" role="group" aria-label="${esc(base.event_name)} daily best progress">${drawing}<text x="65" y="242" fill="#a6bdca" font-size="12">${new Date(start).toISOString().slice(0,10)}</text><text x="595" y="242" text-anchor="end" fill="#a6bdca" font-size="12">${new Date(end).toISOString().slice(0,10)}</text></svg></div>`;
}
if(databaseWorkspace){
 $('compareSearch').oninput=renderComparePicker;$('compareLevel').onchange=renderComparePicker;$('compareGender').onchange=renderComparePicker;
 $('compareLoad').onclick=loadCompare;
 $('compareClear').onclick=()=>{C.request++;C.ids=[];C.rows=[];C.loaded=false;C.chosen.clear();$('compareResults').innerHTML='';$('compareFilters').hidden=true;compareNotice('');renderComparePicker()};
 $('addProfileCompare').onclick=()=>{const id=$('athletePicker').value;if(!id)return;changeCompareAthlete(id);tab('compare')};
 for(const id of ['compareEvent','compareSource','compareFrom','compareTo'])$(id).onchange=()=>renderCompare(id==='compareEvent');
 $('compareGroup').onchange=renderCompareGroup;$('compareMetric').onchange=renderCompareGroup;$('compareSlots').onchange=()=>{if(C.loaded&&$('compareGroup').value)renderCompareGroup()};
 $('comparePane').onclick=e=>{const legend=e.target.closest('[data-compare-legend]');if(legend){const visible=legend.getAttribute('aria-pressed')!=='true';legend.setAttribute('aria-pressed',String(visible));document.querySelectorAll('[data-compare-series]').forEach(g=>{if(g.dataset.compareSeries===legend.dataset.compareLegend)g.style.display=visible?'':'none'})}const view=e.target.closest('[data-compare-view]');if(view){document.querySelectorAll('[data-compare-panel]').forEach(p=>p.hidden=p.dataset.comparePanel!==view.dataset.compareView);document.querySelectorAll('[data-compare-view]').forEach(b=>{const active=b===view;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active))})}const add=e.target.closest('[data-compare-add]'),remove=e.target.closest('[data-compare-remove]'),event=e.target.closest('[data-compare-event]'),point=e.target.closest('[data-compare-point]');if(add)changeCompareAthlete(add.dataset.compareAdd);if(remove)changeCompareAthlete(remove.dataset.compareRemove,true);if(event){$('compareEvent').value=event.dataset.compareEvent;renderCompare(true)}if(point)$('comparePoint').textContent=point.dataset.comparePoint};
 $('comparePane').onkeydown=e=>{const p=e.target.closest('[data-compare-point]');if(p&&['Enter',' '].includes(e.key)){e.preventDefault();$('comparePoint').textContent=p.dataset.comparePoint}};
 $('comparePane').onchange=e=>{const id=e.target.dataset.comparePick;if(!id)return;const slots=Number($('compareSlots').value)||3;if(e.target.checked&&C.chosen.size>=slots){e.target.checked=false;$('compareShortlist').textContent=`All ${slots} places are selected. Deselect an athlete first.`;return}if(e.target.checked)C.chosen.add(id);else C.chosen.delete(id);$('compareShortlist').textContent=`${C.chosen.size}/${slots} selected${C.chosen.size?' · '+compareAthletes().filter(a=>C.chosen.has(a.id)).map(name).join(' · '):''}. Screen only; official entries are unchanged.`};
}

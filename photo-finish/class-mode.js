/* Class-only transport. It never writes official track or relay tables. */
(function(root){
 'use strict';
 function create(sb,heatId){
  async function checked(q){const {data,error}=await q;if(error)throw Error(error.message);return data}
  return {
   async load(){
    if(!heatId||!sb)throw Error('Missing class heat or connection');
    const heat=await checked(sb.from('athletics_class_heats').select('*').eq('id',heatId).single());
    const session=await checked(sb.from('athletics_class_sessions').select('*').eq('id',heat.session_id).single());
    const event=await checked(sb.from('athletics_events').select('*').eq('id',session.template_event_id).single());
    const rows=await checked(sb.from('athletics_class_series_sheet').select('*').eq('heat_id',heatId).order('lane'));
    if(!rows.length)throw Error('This class heat has no runners');
    return {heat,session,event,entries:rows.map((r,i)=>({...r,displayOrder:i+1,athlete:{id:r.athlete_id,first_name:r.first_name,last_name:r.last_name,color:r.color,gender:r.gender}}))};
   },
   async save(pending){
    if(!heatId||!pending.length)throw Error('No class heat results to save');
    await checked(sb.rpc('athletics_save_class_heat',{p_heat_id:heatId,p_results:pending.map(r=>({id:r.entryId,official_time:r.sec,status:'finished',notes:'Class Photo Finish',timing_method:'photo_finish'})),p_complete:false}));
    return checked(sb.from('athletics_class_series_sheet').select('id,official_time,status').eq('heat_id',heatId).in('id',pending.map(r=>r.entryId)));
   }
  };
 }
 const api={create};if(typeof module!=='undefined')module.exports=api;else root.ClassPhotoFinish=api;
})(typeof window!=='undefined'?window:globalThis);

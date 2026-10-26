(() => {
 const $=id=>document.getElementById(id);
 let directory=[];
 function dashboardLink(){const id=$('regionalClub').value,visible=$('clubType').value==='regional'&&Boolean(id);$('clubDashboard').hidden=!visible;if(visible){const url=window.BSI_SERVICE?.endpoint?new URL('/organiser',window.BSI_SERVICE.endpoint):new URL('organiser.html',location.href);url.searchParams.set('club',id);$('clubDashboard').href=url.href;}}
 function toggle(){dashboardLink();const regional=$('clubType').value==='regional';$('regionalClubBox').hidden=!regional;$('specialityClubBox').hidden=$('clubType').value!=='speciality';$('regionalClub').required=regional;$('clubName').required=$('clubType').value==='speciality';$('registeredShowBox').hidden=true;$('registeredShow').replaceChildren();loadShows();}
 window.bsiOrganiser=()=>{
  const type=$('clubType').value;
  return {ring:$('ring').value.trim(),showId:$('registeredShow').value||'',organisingClub:type==='regional'?{type,id:$('regionalClub').value,name:directory.find(c=>c.id===$('regionalClub').value)?.name||''}:{type,name:$('clubName').value.trim()}};
 };
 window.bsiOrganiserValid=()=>{
  for(const id of ['clubType','regionalClub','clubName','ring']){const el=$(id);if(el.required&&(el.disabled||!el.value.trim())){$('clubDirectoryStatus').textContent='Complete the organising club selection and ring number before exporting or submitting.';el.reportValidity();return false;}if(el.required&&!el.reportValidity())return false;}
  return true;
 };
 async function loadShows(){
  $('registeredShowBox').hidden=true;
  if($('clubType').value!=='regional'||!$('regionalClub').value||!$('date').value||!window.BSI_SERVICE?.endpoint)return;
  const selectedClub=$('regionalClub').value,date=$('date').value;
  try{
   const url=new URL('/public/shows',window.BSI_SERVICE.endpoint);url.searchParams.set('club',selectedClub);url.searchParams.set('date',date);
   const response=await fetch(url);if(!response.ok)return;const shows=await response.json();
   if($('clubType').value!=='regional'||selectedClub!==$('regionalClub').value||date!==$('date').value)return;
   $('registeredShow').replaceChildren();const blank=document.createElement('option');blank.value='';blank.textContent='Enter show details manually';$('registeredShow').append(blank);
   for(const show of shows){const o=document.createElement('option');o.value=show.id;o.textContent=show.name;o.dataset.country=show.country;o.dataset.name=show.name;$('registeredShow').append(o);}
   $('registeredShowBox').hidden=!shows.length;
  }catch{ /* Manual show details remain available. */ }
 }
 $('clubType').onchange=toggle;$('regionalClub').onchange=()=>{ dashboardLink();$('registeredShow').replaceChildren();loadShows();};$('date').addEventListener('change',()=>{$('registeredShow').replaceChildren();loadShows();});
 $('registeredShow').onchange=()=>{const o=$('registeredShow').selectedOptions[0];if(o?.value){$('show').value=o.dataset.name;$('country').value=o.dataset.country;}};
 for(const id of ['show','country'])$(id).addEventListener('input',()=>{$('registeredShow').value='';});
 fetch('./regional-clubs.json').then(r=>{if(!r.ok)throw new Error();return r.json();}).then(clubs=>{directory=clubs;for(const club of clubs){const o=document.createElement('option');o.value=club.id;o.textContent=club.name;$('regionalClub').append(o);}$('regionalClub').disabled=false;}).catch(()=>{$('clubDirectoryStatus').textContent='Regional club list could not load. Reload the page before completing the organising club selection.';});
 toggle();
})();

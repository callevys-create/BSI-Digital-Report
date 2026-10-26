import {regional,reportingStatus,allocationPreview,parseCSV,parseXLSX,statusTable,checkAllocations,identifyBreed,normalise} from './organiser-client.js';
import {csv,validDate} from './statistics.mjs';
const $=id=>document.getElementById(id),tell=s=>$('message').textContent=s;
const pct=n=>n===null?'Not defined':n.toFixed(1)+'%';
const timestamp=s=>s?new Intl.DateTimeFormat('en-GB',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Stockholm'}).format(new Date(s)):'—';
const requestedClub=new URLSearchParams(location.search).get('club');let requestedApplied=false;
let mode='disconnected',user=null,current=null,allClubs=[],breeds=[],demo=null,inFlight=false,worksheets=[],previewRows=[],previewContext=null;
const demoTime='2026-10-26T10:00:00Z';
function seed(){
 const shows=[{id:'DEMO-stockholm',club_id:'stockholm',name:'Example Stockholm Show',date:'2026-10-26',country:'Sweden',revision:1},{id:'DEMO-uppsala',club_id:'uppsala',name:'Example Uppsala Show',date:'2026-10-26',country:'Sweden',revision:1},{id:'DEMO-speciality',club_id:'DEMO-speciality',name:'Example Speciality Show',date:'2026-10-26',country:'Sweden',revision:1}];
 const allocations=[{show_id:shows[0].id,ring:'1',judge:'Example Judge A',breed:'English Bulldog',required:true},{show_id:shows[0].id,ring:'1',judge:'Example Judge A',breed:'Pug',required:true},{show_id:shows[0].id,ring:'2',judge:'Example Judge B',breed:'Labrador Retriever',required:false},{show_id:shows[0].id,ring:'3',judge:'Example Judge C',breed:'French Bulldog',required:true},{show_id:shows[1].id,ring:'1',judge:'Example Judge D',breed:'Pug',required:true},{show_id:shows[2].id,ring:'1',judge:'Example Judge E',breed:'French Bulldog',required:true}];
 const links=[{id:'DEMO-report-1',show_id:shows[0].id,ring:'1',judge:'Example Judge A',breed:'English Bulldog',submitted_at:demoTime},{id:'DEMO-report-2',show_id:shows[1].id,ring:'1',judge:'Example Judge D',breed:'Pug',submitted_at:demoTime},{id:'DEMO-report-3',show_id:shows[0].id,ring:'9',judge:'Example Judge C',breed:'French Bulldog',submitted_at:demoTime}];
 return {shows,allocations,links,access:[],clubs:[...regional.map(c=>({...c,type:'regional'})),{id:'DEMO-speciality',type:'speciality',name:'Example Breed Club'}]};
}
async function api(path,options={}){
 const r=await fetch(path,{credentials:'same-origin',...options});let body;try{body=await r.json();}catch{throw new Error('Service response could not be read.');}if(!r.ok)throw new Error(body.error||'Request failed.');return body;
}
const post=(path,body)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
function options(id,rows,{blank='',label=r=>r.name,value=r=>r.id}={}){
 const select=$(id),previous=select.value;select.replaceChildren();if(blank){const o=document.createElement('option');o.value='';o.textContent=blank;select.append(o);}for(const r of rows){const o=document.createElement('option');o.value=value(r);o.textContent=label(r);select.append(o);}if([...select.options].some(o=>o.value===previous))select.value=previous;
}
function allowedWrite(club){return user?.role==='manager'||user?.role==='organiser'&&user.clubs.some(c=>c.id===club&&c.role==='editor');}
function viewSetup(){
 const scope=user.role==='organiser'?user.clubs:allClubs;
 options('clubFilter',scope,{blank:user.role==='organiser'?'':'All organising clubs'});$('clubFilter').disabled=false;
 if(!requestedApplied&&requestedClub){if(!scope.some(c=>c.id===requestedClub))throw new Error('You do not have access to the requested club.');$('clubFilter').value=requestedClub;requestedApplied=true;}
 $('managerTools').hidden=user.role!=='manager';$('refresh').disabled=false;
 options('accessClub',regional);options('standardClub',allClubs.filter(c=>c.type==='speciality'),{blank:'Select breed / speciality club…'});
 $('organiserTools').hidden=!allowedWrite($('clubFilter').value);
}
function filters(){return {club:$('clubFilter').value,start:$('start').value,end:$('end').value,show:$('showFilter').value.trim(),judge:$('judgeFilter').value.trim()};}
function validateFilters(f){if(!validDate(f.start)||!validDate(f.end)||f.start>f.end)throw new Error('Select a valid start and end date.');}
function statusNode(value){const s=document.createElement('span');s.className='status-pill '+value;s.textContent={submitted:'Submitted',missing:'Missing',not_required:'Not required',unplanned:'Additional / unmatched'}[value]||value;return s;}
function table(id,headers,rows){const t=$(id);t.replaceChildren();const head=document.createElement('thead'),hr=document.createElement('tr');for(const label of headers){const th=document.createElement('th');th.textContent=label;hr.append(th);}head.append(hr);t.append(head);const body=document.createElement('tbody');for(const row of rows){const tr=document.createElement('tr');for(const value of row){const td=document.createElement('td');if(value instanceof Node)td.append(value);else td.textContent=value??'—';tr.append(td);}body.append(tr);}t.append(body);}
async function refresh(silent=false){
 if(inFlight||mode==='disconnected')return;inFlight=true;
 try{
  const f=filters();validateFilters(f);
  const visible=mode==='demo'&&user.role==='organiser'?demo.shows.filter(s=>user.clubs.some(c=>c.id===s.club_id)):demo?.shows;
  if(mode==='demo'){const shows=visible.map(s=>({...s,club_name:allClubs.find(c=>c.id===s.club_id)?.name||''}));current=reportingStatus(shows,demo.allocations,demo.links,f);}else current=await api('/api/organiser/status?'+new URLSearchParams(f));
  render();$('lastUpdated').textContent=(mode==='demo'?'DEMONSTRATION DATA. ':'Live status. ')+`Last updated: ${timestamp(current.generatedAt)} (Europe/Stockholm). `+(mode==='live'?'Refreshes automatically every 20 seconds.':'Changes in this preview are temporary.');
  if(!silent)tell(`${current.summary.missing} required report(s) missing across ${current.summary.shows} show(s).`);
 }catch(e){tell('Status could not refresh: '+e.message+' Previously displayed results may be out of date.');}finally{inFlight=false;}
}
function render(){
 $('results').hidden=false;$('summary').replaceChildren();for(const [label,value] of [['Expected BSI reports',current.summary.expected],['Submitted requirements',current.summary.submitted],['Missing reports',current.summary.missing],['Completion',pct(current.summary.completion)]]){const d=document.createElement('div');d.className='metric';const strong=document.createElement('strong');strong.textContent=value;d.append(strong,document.createTextNode(label));$('summary').append(d);}
 $('definition').textContent=current.definition+` Shows without imported allocations: ${current.summary.unconfiguredShows}.`;
 table('shows',['Club','Show','Date','Expected','Submitted','Missing','Completion','Status / setup'],current.shows.map(s=>[s.club_name,s.name,s.date,s.expected,s.submitted,s.missing,pct(s.completion),s.hasAllocations?statusNode(s.status):'No allocations imported']));
 table('rings',['Club','Show','Date','Ring','Expected','Submitted','Missing','Completion','Status'],current.rings.map(r=>[r.club,r.show,r.date,r.ring,r.expected,r.submitted,r.missing,pct(r.completion),statusNode(r.status)]));
 table('details',['Show','Date','Ring','Judge','Breed','Required','Status','Submitted (Stockholm)','Matching reports'],current.rows.map(r=>[r.show,r.date,r.ring,r.judge,r.breed,r.required?'Yes':'No',statusNode(r.status),timestamp(r.submittedAt),r.reportCount]));
 table('unplanned',['Report ID','Club','Show','Date','Ring','Judge','Breed','Submitted (Stockholm)'],current.unplanned.map(r=>[r.id,r.club,r.show,r.date,r.ring,r.judge,r.breed,timestamp(r.submittedAt)]));
 options('importShow',current.shows,{label:s=>`${s.name} / ${s.date} / revision ${s.revision}`,blank:'Select a show…'});options('correctShow',current.shows,{label:s=>`${s.club_name} / ${s.name} / ${s.date}`,blank:'Select target show…'});
 $('organiserTools').hidden=!allowedWrite($('clubFilter').value);
 for(const id of ['csv','xlsx','pdf'])$(id).disabled=false;
 if(previewContext){const show=current.shows.find(s=>s.id===previewContext.showId);if(!show||show.revision!==previewContext.revision){$('commitImport').disabled=true;$('importMessage').textContent='The allocation revision changed. Select the file again and review it before importing.';}}
}
$('refresh').onclick=()=>refresh();for(const id of ['clubFilter','start','end','showFilter','judgeFilter'])$(id).onchange=()=>refresh();
$('loadDemo').onclick=()=>{mode='demo';demo=seed();allClubs=demo.clubs;$('demoControls').hidden=false;$('connection').textContent='DEMONSTRATION — synthetic shows and reports only. No reports or emails are sent. Changes are discarded when this page reloads.';demoRole();};
function demoRole(){user=$('demoRole').value==='club'?{role:'organiser',email:'demo@example.invalid',clubs:[{...(regional.find(c=>c.id===requestedClub)||regional.find(c=>c.id==='stockholm')),role:'editor'}]}:{role:'manager',email:'demo@example.invalid'};viewSetup();previewContext=null;$('importPreview').hidden=true;refresh();if(user.role==='manager')accessList();}
$('demoRole').onchange=demoRole;
$('createShow').onclick=async()=>{
 try{
  for(const id of ['showName','showDate','showCountry'])if(!$(id).reportValidity())return;
  const p={clubId:$('clubFilter').value,name:$('showName').value.trim(),date:$('showDate').value,country:$('showCountry').value.trim()};if(!allowedWrite(p.clubId))throw new Error('Select a club for which you can manage shows.');
  if(mode==='demo'){const key=[p.clubId,normalise(p.name),p.date,normalise(p.country)].join('|');let show=demo.shows.find(s=>[s.club_id,normalise(s.name),s.date,normalise(s.country)].join('|')===key);if(!show)demo.shows.push({id:crypto.randomUUID(),club_id:p.clubId,name:p.name,date:p.date,country:p.country,revision:0});}else await post('/api/organiser/shows',p);
  if(p.date<$('start').value)$('start').value=p.date;if(p.date>$('end').value)$('end').value=p.date;await refresh();tell('Show saved. Select it below to import its allocations.');
 }catch(e){tell(e.message);}
};
const template=[['Ring','Judge','Breed'],['1','Example Judge','English Bulldog'],['1','Example Judge','Pug'],['2','Another Judge','Labrador Retriever']];
function download(bytes,name,type){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([bytes],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('csvTemplate').onclick=()=>download(csv(template),'BSI-ring-allocations-template.csv','text/csv;charset=utf-8');
$('xlsxTemplate').onclick=async()=>{try{const {workbookBytes}=await import('./exports-client.js');download(workbookBytes([{name:'Ring allocations',rows:template}]),'BSI-ring-allocations-template.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');}catch(e){tell(e.message);}};
function clearPreview(){$('importPreview').hidden=true;$('commitImport').disabled=true;previewRows=[];previewContext=null;}
$('importShow').onchange=()=>{clearPreview();$('allocationFile').value='';};
$('allocationFile').onclick=()=>{clearPreview();$('allocationFile').value='';};
$('allocationFile').onchange=async()=>{
 clearPreview();try{
  const show=current?.shows.find(s=>s.id===$('importShow').value);if(!show)throw new Error('Select the show before choosing an allocation file.');if(!allowedWrite(show.club_id))throw new Error('You cannot import allocations for this club.');
  const file=$('allocationFile').files[0];if(!file)return;if(file.size>2*1024*1024)throw new Error('The file must be 2 MB or smaller.');
  if(/\.csv$/i.test(file.name))worksheets=[{name:'CSV',rows:parseCSV(await file.text())}];else if(/\.xlsx$/i.test(file.name))worksheets=parseXLSX(new Uint8Array(await file.arrayBuffer()));else throw new Error('Use .xlsx or UTF-8 .csv. Older .xls files must be saved as .xlsx.');
  previewContext={showId:show.id,revision:show.revision};options('sheet',worksheets.map((s,i)=>({id:String(i),name:s.name})));$('sheetBox').hidden=worksheets.length<=1;previewSheet();
 }catch(e){$('importMessage').textContent=e.message;}
};
$('sheet').onchange=()=>{try{previewSheet();}catch(e){$('importMessage').textContent=e.message;}};
function previewSheet(){previewRows=allocationPreview(worksheets[Number($('sheet').value)||0].rows);$('importPreview').hidden=false;
 const rows=previewRows.map((r,index)=>{
  const select=document.createElement('select');select.setAttribute('aria-label',`BSI mapping for row ${index+1}`);
  const add=(value,name)=>{const o=document.createElement('option');o.value=value;o.textContent=name;select.append(o);};
  if(!r.recognised){add('','Review this breed…');add('__unlisted__','Confirm: Not BSI-listed');}for(const b of breeds)add(b.name,b.name);select.value=r.recognised?r.breed:'';
  select.onchange=()=>{if(select.value==='__unlisted__'){r.breed=r.sourceBreed;r.confirmedUnlisted=true;r.recognised=false;}else{r.breed=select.value||r.sourceBreed;r.confirmedUnlisted=false;r.recognised=Boolean(select.value);}updateImportReady();};return [r.ring,r.judge,r.sourceBreed,select];
 });table('preview',['Ring','Judge','Imported breed','BSI mapping / requirement'],rows);updateImportReady();
}
function updateImportReady(){const unresolved=previewRows.filter(r=>!r.recognised&&!r.confirmedUnlisted).length;$('commitImport').disabled=Boolean(unresolved)||!previewRows.length;$('importMessage').textContent=`${previewRows.length} row(s); ${previewRows.filter(r=>r.recognised).length} BSI requirement(s); ${unresolved} breed(s) need review. Revision ${previewContext?.revision}.`;}
$('commitImport').onclick=async()=>{
 $('commitImport').disabled=true;try{
  const rows=previewRows.map(({ring,judge,breed,confirmedUnlisted})=>({ring,judge,breed,confirmedUnlisted}));checkAllocations(rows);
  if(mode==='demo'){const show=demo.shows.find(s=>s.id===previewContext.showId);if(show.revision!==previewContext.revision)throw new Error('Revision changed; reload and review the file.');const checked=checkAllocations(rows);demo.allocations=demo.allocations.filter(r=>r.show_id!==show.id);demo.allocations.push(...checked.map(r=>({...r,show_id:show.id})));show.revision++;}else await post('/api/organiser/import',{...previewContext,rows});
  clearPreview();await refresh();$('importMessage').textContent='Reviewed allocations imported. Completion is calculated from the updated list.';
 }catch(e){$('importMessage').textContent=e.message;}
};
async function exportStatus(format){
 if(!current)return;try{
  if(mode==='live'){const r=await fetch('/api/organiser/status?'+new URLSearchParams({...current.filters,format}),{credentials:'same-origin'});if(!r.ok)throw new Error('Status export failed.');download(await r.arrayBuffer(),`BSI-reporting-status.${format}`,r.headers.get('Content-Type'));}
  else{
   const table=statusTable(current),name=`BSI-DEMO-reporting-status.${format}`;
   if(format==='csv')download(csv(table.rows),name,'text/csv;charset=utf-8');else{
    const exports=await import('./exports-client.js');
    if(format==='xlsx')download(exports.workbookBytes([{name:'Read me',rows:[['DEMONSTRATION DATA'],['Synthetic status only'],['Completion',pct(current.summary.completion)]]},table]),name,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    else {const font=new Uint8Array(await fetch('./NotoSans-Regular.ttf').then(r=>r.arrayBuffer()));download(await exports.textPDF('BSI - Demonstration reporting status',[{title:'Synthetic data only',lines:[current.definition]},...current.rows.map(r=>({title:`${r.show} / ${r.date} / Ring ${r.ring}`,lines:[`${r.judge} | ${r.breed}`,`Status: ${r.status} | Submitted: ${r.submittedAt||'Not submitted'}`]}))],font),name,'application/pdf');}
   }
  }tell(`${format.toUpperCase()} reporting status exported.`);
 }catch(e){tell(e.message);}
}
for(const f of ['csv','xlsx','pdf'])$(f).onclick=()=>exportStatus(f);
async function accessList(){
 const unlinked=mode==='demo'?[]:await api('/api/organiser/unlinked');table('unlinked',['Report ID','Show','Date','Judge','Breed','Ring'],unlinked.map(r=>[r.id,r.show_name,r.date,r.judge,r.breed,r.ring]));
 const rows=mode==='demo'?demo.access:await api('/api/organiser/access');
 table('access',['Club','User email','Permission','Active','Action'],rows.map(a=>{const revoke=document.createElement('button');revoke.className='secondary';revoke.textContent='Revoke';revoke.disabled=!a.active;revoke.onclick=async()=>{try{if(mode==='demo')a.active=false;else await post('/api/organiser/access',{clubId:a.club_id,email:a.email,role:a.role,active:false});await accessList();tell('Club access revoked.');}catch(e){tell(e.message);}};return [a.club||allClubs.find(c=>c.id===a.club_id)?.name,a.email,a.role,a.active?'Yes':'No',revoke];}));
}
$('saveAccess').onclick=async()=>{try{if(!$('accessEmail').reportValidity())return;const b={clubId:$('accessClub').value,email:$('accessEmail').value.trim().toLowerCase(),role:$('accessRole').value,active:true};if(mode==='demo'){const previous=demo.access.find(a=>a.email===b.email&&a.club_id===b.clubId);if(previous)Object.assign(previous,b);else demo.access.push({...b,club_id:b.clubId});}else await post('/api/organiser/access',b);await accessList();tell('Club access saved.');}catch(e){tell(e.message);}};
$('correctLink').onclick=async()=>{try{const b={reportId:$('correctReport').value.trim(),showId:$('correctShow').value,ring:$('correctRing').value.trim(),judge:$('correctJudge').value.trim()||undefined};if(!b.reportId||!b.showId||!b.ring)throw new Error('Report ID, target show and ring are required.');if(mode==='demo'){const r=demo.links.find(r=>r.id===b.reportId);if(!r)throw new Error('Report ID not found.');Object.assign(r,{show_id:b.showId,ring:b.ring,judge:b.judge||r.judge});}else await post('/api/organiser/correct-link',b);await refresh();await accessList();tell('Dashboard association corrected. Original report contents remain unchanged.');}catch(e){tell(e.message);}};
$('standardise').onclick=async()=>{try{const b={clubId:$('standardClub').value,name:$('standardName').value.trim(),aliases:$('standardAliases').value.split('\n').map(s=>s.trim()).filter(Boolean)};if(!b.clubId||!b.name)throw new Error('Select a breed / speciality club and enter a canonical name.');if(mode==='demo')demo.clubs.find(c=>c.id===b.clubId).name=b.name;else await post('/api/organiser/clubs',b);if(mode==='live')allClubs=(await api('/api/organiser/session')).clubs;viewSetup();await refresh();tell('Canonical club name saved; original report names are preserved.');}catch(e){tell(e.message);}};
try{
 const response=await fetch('./breeds.json');if(!response.ok)throw new Error('Breed directory could not load.');breeds=await response.json();$('loadDemo').disabled=false;
 if(location.hostname.endsWith('.github.io'))throw new Error('Test mode — live club login and central reporting status are not connected on this public preview. Load demonstration data to try the module.');
 user=await api('/api/organiser/session');mode='live';allClubs=user.clubs;$('loadDemo').hidden=true;$('connection').textContent='Connected. Club scope and permissions are verified on every request.';viewSetup();await refresh();if(user.role==='manager')await accessList();
}catch(e){$('connection').textContent=e.message;}
setInterval(()=>{if(mode==='live'&&!document.hidden)refresh(true);},20000);

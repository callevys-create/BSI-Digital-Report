import {statistics,statisticTables,csv,VERSION} from './statistics.mjs';
const $=id=>document.getElementById(id),fmt=(n,d=1)=>n===null?'Not available':Number(n).toFixed(d);
let mode='disconnected',data=null,samples=[],breeds=[];
const notice=s=>$('status').textContent=s;
async function api(path,options={}){
 const r=await fetch(path,{credentials:'same-origin',...options});
 if(!r.ok){let message='Request failed';try{message=(await r.json()).error||message;}catch{}throw new Error(message);}return r.json();
}
function table(id,headers,rows){
 const target=$(id);target.replaceChildren();const head=document.createElement('thead'),hr=document.createElement('tr');
 headers.forEach(s=>{const th=document.createElement('th');th.textContent=s;hr.append(th);});head.append(hr);target.append(head);
 const body=document.createElement('tbody');rows.forEach(row=>{const tr=document.createElement('tr');row.forEach(s=>{const td=document.createElement('td');td.textContent=s??'Not available';tr.append(td);});body.append(tr);});target.append(body);
}
function selectedFilters(){return {start:$('start').value,end:$('end').value,breed:$('breed').value};}
function invalidate(){data=null;$('results').hidden=true;for(const id of ['pdf','excel','csv','chart'])$(id).disabled=true;notice('Selection changed. Generate statistics to refresh the results.');}
for(const id of ['start','end','breed'])$(id).onchange=invalidate;
function query(filters,format){const q=new URLSearchParams(filters);if(format)q.set('format',format);return '/api/admin/statistics?'+q;}
async function generate(){
 try{
  $('generate').disabled=true;
  const filters=selectedFilters();
  // Validate before either demo aggregation or a live request.
  statistics([],filters);
  data=mode==='demo'?statistics(samples,filters):await api(query(filters));
  if(mode==='demo')data.definitions='DEMONSTRATION DATA — synthetic examples only. '+data.definitions;
  render();notice(`${mode==='demo'?'DEMONSTRATION DATA — ':''}${data.summary.reports} reports selected. ${data.summary.reports?'Results ready.':'No data in this period; percentages are not available.'}`);
 }catch(error){invalidate();notice(error.message);}finally{$('generate').disabled=false;}
}
$('generate').onclick=generate;
function render(){
 $('results').hidden=false;
 $('summary').replaceChildren();for(const [label,value] of [['Reports',data.summary.reports],['Shows represented',data.summary.shows],['Judging observations',data.summary.dogs]]){const d=document.createElement('div');d.className='metric';const strong=document.createElement('strong');strong.textContent=value;d.append(strong,document.createTextNode(label));$('summary').append(d);}
 $('definitions').textContent=data.definitions;
 $('coverage').textContent=`Coverage: ${data.years.map(y=>`${y.year}: ${y.reports} reports`).join('; ')}. Not assessed: ${data.missing.notAssessed} area observations (may count the same dog in several areas). Unversioned reports: ${data.missing.legacyVersion}.`;
 table('annual',['Breed','Year','BSI version','Reports','Shows','Dogs judged','Grading affected','Placing affected'],data.annual.map(t=>[t.breed,t.year,t.version,t.reports,t.shows,t.dogs,`${t.quality} (${fmt(t.qualityPct)}%)`,`${t.placing} (${fmt(t.placingPct)}%)`]));
 table('areas',['Breed','Year','BSI version','Area','Reports','Assessed','No concerns','Mild','Clear','Severe','Not assessed','Concerns','Concern %','Change (pp)','Relative change %','Description'],data.areas.map(r=>[r.breed,r.year,r.version,r.risk,r.reports,r.assessed,`${r.none} (${fmt(r.nonePct)}%)`,`${r.mild} (${fmt(r.mildPct)}%)`,`${r.clear} (${fmt(r.clearPct)}%)`,`${r.severe} (${fmt(r.severePct)}%)`,`${r.na} (${fmt(r.notAssessedPct)}% of all)`,r.concerns,fmt(r.concernPct),fmt(r.changePP),fmt(r.relativeChangePct),r.trend]));
 const choices=new Map(data.areas.map(r=>[JSON.stringify([r.breed,r.version,r.risk]),`${r.breed} / ${r.version} / ${r.risk}`]));
 $('area').replaceChildren();for(const [value,label] of choices){const o=document.createElement('option');o.value=value;o.textContent=label;$('area').append(o);}drawChart();
 $('observations').replaceChildren();if(!data.observations.length)$('observations').textContent='No other or positive observations recorded.';
 for(const o of data.observations){const a=document.createElement('article');a.textContent=`${o.breed} — ${o.date} — ${o.id}\nPositive: ${o.positive||'None recorded'}\n${o.other.map(r=>`${r.problem} — ${r.count} affected`).join('\n')}`;$('observations').append(a);}
 for(const id of ['pdf','excel','csv'])$(id).disabled=false;$('chart').disabled=!choices.size;
}
$('area').onchange=drawChart;
function drawChart(){
 const target=$('plot');target.replaceChildren();if(!data?.areas.length){target.textContent='No assessed areas in this selection.';return;}
 const selected=JSON.parse($('area').value),rows=data.areas.filter(r=>r.breed===selected[0]&&r.version===selected[1]&&r.risk===selected[2]);
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 900 350');svg.setAttribute('role','img');svg.setAttribute('aria-label',`${selected[0]}: ${selected[2]} — annual concern percentages`);
 const add=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;svg.append(e);return e;};
 add('rect',{width:900,height:350,fill:'#ffffff'});
 add('text',{x:70,y:24,fill:'#183047','font-size':14},mode==='demo'?'DEMONSTRATION — concern rate among assessed observations':'Concern rate among assessed observations');
 for(let p=0;p<=100;p+=25){const y=280-p*2.1;add('line',{x1:70,x2:855,y1:y,y2:y,stroke:'#dce5ec'});add('text',{x:18,y:y+4,'font-size':12,fill:'#506778'},p+'%');}
 let prev=null;data.years.forEach((year,i)=>{
  const x=data.years.length===1?460:70+i*785/(data.years.length-1),r=rows.find(r=>r.year===year.year);
  add('text',{x,y:308,'text-anchor':'middle','font-size':12,fill:'#183047'},year.year);
  if(!r||r.concernPct===null){prev=null;add('text',{x,y:330,'text-anchor':'middle','font-size':10,fill:'#506778'},'No assessed data');return;}
  const y=280-r.concernPct*2.1;
  if(prev)add('line',{x1:prev.x,y1:prev.y,x2:x,y2:y,stroke:'#174a6b','stroke-width':3});
  add('circle',{cx:x,cy:y,r:5,fill:'#174a6b'});add('text',{x,y:y-12,'text-anchor':'middle','font-size':12,fill:'#183047'},fmt(r.concernPct)+'%');
  add('text',{x,y:330,'text-anchor':'middle','font-size':10,fill:'#506778'},`n=${r.assessed}; reports=${r.reports}`);prev={x,y};
 });target.append(svg);
}
function download(bytes,name,type){const blob=new Blob([bytes],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function exportFile(format){
 if(!data)return;
 const button=$(format==='xlsx'?'excel':'pdf');button.disabled=true;
 try{
  if(mode==='live'){
   const r=await fetch(query(data.filters,format),{credentials:'same-origin'});if(!r.ok)throw new Error('Export failed; check your session.');download(await r.arrayBuffer(),`BSI-statistics.${format}`,r.headers.get('Content-Type'));
  }else{
   const exports=await import('./exports-client.js');
   const bytes=format==='xlsx'?exports.excelBytes(data):await exports.statisticsPDF({...data,definitions:'DEMONSTRATION DATA. '+data.definitions},new Uint8Array(await fetch('./NotoSans-Regular.ttf').then(r=>r.arrayBuffer())));
   download(bytes,`BSI-DEMO-statistics.${format}`,format==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/pdf');
  }
  notice(`${mode==='demo'?'Demonstration ':''}${format.toUpperCase()} downloaded.`);
 }catch(error){notice(error.message);}finally{button.disabled=false;}
}
$('pdf').onclick=()=>exportFile('pdf');$('excel').onclick=()=>exportFile('xlsx');
$('csv').onclick=()=>{if(!data)return;const areas=statisticTables(data).find(t=>t.name==='Areas');download(csv(areas.rows),`BSI-${mode==='demo'?'DEMO-':''}areas.csv`,'text/csv;charset=utf-8');};
$('chart').onclick=()=>{const svg=$('plot').querySelector('svg');if(svg)download(new XMLSerializer().serializeToString(svg),`BSI-${mode==='demo'?'DEMO-':''}trend.svg`,'image/svg+xml');};
function makeSamples(){
 const list=[];for(let year=2026;year<=2030;year++)for(const b of [breeds[4],breeds[35]])for(let j=0;j<2;j++){
  const total=20+j*10,na=year===2028?4:2,concerns=8-(year-2026);
  list.push({id:`DEMO-${year}-${b.name.startsWith('Pug')?'PUG':'BULLDOG'}-${j+1}`,schema:'bsi-prototype-2',source:'Synthetic demonstration',bsiVersion:VERSION,show:`Example show ${j+1}`,date:`${year}-0${j+5}-15`,judge:'Synthetic judge',country:'Example country',breed:b.name,group:b.group,total,risks:b.risks.map(risk=>({risk,none:total-na-concerns,mild:concerns-2,clear:1,severe:1,na})),other:j?[{problem:'Synthetic example of another concern',count:1}]:[],positive:'Synthetic example: free movement',quality:2,placing:1,comments:'Demonstration only - no real dogs or judges.'});
 }return list;
}
$('demo').onclick=()=>{
 mode='demo';samples=makeSamples();$('connection').textContent='DEMONSTRATION MODE — synthetic data only. Nothing here is submitted or emailed. Refresh this page to return to the live connection check.';$('management').hidden=true;$('generate').disabled=false;generate();
};
async function recipients(){
 const rows=await api('/api/admin/recipients');$('recipients').replaceChildren();
 for(const r of rows.filter(r=>r.active)){
  const row=document.createElement('div');row.className='recipient';const label=document.createElement('span');label.textContent=r.email;row.append(label);
  const edit=document.createElement('button');edit.className='secondary';edit.textContent='Edit';edit.onclick=()=>{$('recipientID').value=r.id;$('recipientEmail').value=r.email;};row.append(edit);
  const remove=document.createElement('button');remove.className='danger';remove.textContent='Disable';remove.onclick=async()=>{try{await api('/api/admin/recipients/'+encodeURIComponent(r.id),{method:'DELETE'});await recipients();await history();notice('Recipient disabled for future reports.');}catch(e){notice(e.message);}};row.append(remove);$('recipients').append(row);
 }
}
$('cancelRecipient').onclick=()=>{$('recipientID').value='';$('recipientEmail').value='';};
$('saveRecipient').onclick=async()=>{
 if(!$('recipientEmail').reportValidity())return;
 try{await api('/api/admin/recipients',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:$('recipientID').value||undefined,email:$('recipientEmail').value})});$('cancelRecipient').click();await recipients();await history();notice('Recipient saved for future reports.');}catch(e){notice(e.message);}
};
async function deliveries(){const rows=await api('/api/admin/deliveries');table('deliveries',['Report ID','Recipient','Purpose','Status','Attempts','Last issue','Updated'],rows.map(r=>[r.report_id,r.email,r.purpose,r.status,r.attempts,r.last_error||'',r.updated_at]));}
async function history(){const rows=await api('/api/admin/audit');table('audit',['Administrator','Action','Target','Time'],rows.map(r=>[r.actor,r.action,r.target,r.created_at]));}
$('refreshDeliveries').onclick=()=>deliveries().catch(e=>notice(e.message));
try{
 const r=await fetch('./breeds.json');if(!r.ok)throw new Error('Breed list could not load.');breeds=await r.json();$('demo').disabled=false;
 for(const b of breeds){const o=document.createElement('option');o.value=b.name;o.textContent=b.name;$('breed').append(o);}
 // On GitHub Pages this is intentionally a public, synthetic-only preview.
 if(location.hostname.endsWith('.github.io'))throw new Error('Live administration is not connected here. Use the protected backend administration URL after setup, or load demonstration data.');
 const session=await api('/api/admin/session');mode='live';$('connection').textContent=`Connected — ${session.role} session. Only authorised reports are available.`;$('demo').hidden=true;$('generate').disabled=false;
 if(session.role==='manager'){$('management').hidden=false;await recipients();await deliveries();await history();}
 await generate();
}catch(e){$('connection').textContent=e.message;}

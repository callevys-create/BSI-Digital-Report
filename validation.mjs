import {validOrganiser,clubFor} from './clubs.mjs';
import breeds from './breeds.json' with {type:'json'};
import { validDate, VERSION } from './statistics.mjs';
export const emailValid=s=>typeof s==='string' && s.length<=254 && /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(s);
export const keyValid=s=>typeof s==='string' && /^[A-Za-z0-9_-]{32,100}$/.test(s);
export function validate(body) {
 const p=body?.report;
 if(!validOrganiser(p))return false;
 const str=(s,max=4000)=>typeof s==='string'&&s.length<=max;
 if(!p || !Number.isInteger(p.total)||p.total<1||p.total>100000 || p.bsiVersion!==VERSION) return false;
 const count=n=>Number.isInteger(n)&&n>=0&&n<=p.total;
 if(!['show','judge','country','breed','group','positive','comments'].every(k=>str(p[k])) || !['show','judge','country','breed'].every(k=>p[k].trim()) || !validDate(p.date) || !count(p.quality)||!count(p.placing))return false;
 const breed=breeds.find(b=>b.name===p.breed && b.group===p.group), risks=p.group==='Not BSI-listed'?[]:breed?.risks;
 if(!risks || !Array.isArray(p.risks)||p.risks.length!==risks.length || !Array.isArray(p.other)||p.other.length>100)return false;
 if(!p.risks.every((r,i)=>r && r.risk===risks[i] && ['none','mild','clear','severe','na'].every(k=>count(r[k])) && ['none','mild','clear','severe','na'].reduce((n,k)=>n+r[k],0)===p.total))return false;
 if(!p.other.every(r=>r&&str(r.problem)&&r.problem.trim()&&count(r.count)))return false;
 if(typeof body.sendCopy!=='boolean' || body.sendCopy&&!emailValid(body.email))return false;
 return true;
}
// Whitelist the saved fields: no injected destinations, status, or hidden metadata.
export function canonicalReport(p) {
 const result=Object.fromEntries(['schema','source','bsiVersion','show','date','judge','country','breed','group','total','risks','other','positive','quality','placing','comments','ring','showId'].map(k=>[k,p[k]??'']));
 result.organisingClub=p.organisingClub.type==='regional'?{type:'regional',...clubFor(p.organisingClub.id)}:{type:'speciality',name:p.organisingClub.name.trim()};
 return result;
}
export async function hash(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function readText(request,limit=65536) {
 const reader=request.body?.getReader();if(!reader)throw Object.assign(new Error('Body required'),{status:400});
 let size=0;const chunks=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Object.assign(new Error('Request too large'),{status:413});}chunks.push(value);}
 const data=new Uint8Array(size);let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.length;}
 return new TextDecoder().decode(data);
}
export async function readJSON(request,limit=65536) {
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw Object.assign(new Error('JSON required'),{status:415});
 const text=await readText(request,limit);
 try{return JSON.parse(text);}catch{throw Object.assign(new Error('Invalid JSON'),{status:400});}
}

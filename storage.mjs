import {hash, canonicalReport} from './validation.mjs';
import {showKey} from './statistics.mjs';
export class Conflict extends Error {constructor(){super('This submission key was already used for different content.');this.status=409;}}
export async function saveSubmission(env,body) {
 const report=canonicalReport(body.report), json=JSON.stringify(report);
 const contact=body.sendCopy?body.email.trim().toLowerCase():'';
 const payloadHash=await hash(JSON.stringify({report,sendCopy:body.sendCopy,email:contact})), receiptHash=await hash(body.receiptKey);
 const existing=await env.DB.prepare('SELECT id,payload_hash,receipt_hash FROM submissions WHERE submission_key=?').bind(body.submissionKey).first();
 const verify=row=>{if(row.payload_hash!==payloadHash || row.receipt_hash!==receiptHash)throw new Conflict();return {id:row.id,duplicate:true};};
 if(existing)return verify(existing);
 const recipients=(await env.DB.prepare('SELECT email FROM recipients WHERE active=1 ORDER BY email').all()).results;
 if(!recipients.length)throw Object.assign(new Error('SKK report recipients have not been configured.'),{status:503});
 const id=crypto.randomUUID(), now=new Date().toISOString();
 const destinations=new Map(recipients.map(r=>[r.email.toLowerCase(),'SKK']));
 if(contact)destinations.set(contact,destinations.has(contact)?'SKK and judge':'judge');
 const statements=[env.DB.prepare('INSERT INTO submissions (id,submission_key,receipt_hash,payload_hash,created_at,show_date,show_key,breed,bsi_version,total,quality,placing,report_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,body.submissionKey,receiptHash,payloadHash,now,report.date,showKey(report),report.breed,report.bsiVersion,report.total,report.quality,report.placing,json)];
 report.risks.forEach((r,i)=>statements.push(env.DB.prepare('INSERT INTO assessments (report_id,area_index,area,none_count,mild,clear_count,severe,not_assessed) VALUES (?,?,?,?,?,?,?,?)').bind(id,i,r.risk,r.none,r.mild,r.clear,r.severe,r.na)));
 for(const [email,purpose] of destinations)statements.push(env.DB.prepare('INSERT INTO deliveries (id,report_id,email,purpose,updated_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),id,email,purpose,now));
 try{await env.DB.batch(statements);}catch(error){
  // A concurrent request may have won the unique-key race; compare before returning.
  const row=await env.DB.prepare('SELECT id,payload_hash,receipt_hash FROM submissions WHERE submission_key=?').bind(body.submissionKey).first();
  if(row)return verify(row);throw error;
 }
 return {id,duplicate:false};
}
export async function receiptReport(env,id,key) {
 if(!key)return null;
 const p=await env.DB.prepare('SELECT * FROM submissions WHERE id=? AND receipt_hash=?').bind(id,await hash(key)).first();
 return p;
}
export async function loadStatisticsReports(env,filters) {
 // Read every matching report in pages. Refuse oversized ranges rather than silently truncate.
 const rows=[];let offset=0;
 while(true){
  const page=(await env.DB.prepare('SELECT id,report_json,show_key FROM submissions WHERE show_date>=? AND show_date<=? AND (?=\'\' OR breed=?) ORDER BY id LIMIT 250 OFFSET ?').bind(filters.start,filters.end,filters.breed,filters.breed,offset).all()).results;
  for(const r of page)rows.push({...JSON.parse(r.report_json),id:r.id,showKey:r.show_key});
  if(rows.length>10000)throw Object.assign(new Error('This selection exceeds 10,000 reports. Choose a smaller date range or one breed.'),{status:422});
  if(page.length<250)break;offset+=250;
 }
 return rows;
}

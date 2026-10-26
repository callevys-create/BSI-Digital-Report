import { reportPDF } from './exports.mjs';
export async function fontBytes(env) {
 const result=await env.ASSETS.fetch(new Request('https://assets.invalid/NotoSans-Regular.ttf'));
 if(!result.ok)throw new Error('Report font unavailable');return new Uint8Array(await result.arrayBuffer());
}
export async function ensurePDF(env,row) {
 const key=`reports/${row.id}.pdf`, existing=await env.PDFS.get(key);
 if(existing)return new Uint8Array(await existing.arrayBuffer());
 const bytes=await reportPDF(JSON.parse(row.report_json),row.id,await fontBytes(env));
 await env.PDFS.put(key,bytes,{httpMetadata:{contentType:'application/pdf'}});
 await env.DB.prepare('UPDATE submissions SET pdf_key=? WHERE id=?').bind(key,row.id).run();
 return bytes;
}
function base64(bytes) {let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
export async function recordEvent(env,d,event) {
 await env.DB.prepare('INSERT INTO delivery_events (id,delivery_id,report_id,event,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),d.id,d.report_id,event,new Date().toISOString()).run();
}
export async function reconcileProvider(env,providerID) {
 // Terminal failures outrank acceptance and delivery; late events cannot regress the status.
 const events=(await env.DB.prepare('SELECT event_type FROM provider_events WHERE provider_id=?').bind(providerID).all()).results.map(r=>r.event_type);
 const status=events.includes('email.bounced')?'bounced':events.includes('email.complained')?'complained':events.includes('email.failed')?'failed':events.includes('email.delivered')?'delivered':null;
 if(status)await env.DB.prepare('UPDATE deliveries SET status=?,updated_at=? WHERE provider_id=?').bind(status,new Date().toISOString(),providerID).run();
}
export async function processOutbox(env,limit=5) {
 if(!env.DB || !env.PDFS || !env.RESEND_API_KEY || !env.MAIL_FROM)return;
 const now=Date.now();
 const rows=(await env.DB.prepare("SELECT * FROM deliveries WHERE status IN ('pending','retry','sending') AND next_attempt<=? AND lease_until<? ORDER BY next_attempt,id LIMIT ?").bind(now,now,limit).all()).results;
 for(const d of rows) {
  const claim=await env.DB.prepare("UPDATE deliveries SET status='sending',lease_until=?,attempts=attempts+1,first_attempt=COALESCE(first_attempt,?),updated_at=? WHERE id=? AND lease_until<? AND attempts=? AND status IN ('pending','retry','sending')").bind(now+180000,now,new Date().toISOString(),d.id,now,d.attempts).run();
  if(!claim.meta.changes)continue;
  const attempts=d.attempts+1;
  if(d.first_attempt && now-d.first_attempt>23*3600000) {
   await env.DB.prepare("UPDATE deliveries SET status='uncertain',last_error='Retry window expired; check provider before re-sending',lease_until=0,updated_at=? WHERE id=?").bind(new Date().toISOString(),d.id).run();
   await recordEvent(env,d,'uncertain');continue;
  }
  let resultStatus='retry',errorCode='',providerID=null;
  try {
   const report=await env.DB.prepare('SELECT * FROM submissions WHERE id=?').bind(d.report_id).first();
   const pdf=await ensurePDF(env,report),p=JSON.parse(report.report_json);
   const response=await fetch('https://api.resend.com/emails',{
    method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`bsi-delivery/${d.id}`},
    body:JSON.stringify({from:env.MAIL_FROM,to:[d.email],subject:`BSI report - ${p.breed} - ${p.date}`,
     text:`Completed BSI report\nReport ID: ${report.id}\n\nThe complete, saved report is attached as a PDF. This same report is distributed to SKK and to the judge when requested.\n\nWorking prototype; not an official FCI form.`,
     attachments:[{filename:`BSI-${report.id}.pdf`,content:base64(pdf)}]}),signal:AbortSignal.timeout(15000)
   });
   if(response.ok){const sent=await response.json();if(!sent.id)throw new Error('missing provider id');providerID=sent.id;resultStatus='accepted';}
   else {errorCode=`provider_http_${response.status}`;if(response.status>=400 && response.status<500 && ![408,409,429].includes(response.status))resultStatus='failed';}
  } catch {errorCode='temporary_or_unconfirmed_error';}
  if(resultStatus==='retry'&&attempts>=8)resultStatus='uncertain';
  const delay=Math.min(3600000,60000*2**Math.min(attempts,6));
  await env.DB.prepare('UPDATE deliveries SET status=?,provider_id=COALESCE(?,provider_id),last_error=?,lease_until=0,next_attempt=?,updated_at=? WHERE id=?').bind(resultStatus,providerID,errorCode||null,Date.now()+delay,new Date().toISOString(),d.id).run();
  await recordEvent(env,d,resultStatus);
  if(providerID)await reconcileProvider(env,providerID);
 }
}

import { Webhook } from 'svix';
import {validate,emailValid,keyValid,readJSON,readText,hash} from './validation.mjs';
import {saveSubmission,receiptReport,loadStatisticsReports} from './storage.mjs';
import {statistics,validDate,VERSION} from './statistics.mjs';
import {administrator,sameOrigin} from './auth.mjs';
import {ensurePDF,processOutbox,reconcileProvider} from './delivery.mjs';
import {excelBytes,statisticsPDF} from './exports.mjs';
import {fontBytes} from './delivery.mjs';
export {validate};
const json=(data,status=200,extra={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
const failure=(message,status)=>{throw Object.assign(new Error(message),{status});};
async function audit(env,actor,action,target){await env.DB.prepare('INSERT INTO audit_log (id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),actor,action,target,new Date().toISOString()).run();}
function filtersFor(url){
 const filters={start:url.searchParams.get('start')||'',end:url.searchParams.get('end')||'',breed:url.searchParams.get('breed')||''};
 if(!validDate(filters.start)||!validDate(filters.end)||filters.start>filters.end)failure('Choose valid start and end dates.',400);return filters;
}
async function adminAPI(request,env,url,user) {
 const path=url.pathname, manager=()=>{if(user.role!=='manager')failure('Manager permission required.',403);};
 if(request.method!=='GET')sameOrigin(request);
 if(path==='/api/admin/session')return json({role:user.role,email:user.email,version:VERSION});
 if(path==='/api/admin/recipients') {
  manager();
  if(request.method==='GET')return json((await env.DB.prepare('SELECT id,email,active FROM recipients ORDER BY email').all()).results);
  if(request.method==='POST'){
   const b=await readJSON(request,2048);if(!emailValid(b.email))failure('A valid recipient email is required.',400);
   const email=b.email.trim().toLowerCase();const previous=await env.DB.prepare('SELECT id FROM recipients WHERE email=?').bind(email).first();if(b.id&&previous&&previous.id!==b.id)failure('This address is already assigned to another recipient.',409);const id=b.id||previous?.id||crypto.randomUUID();if(b.id&&!keyValid(b.id.replaceAll('-','')))failure('Invalid recipient ID',400);
   await env.DB.batch([
    env.DB.prepare('INSERT INTO recipients (id,email,active,updated_at) VALUES (?,?,1,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,active=1,updated_at=excluded.updated_at').bind(id,email,new Date().toISOString()),
    env.DB.prepare('INSERT INTO audit_log (id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),user.email,'recipient_saved',id,new Date().toISOString())
   ]);return json({id});
  }
 }
 if(path.startsWith('/api/admin/recipients/')&&request.method==='DELETE'){
  manager();const id=path.split('/').pop();
  const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM recipients WHERE active=1').first();
  if(count.n<=1)failure('Keep at least one active SKK recipient.',409);
  const changed=await env.DB.prepare('UPDATE recipients SET active=0,updated_at=? WHERE id=? AND active=1 AND (SELECT COUNT(*) FROM recipients WHERE active=1)>1').bind(new Date().toISOString(),id).run();if(!changed.meta.changes)failure('Keep at least one active SKK recipient.',409);await audit(env,user.email,'recipient_disabled',id);return json({disabled:true});
 }
 if(path==='/api/admin/statistics'&&request.method==='GET') {
  const filters=filtersFor(url),data=statistics(await loadStatisticsReports(env,filters),filters);
  const format=url.searchParams.get('format');
  if(format==='xlsx'||format==='pdf') {
   await audit(env,user.email,`statistics_export_${format}`,JSON.stringify(filters));
   const bytes=format==='xlsx'?excelBytes(data):await statisticsPDF(data,await fontBytes(env));
   return new Response(bytes,{headers:{'Content-Type':format==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/pdf','Content-Disposition':`attachment; filename="BSI-statistics.${format}"`,'Cache-Control':'no-store'}});
  }
  return json(data);
 }
 if(path==='/api/admin/deliveries'&&request.method==='GET') {
  manager();return json((await env.DB.prepare('SELECT id,report_id,email,purpose,status,attempts,last_error,updated_at FROM deliveries ORDER BY updated_at DESC LIMIT 200').all()).results);
 }
 if(path==='/api/admin/audit'&&request.method==='GET') {manager();return json((await env.DB.prepare('SELECT actor,action,target,created_at FROM audit_log ORDER BY created_at DESC LIMIT 200').all()).results);}
 failure('Not found',404);
}
async function webhook(request,env) {
 if(!env.RESEND_WEBHOOK_SECRET)failure('Webhook not configured',503);
 const text=await readText(request,65536);
 let event;try{new Webhook(env.RESEND_WEBHOOK_SECRET).verify(text,{'svix-id':request.headers.get('svix-id'),'svix-timestamp':request.headers.get('svix-timestamp'),'svix-signature':request.headers.get('svix-signature')});event=JSON.parse(text);}catch{failure('Invalid webhook signature',401);}
 const supported=['email.delivered','email.bounced','email.complained','email.failed'];
 if(!supported.includes(event.type))return json({ignored:true});
 const id=request.headers.get('svix-id'),providerID=event.data?.email_id;
 if(typeof providerID!=='string')failure('Missing email ID',400);
 await env.DB.prepare('INSERT OR IGNORE INTO provider_events (id,provider_id,event_type,occurred_at) VALUES (?,?,?,?)').bind(id,providerID,event.type,event.created_at||new Date().toISOString()).run();
 await reconcileProvider(env,providerID);return json({received:true});
}
async function route(request,env,ctx) {
 const url=new URL(request.url),path=url.pathname;
 if(path==='/health')return json({prototype:true,onlineSubmissionConfigured:Boolean(env.DB&&env.PDFS&&env.TURNSTILE_SECRET&&env.RESEND_API_KEY&&env.MAIL_FROM),bsiVersion:VERSION});
 if(path==='/webhooks/resend'&&request.method==='POST')return webhook(request,env);
 if(path.startsWith('/api/admin/') || path==='/admin' || path==='/admin.html') {
  const user=await administrator(request,env);
  if(path.startsWith('/api/admin/'))return adminAPI(request,env,url,user);
  const asset=await env.ASSETS.fetch(new Request(new URL('/admin.html',request.url)));
  const h=new Headers(asset.headers);h.set('Cache-Control','no-store');h.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");return new Response(asset.body,{status:asset.status,headers:h});
 }
 if(path.startsWith('/receipts/')&&request.method==='GET') {
  const id=path.split('/')[2], key=request.headers.get('Authorization')?.replace(/^Bearer /,'');
  const p=await receiptReport(env,id,key);if(!p)failure('Receipt not found',404);
  if(path.endsWith('/pdf'))return new Response(await ensurePDF(env,p),{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="BSI-${id}.pdf"`,'Cache-Control':'no-store'}});
  const deliveries=(await env.DB.prepare('SELECT purpose,status FROM deliveries WHERE report_id=?').bind(id).all()).results;
  return json({id,submitted:true,deliveries});
 }
 if(path==='/reports') {
  if(request.headers.get('Origin')!==env.ALLOWED_ORIGIN)failure('Origin denied',403);
  if(request.method==='OPTIONS')return new Response(null,{status:204});
  if(request.method!=='POST')failure('Method not allowed',405);
  if(!env.DB||!env.PDFS||!env.RATE_LIMITER||!env.TURNSTILE_SECRET||!env.RESEND_API_KEY||!env.MAIL_FROM||env.MAIL_FROM.includes('YOUR-'))failure('Online submission has not been connected. Please download the report.',503);
  if(!(await env.RATE_LIMITER.limit({key:request.headers.get('CF-Connecting-IP')||'unknown'})).success)failure('Too many requests; try again later.',429);
  const b=await readJSON(request);
  if(!validate(b)||!keyValid(b.submissionKey)||!keyValid(b.receiptKey)||typeof b.token!=='string'||!b.token||b.token.length>2048)failure('Check required show details, report counts and email.',400);
  const verified=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:env.TURNSTILE_SECRET,response:b.token,remoteip:request.headers.get('CF-Connecting-IP')||''}),signal:AbortSignal.timeout(8000)});
  const result=await verified.json();
  if(!result.success||result.hostname!==env.ALLOWED_HOSTNAME||result.action!=='bsi-submit')failure('Verification expired or failed. Please verify again.',403);
  const saved=await saveSubmission(env,b);
  ctx.waitUntil(processOutbox(env).catch(()=>{}));
  return json({submitted:true,id:saved.id,duplicate:saved.duplicate,distribution:'queued'},saved.duplicate?200:201);
 }
 // Only explicitly public assets can be served. Never expose private storage through assets.
 if(['/admin.js','/admin.css','/statistics.mjs','/exports-client.js','/NotoSans-Regular.ttf','/breeds.json'].includes(path))return env.ASSETS.fetch(request);
 failure('Not found',404);
}
export default {
 async fetch(request,env,ctx={waitUntil:()=>{}}) {
  let response;try{response=await route(request,env,ctx);}catch(error){response=json({error:error.status?error.message:'Service temporarily unavailable. The report may already have been saved.'},error.status||503);}
  const h=new Headers(response.headers);h.set('X-Content-Type-Options','nosniff');h.set('Referrer-Policy','no-referrer');
  const path=new URL(request.url).pathname;
  if((path==='/reports'||path.startsWith('/receipts/'))&&request.headers.get('Origin')===env.ALLOWED_ORIGIN){h.set('Access-Control-Allow-Origin',env.ALLOWED_ORIGIN);h.set('Vary','Origin');h.set('Access-Control-Allow-Methods','GET, POST, OPTIONS');h.set('Access-Control-Allow-Headers','Content-Type, Authorization');}
  if(path.startsWith('/receipts/')&&request.method==='OPTIONS'&&request.headers.get('Origin')===env.ALLOWED_ORIGIN)return new Response(null,{status:204,headers:h});
  return new Response(response.body,{status:response.status,headers:h});
 },
 async scheduled(event,env,ctx){ctx.waitUntil(processOutbox(env,10));}
};

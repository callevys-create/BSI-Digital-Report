import breeds from './breeds.json' with { type: 'json' };
export function validate(body) {
  const p = body?.report;
  const str = (v, max = 4000) => typeof v === 'string' && v.length <= max;
  const count = v => Number.isInteger(v) && v >= 0 && v <= p.total;
  if (!p || !Number.isInteger(p.total) || p.total < 1 || p.total > 100000 ||
      !['show','date','judge','country','breed','group','positive','comments'].every(k => str(p[k])) ||
      !count(p.quality) || !count(p.placing) || !Array.isArray(p.risks) || !Array.isArray(p.other) || p.other.length > 100) return false;
  const breed = breeds.find(b => b.name === p.breed && b.group === p.group);
  if (p.group !== 'Not BSI-listed' && !breed) return false;
  const risks = p.group === 'Not BSI-listed' ? [] : breed.risks;
  if (!p.breed.trim() || p.risks.length !== risks.length) return false;
  if (!p.risks.every((r,i) => r.risk === risks[i] && ['none','mild','clear','severe','na'].every(k => count(r[k])) && ['none','mild','clear','severe','na'].reduce((n,k) => n+r[k],0) === p.total)) return false;
  if (!p.other.every(r => str(r.problem) && count(r.count))) return false;
  return typeof body.sendCopy === 'boolean' && (!body.sendCopy || (str(body.email,254) && /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(body.email)));
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin' };
    const reply = (data, status = 200) => Response.json(data, { status, headers });
    if (origin !== env.ALLOWED_ORIGIN) return reply({error:'Origin denied'},403);
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    if (new URL(request.url).pathname !== '/reports') return reply({error:'Not found'},404);
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers});
    if (request.method !== 'POST') return reply({error:'Method not allowed'},405);
    if (!env.DB || !env.RATE_LIMITER || !env.TURNSTILE_SECRET || !env.RESEND_API_KEY || !env.MAIL_FROM) return reply({error:'Service not configured'},503);
    try {
      const limited = await env.RATE_LIMITER.limit({key:request.headers.get('CF-Connecting-IP') || 'unknown'});
      if (!limited.success) return reply({error:'Too many requests'},429);
      if (!request.headers.get('Content-Type')?.startsWith('application/json')) return reply({error:'JSON required'},415);
      // Bound the stream before parsing, including requests without Content-Length.
      const reader = request.body?.getReader();
      if (!reader) return reply({error:'Body required'},400);
      const chunks=[]; let size=0;
      while (true) { const {done,value}=await reader.read(); if(done) break; size+=value.length; if(size>65536){await reader.cancel();return reply({error:'Too large'},413);} chunks.push(value); }
      const bytes=new Uint8Array(size); let offset=0; for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
      let body; try { body=JSON.parse(new TextDecoder().decode(bytes)); } catch { return reply({error:'Invalid JSON'},400); }
      if (!validate(body) || typeof body.token !== 'string' || body.token.length > 2048) return reply({error:'Invalid report'},400);
      const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method:'POST', body:new URLSearchParams({secret:env.TURNSTILE_SECRET,response:body.token,remoteip:request.headers.get('CF-Connecting-IP') || ''}), signal:AbortSignal.timeout(8000)
      });
      const checked=await verification.json();
      if (!checked.success || checked.hostname !== env.ALLOWED_HOSTNAME || checked.action !== 'bsi-submit') return reply({error:'Verification failed'},403);
      const id=crypto.randomUUID();
      // Store the completed report first. Email failure must never undo submission.
      const report=JSON.stringify(body.report,null,2);
      await env.DB.prepare('INSERT INTO reports (id, created_at, report, copy_requested) VALUES (?, ?, ?, ?)').bind(id,new Date().toISOString(),report,body.sendCopy?1:0).run();
      let email='not_requested';
      if (body.sendCopy) {
        email='failed';
        try {
          const sent=await fetch('https://api.resend.com/emails', {
            method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`bsi/${id}`},
            body:JSON.stringify({from:env.MAIL_FROM,to:[body.email],subject:'Your completed BSI report (prototype)',text:`Your completed BSI prototype report\nReference: ${id}\n\n${report}`}),signal:AbortSignal.timeout(8000)
          });
          if(sent.ok && (await sent.json()).id) email='accepted';
        } catch { /* The report remains stored; do not log personal data or secrets. */ }
      }
      return reply({submitted:true,id,email},201);
    } catch { return reply({error:'Service temporarily unavailable'},503); }
  }
};

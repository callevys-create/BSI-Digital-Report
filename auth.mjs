import { createRemoteJWKSet, jwtVerify } from 'jose';
const keysets=new Map();
const list=s=>(s||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
export async function verifiedIdentity(request,env) {
 if(!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD)throw Object.assign(new Error('Administrator access is not configured.'),{status:503});
 if(!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN))throw Object.assign(new Error('Administrator configuration invalid.'),{status:503});
 const token=request.headers.get('Cf-Access-Jwt-Assertion');
 if(!token)throw Object.assign(new Error('Sign in through Cloudflare Access.'),{status:401});
 const issuer=`https://${env.ACCESS_TEAM_DOMAIN}`;
 if(!keysets.has(issuer))keysets.set(issuer,createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)));
 let payload;
 try {({payload}=await jwtVerify(token,keysets.get(issuer),{issuer,audience:env.ACCESS_AUD,algorithms:['RS256']}));}catch{throw Object.assign(new Error('Invalid or expired administrator session.'),{status:401});}
 const email=String(payload.email||'').toLowerCase();
 return {email};
}
export function staffRole(email,env){return list(env.MANAGER_EMAILS).includes(email)?'manager':list(env.ANALYST_EMAILS).includes(email)?'analyst':null;}
export async function administrator(request,env){
 const {email}=await verifiedIdentity(request,env),role=staffRole(email,env);
 if(!role)throw Object.assign(new Error('This account has no report administration permission.'),{status:403});
 return {email,role};
}
export async function organiserPrincipal(request,env){
 const {email}=await verifiedIdentity(request,env),role=staffRole(email,env);
 if(role)return {email,role};
 const clubs=(await env.DB.prepare("SELECT c.id,c.name,a.role FROM club_access a JOIN organising_clubs c ON c.id=a.club_id WHERE a.email=? AND a.active=1 AND c.type='regional'").bind(email).all()).results;
 if(!clubs.length)throw Object.assign(new Error('This account has no regional club access.'),{status:403});
 return {email,role:'organiser',clubs};
}

export function sameOrigin(request) {
 const origin=request.headers.get('Origin');if(origin!==new URL(request.url).origin)throw Object.assign(new Error('Origin denied'),{status:403});
}

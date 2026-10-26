import { createRemoteJWKSet, jwtVerify } from 'jose';
const keysets=new Map();
const list=s=>(s||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
export async function administrator(request,env) {
 if(!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.MANAGER_EMAILS)throw Object.assign(new Error('Administrator access is not configured.'),{status:503});
 if(!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN))throw Object.assign(new Error('Administrator configuration invalid.'),{status:503});
 const token=request.headers.get('Cf-Access-Jwt-Assertion');
 if(!token)throw Object.assign(new Error('Sign in through Cloudflare Access.'),{status:401});
 const issuer=`https://${env.ACCESS_TEAM_DOMAIN}`;
 if(!keysets.has(issuer))keysets.set(issuer,createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)));
 let payload;
 try {({payload}=await jwtVerify(token,keysets.get(issuer),{issuer,audience:env.ACCESS_AUD,algorithms:['RS256']}));}catch{throw Object.assign(new Error('Invalid or expired administrator session.'),{status:401});}
 const email=String(payload.email||'').toLowerCase();
 const role=list(env.MANAGER_EMAILS).includes(email)?'manager':list(env.ANALYST_EMAILS).includes(email)?'analyst':null;
 if(!role)throw Object.assign(new Error('This account has no report administration permission.'),{status:403});
 return {email,role};
}
export function sameOrigin(request) {
 const origin=request.headers.get('Origin');if(origin!==new URL(request.url).origin)throw Object.assign(new Error('Origin denied'),{status:403});
}

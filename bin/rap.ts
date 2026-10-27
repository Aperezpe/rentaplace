#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { rebuildDatabase } from '../data/seed.ts';
import { anchors } from '../data/anchors.ts';
import { priceStay } from '../src/domain/pricing.ts';
const commands={
 seed:'Rebuild the local deterministic database (stop the server first).',
 reset:'Same as seed: reset all local reservations and edits.',
 stats:'Show catalog, reservation and inbox counts.',
 quote:'quote <slug> <from> <to> [guests]',
 book:'book <slug> <from> <to> [guests] --demo-payment [--user guest-1]',
 search:'search [place] --from YYYY-MM-DD --to YYYY-MM-DD [--sort price|rating|recommended]',
 logs:'logs [--slow] [--errors] [--limit 100]',
 flags:'flags [set <name> on|off]',
 support:'support list',
 doctor:'Check Node, HTTP health, migrations and the price invariant.'
};
const jsonMode=process.argv.includes('--json');
function output(value:unknown) {console.log(JSON.stringify(value,null,jsonMode?undefined:2));}
try {
 const {values,positionals}=parseArgs({allowPositionals:true,options:{json:{type:'boolean'},help:{type:'boolean',short:'h'},url:{type:'string'},from:{type:'string'},to:{type:'string'},guests:{type:'string'},minPrice:{type:'string'},maxPrice:{type:'string'},bedrooms:{type:'string'},amenities:{type:'string'},instant:{type:'boolean'},sort:{type:'string'},page:{type:'string'},limit:{type:'string'},place:{type:'string'},slow:{type:'boolean'},errors:{type:'boolean'},user:{type:'string'},'demo-payment':{type:'boolean'}}});
 const [command,...args]=positionals;
 if(values.help || !command){output({name:'rap',commands,options:'Every command accepts --json. HTTP commands accept --url or RAP_URL.'});}
 else {
  const base=values.url || process.env.RAP_URL || `http://127.0.0.1:${process.env.PORT || 5180}`;
  const endpoint=new URL(base);
  if(endpoint.protocol!=='http:' || !['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname))throw new Error('RAP_URL must be a local http:// address.');
  let cookie='';
  async function request(path:string,method='GET',payload?:unknown) {
   let response:Response;
   try{response=await fetch(base+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(payload?{'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(15000)});}catch{throw new Error(`Cannot reach ${base}. Start the server with npm run dev, or set RAP_URL.`);}
   const data=await response.json();
   const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];
   if(!response.ok)throw new Error(`${data.error?.code || response.status}: ${data.error?.message || 'Request failed'}`);
   return data;
  }
  switch(command) {
   case 'seed':case 'reset':output({event:'database.seeded',...rebuildDatabase()});break;
   case 'stats':output(await request('/api/stats'));break;
   case 'quote': {
    if(args.length<3 || args.length>4)throw new Error('Usage: rap quote <slug> <from> <to> [guests]');
    const [slug,from,to,guests=values.guests || '2']=args;output(await request('/api/quote?'+new URLSearchParams({slug,from,to,guests})));break;
   }
   case 'book': {
    if(args.length<3 || args.length>4 || !values['demo-payment'])throw new Error('Usage: rap book <slug> <from> <to> [guests] --demo-payment [--user guest-1]');
    await request('/api/auth/signin','POST',{userId:values.user || 'guest-1'});
    const [slug,from,to,guests=values.guests || '2']=args;
    output(await request('/api/bookings','POST',{slug,from,to,guests:Number(guests),cardNumber:'4242 4242 4242 4242'}));break;
   }
   case 'search': {
    const q=new URLSearchParams();for(const key of ['place','from','to','guests','minPrice','maxPrice','bedrooms','amenities','sort','page','limit'] as const)if(values[key])q.set(key,String(values[key]));
    if(args.length)q.set('place',args.join(' '));if(values.instant)q.set('instant','1');output(await request('/api/listings?'+q));break;
   }
   case 'logs': {const q=new URLSearchParams();if(values.slow)q.set('slow','1');if(values.errors)q.set('errors','1');if(values.limit)q.set('limit',values.limit);output(await request('/api/logs?'+q));break;}
   case 'flags': {
    if(!args.length)output(await request('/api/flags'));
    else {if(args.length!==3 || args[0]!=='set' || !['on','off'].includes(args[2]))throw new Error('Usage: rap flags [set <name> on|off]');output(await request('/api/flags/'+encodeURIComponent(args[1]),'PATCH',{enabled:args[2]==='on'}));}break;
   }
   case 'support':if(args.join(' ')!=='list')throw new Error('Usage: rap support list');else{output(await request('/api/support'));break;}
   case 'doctor': {
    const h=await request('/api/health'),a=anchors.find(a=>a.slug==='lakeside-a-frame')!;
    const q=priceStay({slug:a.slug,sleeps:a.sleeps,nightly_cents:a.nightly,weekend_cents:a.weekend,cleaning_cents:a.cleaning},'2026-11-09','2026-11-12',2);
    const checks=[{name:'node-24-or-newer',ok:Number(process.versions.node.split('.')[0])>=24,value:process.version},{name:'http-health',ok:h.status==='ok',value:base},{name:'database-migrations',ok:h.migrations.length>=2,value:h.migrations},{name:'three-weeknight-subtotal',ok:q.subtotalCents===39000,value:q.subtotalCents}];
    output({ok:checks.every(c=>c.ok),today:h.today,checks});if(checks.some(c=>!c.ok))process.exitCode=1;break;
   }
   default:throw new Error(`Unknown command: ${command}. Run npm run rap -- --help.`);
  }
 }
} catch(error) {
 const message=error instanceof Error?error.message:String(error);
 if(jsonMode)output({error:{code:'COMMAND_FAILED',message}});else console.error(`rap: ${message}`);
 process.exitCode=1;
}

import { bootstrap } from '../src/bootstrap.ts';
import { nearbyListings, loadSearchData, parseSearch } from '../src/domain/search.ts';
const db=bootstrap();
const {homes,stays}=loadSearchData(db);
const q=parseSearch(new URLSearchParams('from=2026-11-10&to=2026-11-13&guests=2&limit=60'));
const times:number[]=[];
let found=0;
for(let i=0;i<9;i++) {const started=performance.now();found=nearbyListings(homes,stays,q).length;times.push(performance.now()-started);}
const sorted=[...times].sort((a,b)=>a-b);
console.log(JSON.stringify({medianMs:Number(sorted[4].toFixed(3)),samples:times.map(t=>Number(t.toFixed(3))),homes:homes.length,stays:stays.length,results:found}));
db.close();

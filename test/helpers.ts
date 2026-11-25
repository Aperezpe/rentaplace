import { openDatabase, listingBySlug } from '../src/db.ts';
import { publishSeedRules } from '../src/domain/rules.ts';
import type { Account } from '../src/types.ts';
export const guest:Account={id:'guest-1',name:'Mira Valewood',email:'mira@example.test',role:'guest'};
export const otherGuest:Account={id:'guest-2',name:'Ellis Ashmere',email:'ellis@example.test',role:'guest'};
export const host:Account={id:'host-1',name:'Rowan Cedarlow',email:'rowan@example.test',role:'host'};
export const otherHost:Account={id:'host-2',name:'Nori Fernway',email:'nori@example.test',role:'host'};
export const input={slug:'lakeside-a-frame',from:'2026-11-10',to:'2026-11-13',guests:2,cardNumber:'4242 4242 4242 4242'};
export function fixture(path=':memory:') {
 const db=openDatabase(path);
 for(const user of [guest,otherGuest,host,otherHost])db.prepare('INSERT INTO users VALUES (?,?,?,?)').run(user.id,user.name,user.email,user.role);
 for(const [id,slug,instant,owner] of [['home-1','lakeside-a-frame',1,'host-1'],['home-2','courtyard-loft',0,'host-1'],['home-3','fern-cottage',1,'host-2']] as const) {
  db.prepare(`INSERT INTO listings (id,slug,host_id,title,description,neighbourhood,region,lat,lng,sleeps,bedrooms,beds,bathrooms,nightly_cents,weekend_cents,cleaning_cents,cancellation_policy,status,instant_book,amenities,photos,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,slug,owner,'Lake home','A comfortable fictional stay.','Silver Bay','Lake Tahoe',38.95,-120.05,4,2,3,1,11000,14000,6000,'flexible','active',instant,'["Wifi","Kitchen"]','["/img/photos/lake-0.jpg","/img/photos/interior-0.jpg"]','2026-06-01','2026-06-01');
 }
 publishSeedRules(db);
 for(const name of ['instant_booking','guest_feedback','support_form','map_panel'])db.prepare('INSERT INTO flags VALUES (?,?,?)').run(name,1,name);
 return {db,home:listingBySlug(db,'lakeside-a-frame')!};
}

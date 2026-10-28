import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import type { Account } from './types.ts';
import { AppError } from './errors.ts';
export type Context = {req: IncomingMessage;res: ServerResponse;db: DatabaseSync;url: URL;params: Record<string,string>;user?:Account;body:any;requestId:string};
type Handler=(ctx: Context)=>unknown | Promise<unknown>;
export class Router {
  routes: {method:string;pattern:RegExp;names:string[];handler:Handler}[]=[];
  on(method:string,path:string,handler:Handler) {
    const names:string[]=[];
    const pattern=new RegExp('^'+path.split('/').map(part=>{if(part.startsWith(':')){names.push(part.slice(1));return '([^/]+)';}return part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}).join('/')+'/?$');
    this.routes.push({method,pattern,names,handler});
  }
  matches(method:string,pathname:string):boolean {return this.routes.some(r=>r.method===method && r.pattern.test(pathname));}
  async dispatch(ctx: Context) {
    for(const route of this.routes) {
      const match=route.pattern.exec(ctx.url.pathname);
      if(route.method!==ctx.req.method || !match)continue;
      ctx.params=Object.fromEntries(route.names.map((name,i)=>[name,decodeURIComponent(match[i+1])]));
      const result=await route.handler(ctx);
      if(!ctx.res.writableEnded && result!==undefined)json(ctx.res,result);
      return;
    }
    throw new AppError(404,'NOT_FOUND','That page could not be found.');
  }
}
export function json(res: ServerResponse,data:unknown,status=200) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
export function html(res: ServerResponse,body:string,status=200) {res.writeHead(status,{'Content-Type':'text/html; charset=utf-8'});res.end(body);}
export function redirect(res: ServerResponse,path:string) {res.writeHead(303,{Location:path});res.end();}
export async function readBody(req: IncomingMessage) {
  if(!['POST','PUT','PATCH','DELETE'].includes(req.method || ''))return {};
  let data='';
  for await (const chunk of req) {data+=chunk.toString();if(Buffer.byteLength(data)>65536)throw new AppError(413,'BODY_TOO_LARGE','Request is too large.');}
  if(!data)return {};
  const type=req.headers['content-type']?.split(';')[0];
  if(type==='application/json') {try{const value=JSON.parse(data);if(!value || typeof value!=='object' || Array.isArray(value))throw 0;return value;}catch{throw new AppError(400,'INVALID_JSON','Send a JSON object.');}}
  if(type==='application/x-www-form-urlencoded') {
    const params=new URLSearchParams(data),result:Record<string,unknown>=Object.fromEntries(params);
    if(params.has('amenities'))result.amenities=params.getAll('amenities');
    return result;
  }
  throw new AppError(415,'UNSUPPORTED_MEDIA_TYPE','Send JSON or form-encoded data.');
}

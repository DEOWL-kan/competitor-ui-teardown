import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

export const REPO = fileURLToPath(new URL('../../', import.meta.url));
export const DEFAULTS = {bodyLimit:256*1024, totalLimit:20*1024*1024, maxRecords:5000, maxStreamEvents:2000};
const secret = /token|cookie|authorization|password|passwd|secret|credential|email|phone|address|session|api.?key/i;
const safeHeaders = new Set(['content-type','content-length','content-encoding','cache-control','date','vary','accept','retry-after']);

export class Privacy {
  constructor({allowFields=[], allowQuery=[]}={}) {
    for (const list of [allowFields,allowQuery]) if (!Array.isArray(list) || list.some(v=>typeof v!=='string')) throw Error('Allow lists must be string arrays');
    this.fields=new Set(allowFields); this.query=new Set(allowQuery); this.values=new Map();
  }
  mask(value) {
    const key=JSON.stringify(value);
    if(!this.values.has(key)) this.values.set(key,`[value:${this.values.size+1}:${typeof value}]`);
    return this.values.get(key);
  }
  json(value, key='', depth=0) {
    if(depth>30) return '[depth-limit]';
    if(secret.test(key)) return this.mask(value);
    if(Array.isArray(value)) return value.map(v=>this.json(v,key,depth+1));
    if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,this.json(v,k,depth+1)]));
    if(value===null) return null;
    return this.fields.has(key) ? value : this.mask(value);
  }
  url(value) {
    try {
      const url=new URL(value);
      if(!['http:','https:','ws:','wss:'].includes(url.protocol)) return url.protocol;
      url.username=''; url.password=''; url.hash='';
      const params=[...url.searchParams]; url.search='';
      for(const [key,val] of params) url.searchParams.append(key,!secret.test(key)&&this.query.has(key)?val:this.mask(val));
      // Paths may still encode personal identifiers; output remains a private artifact.
      return url.href;
    } catch { return '[invalid-url]'; }
  }
  headers(values=[]) {
    return values.map(({name,value})=>({name:String(name).toLowerCase(), value:safeHeaders.has(String(name).toLowerCase())?String(value):'[omitted]'}));
  }
  body(text,mime='') {
    if(/json/i.test(mime)) {
      try {return {format:'json',value:this.json(JSON.parse(text))};}
      catch {return {format:'invalid-json',value:this.mask(text)};}
    }
    if(/javascript|ecmascript/i.test(mime)) {
      const call=text.match(/^\s*(?:\/\*[^]*?\*\/\s*)?([A-Za-z_$][\w$]*(?:(?:\.[A-Za-z_$][\w$]*)|(?:\[\d+\]))*)\s*\(([^]*)\)\s*;?\s*$/);
      if(call)try{return {format:'jsonp',callback:call[1],value:this.json(JSON.parse(call[2]))};}catch {}
    }
    if(/x-www-form-urlencoded/i.test(mime)) return {format:'form',value:[...new URLSearchParams(text)].map(([k,v])=>[k,this.json(v,k)])};
    return {format:'text-shape',characters:text.length,value:this.mask(text)};
  }
}

export class Artifacts {
  constructor(out,options={}) {
    if(typeof out!=='string'||!out) throw Error('An outside-repository output directory is required');
    this.limits={...DEFAULTS,...Object.fromEntries(Object.entries(options).filter(([k])=>k in DEFAULTS))};
    for(const [k,v] of Object.entries(this.limits)) if(!Number.isSafeInteger(v)||v<1) throw Error('Invalid limit: '+k);
    const resolved=path.resolve(out);
    let ancestor=path.dirname(resolved);
    while(!fs.existsSync(ancestor)) ancestor=path.dirname(ancestor);
    const canonical=path.resolve(fs.realpathSync(ancestor),path.relative(ancestor,resolved));
    const repo=fs.realpathSync(REPO);
    if(canonical===repo||canonical.startsWith(repo+path.sep)) throw Error('Capture output must be outside the repository');
    fs.mkdirSync(path.dirname(resolved),{recursive:true});
    fs.mkdirSync(resolved,{mode:0o700});
    this.out=resolved; this.session=randomUUID(); this.privacy=new Privacy(options);
    this.bytes=0; this.records=[]; this.actions=[]; this.streams=[]; this.dropped={requests:0,stream_events:0};
    this.manifest={schema_version:1,session_id:this.session,started_at:new Date().toISOString(),limits:this.limits,limitations:[],privacy:{values:'masked unless explicitly allow-listed',headers:'safe allow-list only',paths_and_snapshots:'private; manual review required'},complete:false};
    this.write('manifest.json',this.manifest);
  }
  write(name,value) {fs.writeFileSync(path.join(this.out,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});}
  event(value) {fs.appendFileSync(path.join(this.out,'events.jsonl'),JSON.stringify({session_id:this.session,...value})+'\n',{mode:0o600});}
  body(text,mime) {
    const size=Buffer.byteLength(text);
    if(size===0) return {body_status:'empty',body:null};
    if(size>this.limits.bodyLimit||this.bytes+size>this.limits.totalLimit) return {body_status:'truncated',body:null,reason:'body budget exceeded',decoded_bytes:size};
    this.bytes+=size;
    return {body_status:'captured',body:this.privacy.body(text,mime),decoded_bytes:size};
  }
  stream(event) {
    if(this.streams.length>=this.limits.maxStreamEvents) {this.dropped.stream_events++;return;}
    const row={body_status:'not_requested',body:null,session_id:this.session,event_id:'event-'+(this.streams.length+1),observed_at:new Date().toISOString(),...(typeof event==='function'?event():event)};
    this.streams.push(row);this.event(row);return row;
  }
  finish(extra={}) {
    for(const [name,rows] of [['network',this.records],['actions',this.actions],['streams',this.streams]]) fs.writeFileSync(path.join(this.out,name+'.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+(rows.length?'\n':''),{mode:0o600});
    Object.assign(this.manifest,{ended_at:new Date().toISOString(),saved_body_bytes:this.bytes,dropped:this.dropped,...extra});
    this.write('manifest.json',this.manifest);
  }
}

export async function importHar(har,out,options={}) {
  const entries=har?.log?.entries;
  if(!Array.isArray(entries)||entries.some(e=>!e||typeof e!=='object'||!e.request||typeof e.request.url!=='string'||(e.request.method!==undefined&&(typeof e.request.method!=='string'||! /^[A-Z]+$/.test(e.request.method)))||!e.response||typeof e.response!=='object'||(e.response.status!==undefined&&(!Number.isInteger(e.response.status)||e.response.status<0||e.response.status>599))||(e.time!==undefined&&(typeof e.time!=='number'||!Number.isFinite(e.time)))||(e.startedDateTime!==undefined&&(typeof e.startedDateTime!=='string'||!Number.isFinite(Date.parse(e.startedDateTime))))||[e.request.headers,e.response.headers].some(h=>h!==undefined&&(!Array.isArray(h)||h.some(v=>!v||typeof v.name!=='string'||typeof v.value!=='string'))))) throw Error('Invalid HAR entries');
  const store=new Artifacts(out,options);
  store.manifest.backend='har-import';
  store.manifest.limitations=['Offline import; no requests replayed.','HAR may omit bodies, initiators, WebSocket frames and SSE events.','No action association is inferred from HAR timing.'];
  for(const entry of entries) {
    if(store.records.length>=store.limits.maxRecords) {store.dropped.requests++;continue;}
    const c=entry.response.content||{};
    let body={body_status:'unavailable',body:null,reason:'HAR has no body text'};
    if(typeof c.text==='string') {
      if(c.text.length>store.limits.bodyLimit*2) body={body_status:'truncated',body:null,reason:'encoded body exceeds import budget'};
      else if(c.encoding && c.encoding!=='base64') body={body_status:'unavailable',body:null,reason:'unsupported HAR encoding'};
      else if(c.encoding==='base64'&&!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(c.text)) body={body_status:'unavailable',body:null,reason:'invalid base64'};
      else body=store.body(c.encoding==='base64'?Buffer.from(c.text,'base64').toString('utf8'):c.text,c.mimeType);
    }
    const post=entry.request.postData;
    const requestBody=typeof post?.text==='string'&&/json|x-www-form-urlencoded/i.test(post.mimeType||'')?store.body(post.text,post.mimeType):{body_status:'unavailable',body:null};
    store.records.push({request_body_status:requestBody.body_status,request_body:requestBody.body,session_id:store.session,request_id:'har-'+(store.records.length+1),kind:'http',url:store.privacy.url(entry.request.url),method:entry.request.method||'unknown',status:entry.response.status??null,started_at:entry.startedDateTime??null,duration_ms:entry.time??null,request_headers:store.privacy.headers(entry.request.headers),response_headers:store.privacy.headers(entry.response.headers),association:'unassigned',candidate_action_ids:[],...body});
  }
  store.finish({complete:true});return store;
}

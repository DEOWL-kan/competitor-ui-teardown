import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {Artifacts, REPO} from './artifacts.mjs';
export {Privacy, importHar} from './artifacts.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(here,'.browsers');
const {chromium}=await import('playwright');
const version=JSON.parse(fs.readFileSync(path.join(here,'node_modules/playwright/package.json'),'utf8')).version;

export async function checkEnvironment() {
  const browser=await chromium.launch();
  try {
    const context=await browser.newContext(); const page=await context.newPage();
    const cdp=await context.newCDPSession(page); await cdp.send('Network.enable');
    return {node:process.version,playwright:version,chromium:browser.version(),cdp_network:true};
  } finally {await browser.close();}
}

export async function startCapture({out,headless=true,viewport={width:1280,height:800},selector="body",...options}) {
  const store=new Artifacts(out,options);
  let browser;
  try {browser=await chromium.launch({headless});}
  catch(error) {store.finish({error:'Browser launch failed: '+error.name});throw error;}
  let context;
  try {context=await browser.newContext({viewport});}
  catch(error){await browser.close();store.finish({error:'Context creation failed: '+error.name});throw error;}
  const requests=new Map(), pages=new Map(), frames=new Map(), pending=new Set(), active=new Set();
  let next=0, accepting=true, stopped=false;
  const pageId=page=>{if(!pages.has(page)) pages.set(page,'page-'+(pages.size+1));return pages.get(page);};
  const frameId=frame=>{if(!frames.has(frame)) frames.set(frame,'frame-'+(frames.size+1));return frames.get(frame);};
  const tasks=promise=>{const task=promise.catch(error=>store.event({kind:'diagnostic',error:error.name})).finally(()=>pending.delete(task));pending.add(task);};
  const privacy=store.privacy;
  const elapsed=()=>performance.now()-started;
  const started=performance.now();
  store.manifest.backend='playwright-chromium';store.manifest.versions={node:process.version,playwright:version,chromium:browser.version()};
  store.manifest.limitations=[
    'Action candidates are time-window correlations, never proven ownership.',
    'HTTP is observed at context level; CDP streaming/initiator events only cover attached page targets. Worker/OOPIF streaming may be absent.',
    'Popup HTTP is observed by context; initial popup CDP events can precede attachment.',
    'Response bodies with unknown decoded size, compression, binary MIME or excessive size are skipped. Fetch streams are not captured incrementally.',
    'URL paths, allow-listed values, CSS and screenshots require manual privacy review. No personal profile or cookies are imported.'
  ];
  context.on('request',request=>{
    if(!accepting)return;
    if(store.records.length>=store.limits.maxRecords){store.dropped.requests++;return;}
    let page_id=null,frame_id=null;
    try {const frame=request.frame();page_id=pageId(frame.page());frame_id=frameId(frame);} catch {}
    const parent=requests.get(request.redirectedFrom());
    const row={session_id:store.session,request_id:'http-'+(++next),kind:'http',page_id,frame_id,url:privacy.url(request.url()),method:request.method(),resource_type:request.resourceType(),started_at:new Date().toISOString(),start_ms:elapsed(),status:null,duration_ms:null,redirect_from:parent?.request_id??null,redirect_hop:parent?parent.redirect_hop+1:0,association:active.size?'time-window-candidate':'unassigned',candidate_action_ids:[...active],request_headers:[],response_headers:[],request_body_status:'not_requested',body_status:'unavailable',reason:'request not completed',body:null};
    requests.set(request,row);store.records.push(row);store.event({event:'request',...row});
    tasks((async()=>{
      row.request_headers=privacy.headers(await request.headersArray());
      const mime=request.headers()['content-type']||'';
      if(!/json|x-www-form-urlencoded/i.test(mime)){row.request_body_status=['GET','HEAD'].includes(request.method())?'empty':'not_requested';return;}
      const post=request.postData();
      if(post===null){row.request_body_status='empty';return;}
      const body=store.body(post,mime);row.request_body_status=body.body_status;row.request_body=body.body;
    })());
  });
  context.on('response',response=>{
    const row=requests.get(response.request());if(!row)return;
    row.status=response.status();row.from_service_worker=response.fromServiceWorker();
    tasks(response.headersArray().then(headers=>{row.response_headers=privacy.headers(headers);}));
  });
  context.on('requestfailed',request=>{
    const row=requests.get(request);if(!row)return;
    row.duration_ms=elapsed()-row.start_ms;row.failure=request.failure()?.errorText||'unknown';
    row.body_status='unavailable';row.reason='transport failed or cancelled';store.event({event:'failed',...row});
  });
  context.on('requestfinished',request=>{
    const row=requests.get(request);if(!row)return;
    row.duration_ms=elapsed()-row.start_ms;
    tasks((async()=>{
      const response=await request.response();if(!response)return;
      const headers=await response.allHeaders();const mime=headers['content-type']||'';row.mime_type=mime;
      if(request.method()==='HEAD'||[204,304].includes(response.status())) {row.body_status='empty';row.reason='no response body for method/status';}
      else if(response.status()>=300&&response.status()<400){row.body_status='not_requested';row.reason='redirect body omitted';}
      else if(!/json|text\//i.test(mime)||/event-stream/i.test(mime)){row.body_status='not_requested';row.reason='binary or streaming body';}
      else if(headers['content-encoding']&&!/^identity$/i.test(headers['content-encoding'])){row.body_status='unavailable';row.reason='compressed decoded size cannot be bounded';}
      else if(!/^\d+$/.test(headers['content-length']||'')){row.body_status='unavailable';row.reason='unknown decoded body size';}
      else if(Number(headers['content-length'])>store.limits.bodyLimit){row.body_status='truncated';row.reason='declared size exceeds body limit';}
      else {
        let timer;
        try {
          const body=await Promise.race([response.body(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('body timeout')),5000);})]);
          delete row.reason;Object.assign(row,store.body(body.toString('utf8'),mime));
        } catch {row.body_status='unavailable';row.reason='body retrieval failed';}
        finally {clearTimeout(timer);}
      }
      store.event({event:'finished',...row});
    })());
  });
  async function attach(page) {
    const id=pageId(page);
    try {
      const cdp=await context.newCDPSession(page);const urls=new Map();
      const streamId=requestId=>id+':cdp:'+requestId;
      cdp.on('Network.requestWillBeSent',e=>{
        if(store.streams.length>=store.limits.maxStreamEvents){store.dropped.stream_events++;return;}
        urls.set(e.requestId,privacy.url(e.request.url));
        store.stream({kind:'cdp-request',page_id:id,request_id:streamId(e.requestId),url:privacy.url(e.request.url),timestamp:e.timestamp,initiator_type:e.initiator?.type||'unknown',initiator_frames:(e.initiator?.stack?.callFrames||[]).slice(0,8).map(f=>({url:privacy.url(f.url),line:f.lineNumber,column:f.columnNumber})),candidate_action_ids:[...active],association:active.size?'time-window-candidate':'unassigned'});
      });
      cdp.on('Network.responseReceived',e=>store.stream({kind:'cdp-response',page_id:id,request_id:streamId(e.requestId),status:e.response.status,from_disk_cache:e.response.fromDiskCache??null,from_service_worker:e.response.fromServiceWorker??null}));
      cdp.on('Network.webSocketCreated',e=>{urls.set(e.requestId,privacy.url(e.url));store.stream({kind:'websocket-open',page_id:id,request_id:streamId(e.requestId),url:privacy.url(e.url)});});
      for(const [name,direction] of [['webSocketFrameSent','sent'],['webSocketFrameReceived','received']]) cdp.on('Network.'+name,e=>{
        const frame=e.response;const data=frame.opcode===1?store.body(frame.payloadData,'application/json'):{body_status:'not_requested',reason:'binary/control frame',body:null};
        store.stream({kind:'websocket-frame',page_id:id,request_id:streamId(e.requestId),direction,opcode:frame.opcode,timestamp:e.timestamp,...data});
      });
      cdp.on('Network.webSocketClosed',e=>store.stream({kind:'websocket-close',page_id:id,request_id:streamId(e.requestId),timestamp:e.timestamp}));
      cdp.on('Network.webSocketFrameError',e=>store.stream({kind:'websocket-error',page_id:id,request_id:streamId(e.requestId),reason:'browser reported frame error'}));
      cdp.on('Network.eventSourceMessageReceived',e=>store.stream({kind:'sse',page_id:id,request_id:streamId(e.requestId),url:urls.get(e.requestId)||null,event_name:privacy.mask(e.eventName),event_id:privacy.mask(e.eventId),timestamp:e.timestamp,...store.body(e.data,'application/json')}));
      await cdp.send('Network.enable',{maxTotalBufferSize:store.limits.totalLimit,maxResourceBufferSize:store.limits.bodyLimit});
      return true;
    } catch(error) {store.event({kind:'diagnostic',page_id:id,error:'CDP attach unavailable: '+error.name});return false;}
  }
  context.on('page',page=>{tasks(attach(page));});
  const page=await context.newPage();
  await Promise.all([...pending]);
  fs.mkdirSync(path.join(store.out,'snapshots'),{mode:0o700});
  let snapshotIndex=0;
  async function snapshot(target=page) {
    if(target.isClosed()||target.url()==='about:blank')return null;
    const name='snapshots/'+(++snapshotIndex);
    try {
      await target.addScriptTag({path:path.join(REPO,'scripts/web_probe.js')});
      const data=await target.evaluate(selector=>window.webProbe({selector}),selector);
      store.write(name+'.json',data);
      await target.screenshot({path:path.join(store.out,name+'.png'),timeout:5000});
      fs.chmodSync(path.join(store.out,name+'.png'),0o600);
      return {json:name+'.json',screenshot:name+'.png'};
    } catch(error) {store.event({kind:'diagnostic',error:'snapshot unavailable: '+error.name});return null;}
  }
  async function action(id,run,{target=page,description=id}={}) {
    if(typeof id!=='string'||!id||store.actions.some(a=>a.action_id===id))throw Error('Action ID must be unique');
    const row={session_id:store.session,action_id:id,description,page_id:pageId(target),before:await snapshot(target),started_at:new Date().toISOString(),start_ms:elapsed(),status:'running'};
    store.actions.push(row);active.add(id);store.event({kind:'action-start',...row});
    try {await run(target);row.status='completed';}
    catch(error){row.status='failed';row.error=error.name;throw error;}
    finally {row.end_ms=elapsed();row.ended_at=new Date().toISOString();active.delete(id);row.after=await snapshot(target);store.event({kind:'action-end',...row});}
    return row;
  }
  async function stop() {
    if(stopped)return store;stopped=true;accepting=false;
    try {await context.close();await Promise.all([...pending]);store.finish({complete:true});}
    finally {await browser.close();}
    return store;
  }
  return {browser,context,page,store,action,snapshot,stop};
}

export function validateJob(job) {
  if(!job||typeof job!=='object'||typeof job.url!=='string'||!/^https?:\/\//.test(job.url)||!Array.isArray(job.steps))throw Error('Job needs HTTP(S) url and steps');
  const url=new URL(job.url);if(url.username||url.password)throw Error('Credentials in job URL are not supported');
  const ids=new Set(['navigate']);
  for(const [index,step] of job.steps.entries()) {
    if(!step||typeof step!=='object')throw Error('Step must be an object');
    const id=step.id??'step-'+index;
    if(typeof id!=='string'||!id||ids.has(id))throw Error('Step IDs must be unique');ids.add(id);
    const operations=['fill','click','press'].filter(k=>step[k]!==undefined);
    if(operations.length!==1||typeof step.selector!=='string'||!step.selector)throw Error('Step needs selector and exactly one fill/click/press operation');
    if(step.click!==undefined&&step.click!==true)throw Error('click must be true');
    for(const key of ['fill','press','waitFor'])if(step[key]!==undefined&&typeof step[key]!=='string')throw Error(key+' must be text');
  }
}

async function main() {
  const {values}=parseArgs({options:{check:{type:'boolean'},job:{type:'string'},'import-har':{type:'string'},out:{type:'string'}}});
  if(values.check){console.log(JSON.stringify(await checkEnvironment()));return;}
  if(values['import-har']){
    const {importHar}=await import('./artifacts.mjs');
    if(fs.statSync(values['import-har']).size>32*1024*1024)throw Error('HAR exceeds 32 MiB');
    const result=await importHar(JSON.parse(fs.readFileSync(values['import-har'],'utf8')),values.out);
    console.log(JSON.stringify({out:result.out,requests:result.records.length}));return;
  }
  if(!values.job)throw Error('Use --check, --job file.json, or --import-har file.har --out directory');
  if(fs.statSync(values.job).size>1024*1024)throw Error('Job exceeds 1 MiB');
  const job=JSON.parse(fs.readFileSync(values.job,'utf8'));
  validateJob(job);
  const capture=await startCapture({...job,out:values.out||job.out});
  try {
    await capture.action('navigate',page=>page.goto(job.url,{waitUntil:'domcontentloaded',timeout:30000}));
    for(const [index,step] of job.steps.entries()) await capture.action(step.id||'step-'+index,async page=>{
      if(step.fill!==undefined)await page.locator(step.selector).fill(step.fill,{timeout:10000});
      else if(step.click)await page.locator(step.selector).click({timeout:10000});
      else if(step.press)await page.locator(step.selector).press(step.press,{timeout:10000});
      if(step.waitFor)await page.locator(step.waitFor).waitFor({state:'visible',timeout:10000});
    });
  } finally {await capture.stop();}
  console.log(JSON.stringify({out:capture.store.out,requests:capture.store.records.length}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});

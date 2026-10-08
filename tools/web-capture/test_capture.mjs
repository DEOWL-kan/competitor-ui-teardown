import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

async function moduleUnderTest() {
  try { return await import('./capture.mjs'); }
  catch (error) { assert.fail('capture module unavailable: ' + error.code); }
}

test('privacy preserves structure while masking secrets and unknown values', async () => {
  const {Privacy} = await moduleUnderTest();
  const privacy = new Privacy({allowFields:['q', 'operationName'], allowQuery:['page']});
  const value = privacy.json({operationName:'Search', q:'book', token:'TEST-SECRET', nested:{email:'private@example.test', count:3}});
  assert.equal(value.operationName, 'Search');
  assert.equal(value.q, 'book');
  assert(!JSON.stringify(value).includes('TEST-SECRET'));
  assert(!JSON.stringify(value).includes('private@example'));
  assert.equal(privacy.json({token:'TEST-SECRET'}).token, value.token);
  const url = privacy.url('https://name:password@example.test/find?page=2&token=TEST-SECRET#private');
  assert(url.includes('page=2') && !url.includes('password') && !url.includes('TEST-SECRET'));
  assert.deepEqual(privacy.headers([{name:'Set-Cookie',value:'TEST-SECRET'},{name:'Content-Type',value:'application/json'},{name:'X-Test',value:'TEST-SECRET'}]),
    [{name:'set-cookie',value:'[omitted]'},{name:'content-type',value:'application/json'},{name:'x-test',value:'[omitted]'}]);
});

test('HAR import distinguishes missing, empty and oversized bodies without replay', async () => {
  const {importHar} = await moduleUnderTest();
  const root = await mkdtemp(path.join(tmpdir(),'web-har-'));
  try {
    const input = {log:{entries:[
      {startedDateTime:'2026-10-08T00:00:00Z',time:10,request:{url:'https://example.test/a',method:'GET',headers:[]},response:{status:200,headers:[],content:{mimeType:'application/json',text:'{"token":"TEST-SECRET","count":2}'}}},
      {request:{url:'https://example.test/b',method:'GET'},response:{status:204,content:{text:''}}},
      {request:{url:'https://example.test/c',method:'GET'},response:{status:200,content:{}}},
      {request:{url:'https://example.test/d',method:'GET'},response:{status:200,content:{text:Buffer.from('x'.repeat(100)).toString('base64'),encoding:'base64',mimeType:'text/plain'}}}
    ]}};
    const result = await importHar(input, path.join(root,'out'), {bodyLimit:64});
    assert.deepEqual(result.records.map(r=>r.body_status),['captured','empty','unavailable','truncated']);
    const stored=await readFile(path.join(root,'out','network.jsonl'),'utf8');
    assert(!stored.includes('TEST-SECRET'));
    assert(result.manifest.limitations.some(x=>x.includes('WebSocket')));
    await assert.rejects(importHar(input,path.join(root,'out')), /exist/i);
    await assert.rejects(importHar({log:{entries:[null]}},path.join(root,'bad')), /entr/i);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('real Chromium records HTTP, frames, streams and honest action candidates', {timeout:60000}, async()=>{
  const {startCapture}=await import('./capture.mjs');
  const {fixtureServer}=await import('./fixture_server.mjs');
  const fixture=await fixtureServer();const root=await mkdtemp(path.join(tmpdir(),'web-live-'));
  let capture;
  try {
    capture=await startCapture({out:path.join(root,'capture'),bodyLimit:1024,allowFields:['operationName','q','state','page'],allowQuery:['page']});
    await capture.page.goto(fixture.url);
    await capture.page.evaluate(()=>{for(let i=0;i<200;i++)document.querySelector("#query").style.setProperty("--fixture-"+i,String(i));});
    await capture.action('search',async page=>{
      await page.locator('#query').fill('book');await page.locator('#search').click();
      await page.waitForFunction(()=>document.querySelector('#result').textContent==='ready');
    });
    const beforeForm=fixture.seen.filter(x=>x==='/form').length;
    await capture.action('invalid-form',p=>p.locator('#form button').click());
    assert.equal(fixture.seen.filter(x=>x==='/form').length,beforeForm);
    await capture.action('form',async p=>{await p.locator('[name=email]').fill('private@example.test');await p.locator('#form button').click();await p.waitForFunction(()=>document.querySelector('#form-result').textContent==='saved');});
    await capture.action('next',async p=>{await p.locator('#next').click();await p.waitForFunction(()=>document.querySelector('#page-result').textContent==='2');});
    await capture.action('streams',async page=>{
      await page.locator('#streams').click();
      await page.waitForFunction(()=>document.body.dataset.sse==='done'&&document.body.dataset.ws==='done');
    });
    await capture.action('popup',async page=>{
      const opened=capture.context.waitForEvent('page');await page.locator('#popup').click();
      const popup=await opened;await popup.waitForLoadState();
    });
    let ready=0, release;const gate=new Promise(resolve=>{release=resolve;});
    await Promise.all(['overlap-a','overlap-b'].map(id=>capture.action(id,async p=>{
      ready++;if(ready===2)release();await gate;await p.evaluate(()=>fetch('/overlap'));
    })));
    await capture.page.evaluate(()=>fetch('/late'));
    await capture.page.evaluate(()=>new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('GET','/xhr');xhr.onload=resolve;xhr.onerror=reject;xhr.send();}));
    await capture.page.evaluate(()=>{const data=new FormData();data.append('file',new Blob(['TEST-SECRET']),'synthetic.txt');return fetch('/upload',{method:'POST',body:data});});
    await capture.page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;});
    await capture.page.waitForFunction(()=>navigator.serviceWorker.controller);
    await capture.page.evaluate(()=>fetch('/sw-data').then(r=>r.json()));
    await capture.stop();
    const rows=capture.store.records, get=suffix=>rows.find(r=>new URL(r.url).pathname===suffix);
    assert.equal(get('/xhr').resource_type,'xhr');
    assert.equal(get('/upload').request_body_status,'not_requested');
    assert.equal(get('/sw-data').from_service_worker,true);
    assert.equal(get('/late').association,'unassigned');
    assert.equal(get('/overlap').candidate_action_ids.length,2);
    assert.equal(get('/list').body.value.page,2);assert(get('/list').url.endsWith('page=2'));
    assert.equal(get('/form').request_body.format,'form');
    assert.equal(get('/form').body.value.state,'saved');
    assert.equal(get('/background').association,'unassigned');
    assert.deepEqual(get('/graphql').candidate_action_ids,['search']);
    assert.equal(get('/graphql').request_body.value.operationName,'Search');
    assert.equal(get('/graphql').body.value.state,'ready');
    assert.equal(get('/empty').body_status,'empty');
    assert.equal(get('/error').status,500);assert.equal(get('/error').body_status,'captured');
    assert.equal(get('/abort').body_status,'unavailable');assert(get('/abort').failure);
    assert.equal(get('/large').body_status,'truncated');
    assert.equal(get('/unknown').body_status,'unavailable');
    assert.equal(get('/final').redirect_from,get('/redirect').request_id);
    assert.notEqual(get('/frame').frame_id,get('/').frame_id);
    assert.notEqual(get('/popup').page_id,get('/').page_id);
    const streams=capture.store.streams;
    assert(streams.some(e=>e.kind==='sse'&&e.body.value.state==='ready'));
    for(const direction of ['sent','received'])assert(streams.some(e=>e.kind==='websocket-frame'&&e.direction===direction&&e.body_status==='captured'));
    assert(capture.store.actions.every(a=>a.status==='completed'&&a.before&&a.after));
    const probe=JSON.parse(await readFile(path.join(root,'capture',capture.store.actions[0].before.json),'utf8'));
    const style=probe.elements.find(e=>e.id==='query').style;
    assert.equal(Object.keys(style.variables).length,64);assert(style.variables_truncated&&style.variables_total>=200);
    for(const file of ['network.jsonl','streams.jsonl','events.jsonl'])assert(!(await readFile(path.join(root,'capture',file),'utf8')).includes('TEST-SECRET'),file);
    assert(fixture.seen.includes('/graphql'));
  } finally {if(capture)await capture.stop();await fixture.close();await rm(root,{recursive:true,force:true});}
});

test('job and output boundaries reject ambiguous operations and repository output', async()=>{
  const {validateJob}=await import('./capture.mjs');
  const {Artifacts,REPO}=await import('./artifacts.mjs');
  assert.throws(()=>new Artifacts(path.join(REPO,'capture-test')),/outside/);
  for(const step of [{selector:'input'}, {selector:'input',fill:'x',click:true},{id:'navigate',selector:'input',fill:'x'}])
    assert.throws(()=>validateJob({url:'https://example.test',steps:[step]}));
  validateJob({url:'https://example.test',steps:[{selector:'input',fill:''}]});
});

test('body and stream limits expose truncation rather than silent omission', async()=>{
  const {Artifacts}=await import('./artifacts.mjs');const root=await mkdtemp(path.join(tmpdir(),'web-limits-'));
  try {
    const store=new Artifacts(path.join(root,'out'),{bodyLimit:32,totalLimit:8,maxStreamEvents:1});
    assert.equal(store.body('12345678','text/plain').body_status,'captured');
    const exhausted=store.body('1','text/plain');assert.equal(exhausted.body_status,'truncated');assert(exhausted.reason);
    store.stream({kind:'sse'});store.stream({kind:'sse'});assert.equal(store.streams.length,1);assert.equal(store.dropped.stream_events,1);
    store.finish({complete:true});
  } finally {await rm(root,{recursive:true,force:true});}
});


test('JSONP parser never evaluates JavaScript and preserves JSON evidence only', async()=>{
  const {Privacy}=await import('./artifacts.mjs');const p=new Privacy({allowFields:['state']});
  assert.equal(p.body('/**/queue[0]({"state":"ready","token":"TEST-SECRET"});','text/javascript').value.state,'ready');
  assert.equal(p.body('queue[0]({"x":(()=>{throw 1})()});','text/javascript').format,'text-shape');
  assert.equal(p.body('queue[0]({"state":"ok"}); alert(1)','text/javascript').format,'text-shape');
});

test('Chromium decodes bounded gzip/JSONP, observes child streams and retains ID ambiguity', {timeout:60000}, async()=>{
  const {startCapture}=await import('./capture.mjs');const {fixtureServer}=await import('./fixture_server.mjs');
  const fixture=await fixtureServer(),root=await mkdtemp(path.join(tmpdir(),'web-deep-'));let c;
  try {
    c=await startCapture({out:path.join(root,'out'),bodyLimit:2048,allowFields:['state']});await c.page.goto(fixture.url);
    await c.page.evaluate(async()=>{for(const url of ['/gzip','/gzip-large','/jsonp','/cache'])await fetch(url).then(r=>r.text());await Promise.all([fetch('/overlap'),fetch('/overlap')]);});
    await c.page.evaluate(()=>new Promise(resolve=>{window.worker=new Worker('/stream-worker.js');worker.onmessage=resolve;}));
    const other=fixture.url.replace('127.0.0.1','localhost')+'/stream-frame';
    await c.page.evaluate(url=>{const f=document.createElement('iframe');f.id='cross';f.src=url;document.body.append(f);},other);
    await c.page.frameLocator('#cross').locator('body[data-done=yes]').waitFor();
    const another=await c.context.newPage();await another.goto(fixture.url);await another.evaluate(()=>fetch('/cache').then(r=>r.text()));
    await c.stop();
    const events=c.store.streams, request=suffix=>events.find(e=>e.kind==='cdp-request'&&new URL(e.url).pathname===suffix), body=suffix=>events.find(e=>e.kind==='cdp-body'&&e.request_id===request(suffix)?.request_id);
    assert.equal(body('/gzip').body.value.state,'ready');assert.equal(body('/jsonp').body.format,'jsonp');assert.equal(body('/gzip-large').body_status,'truncated');
    assert(request('/gzip').http_candidate_ids.length===1);assert.equal(request('/overlap').http_match,'ambiguous');
    for(const type of ['worker','iframe']) {
      assert(events.some(e=>e.kind==='target-attached'&&e.child_type===type),type+' attached');
      assert(events.some(e=>e.kind==='sse'&&e.target_type===type&&e.body?.value.state==='ready'),type+' SSE');
      assert(events.some(e=>e.kind==='websocket-frame'&&e.target_type===type&&e.direction==='received'),type+' WS');
    }
    assert(events.some(e=>e.kind==='cdp-response'&&e.from_disk_cache),'positive disk cache flag');
    assert(!(await readFile(path.join(root,'out','streams.jsonl'),'utf8')).includes('TEST-SECRET'));
  } finally {if(c)await c.stop();await fixture.close();await rm(root,{recursive:true,force:true});}
});

test('non-replaying body reads, synchronous action reservations, and shutdown draining', {timeout:60000}, async()=>{
  const {startCapture}=await import('./capture.mjs');const {fixtureServer}=await import('./fixture_server.mjs');
  const root=await mkdtemp(path.join(tmpdir(),'web-review-')),fixture=await fixtureServer();let c;
  try {
    c=await startCapture({out:path.join(root,'out'),allowFields:['state']});
    let unsafeReads=0,entered,release;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
    c.context.on('response',response=>{
      if(response.request().resourceType()==='stylesheet')response.body=async()=>{unsafeReads++;return Buffer.from('refetched replacement');};
      if(response.url().endsWith('/drain')) {const original=response.body.bind(response);response.body=async()=>{entered();await gate;assert(!c.page.isClosed(),'context closed before body drain');return original();};}
    });
    await c.page.goto(fixture.url);
    const duplicate=await Promise.allSettled([c.action('same',async()=>{}),c.action('same',async()=>{})]);
    assert.equal(duplicate.filter(r=>r.status==='rejected').length,1);
    await c.page.evaluate(()=>new Promise(resolve=>{const link=document.createElement('link');link.rel='stylesheet';link.href='/style.css';link.onload=resolve;document.head.append(link);}));
    await c.page.evaluate(()=>fetch('/drain'));await ready;
    const stopping=c.stop();setTimeout(release,50);await stopping;
    assert.equal(unsafeReads,0,'Playwright body fallback must not refetch stylesheets');
    const drain=c.store.records.find(r=>r.url.endsWith('/drain'));assert.equal(drain.body_status,'captured');
  }finally {if(c)await c.stop();await fixture.close();await rm(root,{recursive:true,force:true});}
});


test('discarded stream bodies leave the HTTP budget intact', async()=>{
  const {Artifacts}=await import('./artifacts.mjs');
  const root=await mkdtemp(path.join(tmpdir(),'stream-budget-'));
  try {
    const store=new Artifacts(path.join(root,'capture'),{maxStreamEvents:1,totalLimit:8});
    store.stream({kind:'sse'});
    store.stream(()=>({kind:'sse',...store.body('12345678','text/plain')}));
    assert.equal(store.bytes,0);assert.equal(store.dropped.stream_events,1);
    assert.equal(store.body('12345678','text/plain').body_status,'captured');
  } finally {await rm(root,{recursive:true,force:true});}
});

test('CDP limits never give a dropped redirect the previous hop identity', async()=>{
  const {EventEmitter}=await import('node:events');
  const {observeCDP}=await import('./cdp_capture.mjs');
  const {Artifacts,Privacy,DEFAULTS}=await import('./artifacts.mjs');
  const store=Object.assign(Object.create(Artifacts.prototype),{session:'test',limits:{...DEFAULTS,maxRecords:1},privacy:new Privacy(),streams:[],records:[],bytes:0,dropped:{stream_events:0},event(){}});
  const cdp=new EventEmitter(),pending=[];
  cdp.send=async method=>method==='Network.getResponseBody'?{body:'{"state":"final"}',base64Encoded:false}:{};
  await observeCDP(cdp,{store,pageId:'page-1',targetId:'page-1',active:new Set(),tasks:p=>pending.push(p)});
  const first={requestId:'native-1',request:{url:'https://example.test/redirect',method:'GET'},wallTime:1};
  cdp.emit('Network.requestWillBeSent',first);
  cdp.emit('Network.requestWillBeSent',{...first,request:{url:'https://example.test/final',method:'GET'},redirectResponse:{status:302}});
  cdp.emit('Network.responseReceived',{requestId:first.requestId,response:{status:200,mimeType:'application/json'}});
  cdp.emit('Network.loadingFinished',{requestId:first.requestId});await Promise.all(pending);
  assert.equal(store.dropped.stream_events,1);
  assert.deepEqual(store.streams.map(e=>e.kind),['cdp-request']);
});

test('metadata stream events have an explicit non-body status for report references', async()=>{
  const {Artifacts}=await import('./artifacts.mjs');
  const root=await mkdtemp(path.join(tmpdir(),'stream-metadata-'));
  try {
    const store=new Artifacts(path.join(root,'out'));
    for(const kind of ['cdp-request','cdp-response','cdp-cache','websocket-open','websocket-close']) {
      const event=store.stream({kind,request_id:'request-1'});
      assert.equal(event.body_status,'not_requested');assert.equal(event.body,null);
    }
  }finally {await rm(root,{recursive:true,force:true});}
});

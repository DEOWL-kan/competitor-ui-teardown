import {EventEmitter} from 'node:events';

// Child-target protocol channel; no private Playwright API and no new dependency.
function childSession(parent, sessionId) {
  const channel=new EventEmitter(), waiting=new Map();let next=0;
  const receive=e=>{
    if(e.sessionId!==sessionId)return;
    const message=JSON.parse(e.message);
    if(message.id){const pending=waiting.get(message.id);if(!pending)return;waiting.delete(message.id);clearTimeout(pending.timer);message.error?pending.reject(Error('Child CDP command failed')):pending.resolve(message.result);}
    else channel.emit(message.method,message.params);
  };
  parent.on('Target.receivedMessageFromTarget',receive);
  const detach=e=>{if(e.sessionId!==sessionId)return;parent.off('Target.receivedMessageFromTarget',receive);parent.off('Target.detachedFromTarget',detach);for(const pending of waiting.values()){clearTimeout(pending.timer);pending.reject(Error('Child target detached'));}waiting.clear();channel.removeAllListeners();};
  parent.on('Target.detachedFromTarget',detach);
  channel.send=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++next;
    const timer=setTimeout(()=>{waiting.delete(id);reject(Error('Child CDP timeout'));},3000);
    waiting.set(id,{resolve,reject,timer});
    parent.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})}).catch(error=>{clearTimeout(timer);waiting.delete(id);reject(error);});
  });
  return channel;
}

export async function observeCDP(cdp,{store,pageId,targetId,targetType='page',active,tasks}) {
  const privacy=store.privacy, requests=new Map(), sockets=new Map();
  const meta={page_id:pageId,target_id:targetId,target_type:targetType};
  const emit=value=>store.stream(()=>({...meta,...(typeof value==='function'?value():value)}));
  cdp.on('Network.requestWillBeSent',e=>{
    if(store.streams.length>=store.limits.maxStreamEvents||requests.size>=store.limits.maxRecords){if(requests.has(e.requestId))requests.set(e.requestId,null);store.dropped.stream_events++;return;}
    const previous=requests.get(e.requestId),hop=e.redirectResponse?(previous?.hop??0)+1:0;
    const id=targetId+':cdp:'+e.requestId+':'+hop;
    const row=emit({kind:'cdp-request',request_id:id,url:privacy.url(e.request.url),method:e.request.method,frame_token:e.frameId??null,start_epoch_ms:e.wallTime*1000,redirect_hop:hop,redirect_from:e.redirectResponse?previous?.id??null:null,initiator_type:e.initiator?.type||'unknown',initiator_frames:(e.initiator?.stack?.callFrames||[]).slice(0,8).map(f=>({url:privacy.url(f.url),line:f.lineNumber,column:f.columnNumber})),candidate_action_ids:[...active],association:active.size?'time-window-candidate':'unassigned'});
    requests.set(e.requestId,{id,hop,row,decoded:0,response:null});
  });
  cdp.on('Network.dataReceived',e=>{const row=requests.get(e.requestId);if(row)row.decoded+=e.dataLength;});
  cdp.on('Network.responseReceived',e=>{
    const row=requests.get(e.requestId);if(!row)return;row.response=e.response;
    emit({kind:'cdp-response',request_id:row.id,status:e.response.status,from_disk_cache:e.response.fromDiskCache??null,from_service_worker:e.response.fromServiceWorker??null});
  });
  cdp.on('Network.requestServedFromCache',e=>{const row=requests.get(e.requestId);if(row)emit({kind:'cdp-cache',request_id:row.id,cache_observed:true});});
  cdp.on('Network.loadingFinished',e=>{
    const row=requests.get(e.requestId);if(!row?.response)return;
    tasks((async()=>{
      const mime=row.response.mimeType||'';
      let body={body_status:'not_requested',body:null,reason:'binary or streaming MIME'};
      if(/json|javascript|ecmascript|^text\//i.test(mime)&&!/event-stream/i.test(mime)) {
        if(row.decoded>store.limits.bodyLimit)body={body_status:'truncated',body:null,reason:'decoded CDP bytes exceed body limit'};
        else {
          // Chromium's per-resource buffer is bounded by Network.enable. A cache
          // hit may have zero dataReceived bytes; retrieval can fail or truncate.
          try {
            const result=await cdp.send('Network.getResponseBody',{requestId:e.requestId});
            if(Buffer.byteLength(result.body)>store.limits.bodyLimit*(result.base64Encoded?2:1))body={body_status:'truncated',body:null,reason:'CDP body exceeds limit'};
            else body=()=>store.body(result.base64Encoded?Buffer.from(result.body,'base64').toString('utf8'):result.body,mime);
          } catch {body={body_status:'unavailable',body:null,reason:'CDP body unavailable or evicted from bounded buffer'};}
        }
      }
      emit(()=>({kind:'cdp-body',request_id:row.id,candidate_action_ids:row.row?.candidate_action_ids||[],decoded_bytes_observed:row.decoded,...(typeof body==='function'?body():body)}));
    })());
  });
  cdp.on('Network.loadingFailed',e=>{const row=requests.get(e.requestId);if(row)emit({kind:'cdp-body',request_id:row.id,body_status:'unavailable',body:null,reason:'transport failed or cancelled'});});
  cdp.on('Network.webSocketCreated',e=>{const id=targetId+':ws:'+e.requestId;sockets.set(e.requestId,id);emit({kind:'websocket-open',request_id:id,url:privacy.url(e.url)});});
  for(const [name,direction] of [['webSocketFrameSent','sent'],['webSocketFrameReceived','received']])cdp.on('Network.'+name,e=>{
    const frame=e.response;emit(()=>({kind:'websocket-frame',request_id:sockets.get(e.requestId)||targetId+':ws:'+e.requestId,direction,opcode:frame.opcode,timestamp:e.timestamp,...(frame.opcode===1?store.body(frame.payloadData,'application/json'):{body_status:'not_requested',reason:'binary/control frame',body:null})}));
  });
  cdp.on('Network.webSocketClosed',e=>emit({kind:'websocket-close',request_id:sockets.get(e.requestId),timestamp:e.timestamp}));
  cdp.on('Network.webSocketFrameError',e=>emit({kind:'websocket-error',request_id:sockets.get(e.requestId),reason:'browser reported frame error'}));
  cdp.on('Network.eventSourceMessageReceived',e=>emit(()=>({kind:'sse',request_id:requests.get(e.requestId)?.id??null,event_name:privacy.mask(e.eventName),event_id_value:privacy.mask(e.eventId),timestamp:e.timestamp,...store.body(e.data,'application/json')})));
  cdp.on('Target.attachedToTarget',e=>{
    const child=childSession(cdp,e.sessionId);
    tasks((async()=>{
      try {await observeCDP(child,{store,pageId,targetId:e.targetInfo.targetId,targetType:e.targetInfo.type,active,tasks});emit({kind:'target-attached',child_target_id:e.targetInfo.targetId,child_type:e.targetInfo.type});}
      catch {emit({kind:'target-unavailable',child_target_id:e.targetInfo.targetId,child_type:e.targetInfo.type});}
      finally {await child.send('Runtime.runIfWaitingForDebugger').catch(()=>{});}
    })());
  });
  await cdp.send('Network.enable',{maxTotalBufferSize:store.limits.totalLimit,maxResourceBufferSize:store.limits.bodyLimit});
  try {await cdp.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:false,filter:[{type:'worker'},{type:'iframe'},{type:'shared_worker'},{exclude:true}]});}
  catch {emit({kind:'target-autoattach-unavailable'});}
}

// Public APIs expose no common native ID. Preserve every matching candidate,
// including ambiguity, rather than inventing an exact cross-backend identity.
export function correlateRequests(store) {
  const cdp=store.streams.filter(e=>e.kind==='cdp-request');
  for(const row of cdp){row.http_candidate_ids=store.records.filter(r=>r.page_id===row.page_id&&r.url===row.url&&r.method===row.method&&r.redirect_hop===row.redirect_hop&&Math.abs(Date.parse(r.started_at)-row.start_epoch_ms)<1000).map(r=>r.request_id);row.http_match=row.http_candidate_ids.length===1?'unique-metadata-candidate':row.http_candidate_ids.length?'ambiguous':'unmatched';}
  for(const row of store.records)row.cdp_candidate_ids=cdp.filter(e=>e.http_candidate_ids.includes(row.request_id)).map(e=>e.request_id);
}

/* Isolated, cancellable layout computation. Worker dependencies are embedded at build time. */
(function(scope){
 'use strict';
 function start(plan,settings,geometry,options,onProgress=()=>{}){
  if(!scope.Worker||!scope.LogEnLayoutWorkerSource)throw Error('Background layout generation is unavailable. Reopen the latest LogEn app.');
  const url=URL.createObjectURL(new Blob([scope.LogEnLayoutWorkerSource],{type:'text/javascript'}));
  let worker;try{worker=new Worker(url);}finally{URL.revokeObjectURL(url);}
  let settled=false,best=null,resolveJob,rejectJob;
  const promise=new Promise((resolve,reject)=>{resolveJob=resolve;rejectJob=reject;});
  const finish=(value,error)=>{if(settled)return;settled=true;worker.terminate();if(error)rejectJob(error);else resolveJob(value);};
  worker.onmessage=({data})=>{if(settled)return;if(data.type==='progress'){if(data.best)best=data.best;onProgress({...data,best:best?{placed:best.layout.accommodatedPallets,required:best.layout.requiredPallets,orientation:best.winner}:null});}else if(data.type==='result')finish(data.value);else if(data.type==='error')finish(null,new Error(data.message));};
  worker.onerror=e=>finish(null,new Error(e.message||'Background layout generation failed. Your saved layout is unchanged.'));
  try{worker.postMessage({plan,settings,geometry,options});}catch(error){finish(null,error);}
  return {promise,cancel(){finish(null,new DOMException('Generation cancelled. Your previous layout is unchanged.','AbortError'));},useBest(){if(best)finish({...best,stoppedEarly:true});},get hasBest(){return !!best;}};
 }
 scope.LogEnLayoutWorker=Object.freeze({start});
})(globalThis);

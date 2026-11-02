import {DwgReader,DxfReader} from '@node-projects/acad-ts';
export function readGeometry(buffer,name='drawing.dwg'){
  const notes=[],notice=(_s,n)=>{if(notes.length<200)notes.push(String(n.message));},dwg=/^AC\d{4}$/.test(new TextDecoder().decode(new Uint8Array(buffer,0,6)));
  const doc=(dwg?DwgReader:DxfReader).readFromStream(buffer,notice),entities=[];let unreadable=0;
  const identity=[1,0,0,1,0,0],transform=(p,m)=>[m[0]*p.x+m[2]*p.y+m[4],m[1]*p.x+m[3]*p.y+m[5]],multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
  function walk(e,m=identity,parent='',inherited='0',ancestors=[]){
    if(entities.length>=20000)throw new Error('Drawing exceeds 20,000 interpreted entities. Split the drawing into smaller scopes.');
    const type=e.objectName,id=parent+Number(e.handle).toString(16).toUpperCase(),layer=e.layer?.name==='0'?inherited:e.layer?.name||inherited;
    try{
      if(e.normal&&(Math.abs(e.normal.x)>1e-8||Math.abs(e.normal.y)>1e-8||e.normal.z<.99))throw new Error('Non-planar/extruded entity');
      if(type==='INSERT'){
        const block=e.block;if(!block||ancestors.includes(block.name)||ancestors.length>=24)throw new Error('Missing/recursive block');
        const angle=e.rotation||0,c=Math.cos(angle),s=Math.sin(angle),base=block.blockEntity?.basePoint||{x:0,y:0},sx=e.xScale,sy=e.yScale,b=[c*sx,s*sx,-s*sy,c*sy,e.insertPoint.x-c*sx*base.x+s*sy*base.y,e.insertPoint.y-s*sx*base.x-c*sy*base.y];
        for(const child of block.entities)walk(child,multiply(m,b),id+'/',layer,[...ancestors,block.name]);return;
      }
      let pts=[],closed=false,curved=false,curveError=0;
      if(type==='LINE')pts=[e.startPoint,e.endPoint];
      else if(['LWPOLYLINE','POLYLINE'].includes(type)){pts=e.getPoints(128);closed=e.isClosed;curved=Array.from(e.vertices).some(v=>v.bulge);}
      else if(['ARC','CIRCLE'].includes(type)){const n=Math.min(4096,Math.max(64,Math.ceil(Math.PI*Math.sqrt(Math.max(1,e.radius))))),start=type==='CIRCLE'?0:e.startAngle,sweep=type==='CIRCLE'?2*Math.PI:(e.endAngle-e.startAngle+2*Math.PI)%(2*Math.PI),radius=type==='CIRCLE'?e.radius/Math.cos(Math.PI/n):e.radius;for(let k=0;k<=(type==='CIRCLE'?n-1:n);k++){const a=start+sweep*k/n;pts.push({x:e.center.x+radius*Math.cos(a),y:e.center.y+radius*Math.sin(a)});}closed=type==='CIRCLE';curved=true;curveError=e.radius*(1/Math.cos(Math.PI/n)-1);}
      else if(['TEXT','MTEXT','DIMENSION','POINT'].includes(type)){const p=e.insertPoint||e.definitionPoint||{x:0,y:0};pts=[p];}
      else{unreadable++;const box=e.getBoundingBox?.();if(box){const a=box.min||box.minPoint,b=box.max||box.maxPoint;if(a&&b)pts=[a,{x:b.x,y:a.y},b,{x:a.x,y:b.y}];}if(!pts.length)return;closed=true;}
      let points=pts.map(p=>transform(p,m));if(points.length>1&&Math.hypot(points[0][0]-points.at(-1)[0],points[0][1]-points.at(-1)[1])<1e-8)points.pop();
      if(!points.length||points.some(p=>!p.every(Number.isFinite)))throw new Error('Invalid coordinate');
      const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);entities.push({id,layer,type,points,closed,boundaryEligible:closed,curved,curveError:curved?(curveError||1):0,blockName:ancestors.at(-1),bounds:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]});
    }catch(error){unreadable++;notes.push(id+': '+error.message);}
  }
  for(const e of doc.entities||[])walk(e);
  const headerText=dwg?'':new TextDecoder().decode(new Uint8Array(buffer,0,Math.min(buffer.byteLength,1048576))),headerUnit=headerText.match(/(?:^|\n)\s*9\s*\r?\n\s*\$INSUNITS\s*\r?\n\s*70\s*\r?\n\s*(\d+)/);
  return {version:3,units:headerUnit?Number(headerUnit[1]):Number(doc.header.insUnits),entities,unreadableEntities:unreadable,reader:'acad-ts 3.7.0 / local browser',format:dwg?'DWG':'DXF',notifications:notes};
}
if(typeof self!=='undefined'&&typeof document==='undefined')self.onmessage=event=>{try{self.postMessage({geometry:readGeometry(event.data.buffer,event.data.name)});}catch(error){self.postMessage({error:String(error.message)});}};

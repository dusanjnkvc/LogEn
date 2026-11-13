const assert=require('node:assert/strict');global.ClipperLib=require('./vendor/clipper');require('./domain');require('./layout');require('./layout-optimizer');require('./manual-layout');const M=LogEnManualLayout,O=LogEnOptimizer,G=O.geometry;
for(const angle of [0,Math.PI/2,Math.PI/6])for(const sx of [1,-1])for(const width of [4500,6000]){
 const frame={angle,sx,sy:1},settings={...LogEnDomain.createDefaultSettings(),gangwayWidth:width,floorPalletClearance:100},boundary=[G.path([[0,0],[50000,0],[50000,50000],[0,50000]])];
 const group=(id,x,y,w,h)=>({id,kind:'ground',manualRow:true,manualRowFace:'front',x,y,w,h,frame,objects:[{id,kind:'ground',pn:id,w:w-100,h:h-100,dx:50,dy:50,quantity:1,rotation:0,height:1000,stacking:1}]});
 const fixed=group('fixed',10000,10000,10000,2000),moving=group('moving',12000,12000+width-100,1000,2000),layout={version:2,groups:[fixed,moving],env:{frame,box:{minX:0,minY:0,maxX:50000,maxY:50000},boundary,blocked:[],zone:boundary,baseAccess:[]},options:{allowWallStorage:false}};
 const p=M.snap(layout,['moving'],0,0,settings,150,100);M.translate(layout,['moving'],p.dx,p.dy);assert(Math.abs(moving.y-fixed.y-fixed.h-width)<.11,'Reserved gap must equal '+width+' mm, not '+(width-100)+'; got '+(moving.y-fixed.y-fixed.h));assert.equal(O.aisleSnap(layout,moving,settings),null);
 // A compatible same-row join retains pallet clearance and does not jump across a gangway.
 moving.x=fixed.x+fixed.w;moving.y=fixed.y;const joined=M.snap(layout,['moving'],0,0,settings,20,100);assert(Math.hypot(joined.dx,joined.dy)<300,'Valid same-row join must stay in place');
}
console.log('Exact 4400→4500 and 5900→6000 aisle snapping passed for horizontal, vertical, rotated and mirrored layouts; same-row joins preserved.');

/* Store already-compressed DWG/XLSX files in one browser download. */
(function(scope){
  'use strict';
  const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  function crc(bytes){let n=0xffffffff;for(const b of bytes)n=crcTable[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
  async function pack(files){
    const chunks=[],central=[],encoder=new TextEncoder(),now=new Date();let offset=0,centralSize=0;
    const time=(now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1),date=((now.getFullYear()-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate();
    for(const file of files){
      const bytes=file.data instanceof Blob?new Uint8Array(await file.data.arrayBuffer()):file.data instanceof Uint8Array?file.data:new Uint8Array(file.data),name=encoder.encode(file.name),checksum=crc(bytes);
      if(name.length>65535||bytes.length>0xffffffff)throw new Error('Output file exceeds ZIP size limits.');
      const header=new Uint8Array(30+name.length),h=new DataView(header.buffer);h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint16(10,time,true);h.setUint16(12,date,true);h.setUint32(14,checksum,true);h.setUint32(18,bytes.length,true);h.setUint32(22,bytes.length,true);h.setUint16(26,name.length,true);header.set(name,30);
      const directory=new Uint8Array(46+name.length),d=new DataView(directory.buffer);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(12,time,true);d.setUint16(14,date,true);d.setUint32(16,checksum,true);d.setUint32(20,bytes.length,true);d.setUint32(24,bytes.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);directory.set(name,46);
      chunks.push(header,bytes);central.push(directory);offset+=header.length+bytes.length;centralSize+=directory.length;
    }
    const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
    return new Blob([...chunks,...central,end],{type:'application/zip'});
  }
  scope.LogEnOutputZIP=Object.freeze({pack});
})(globalThis);

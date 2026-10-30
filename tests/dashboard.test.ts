import test from 'node:test';
import assert from 'node:assert/strict';
import {dashboardWindow,storageSummary,storagePoolSummary} from '../src/dashboard.ts';
import type {StorageStats,StorageSlot} from '../src/mongo-connections.ts';
import {storageCard} from '../public/dashboard.js';

test('seven business calendar days include today, with Brasília midnight boundaries',()=>{
 const window=dashboardWindow(new Date('2026-10-28T02:59:00Z'));
 assert.equal(window.start.toISOString(),'2026-10-21T03:00:00.000Z');
 assert.deepEqual(window.days,['2026-10-21','2026-10-22','2026-10-23','2026-10-24','2026-10-25','2026-10-26','2026-10-27']);
 assert.equal(dashboardWindow(new Date('2026-11-01T03:00:00Z')).start.toISOString(),'2026-10-26T03:00:00.000Z');
});
test('storage uses real allocated size and never invents a provider quota or disk capacity',()=>{
 const stats={dataSize:1000,indexSize:200,storageSize:400,fsTotalSize:1e12,fsUsedSize:1e9};
 const unknown=storageSummary(stats,'');assert.equal(unknown.allocatedBytes,600);assert.equal(unknown.remainingBytes,null);assert.equal(unknown.status,'LIMIT_NOT_CONFIGURED');
 const known=storageSummary(stats,'1000');assert.equal(known.remainingBytes,400);assert.equal(known.usedPercent,60);
 const full=storageSummary({...stats,totalSize:1200},'1000');assert.equal(full.remainingBytes,0);assert.equal(full.overLimitBytes,200);
 const denied=storageSummary(null,'1000');assert.equal(denied.status,'UNAVAILABLE');assert.equal(denied.remainingBytes,null);
 for(const value of ['0','-1','Infinity','secret','1.5'])assert.equal(storageSummary(stats,value).limitBytes,null);
});

const slotStats=(slot:StorageSlot,usedBytes:number|null,scope:StorageStats['scope']='CLUSTER'):StorageStats=>({
 slot,status:usedBytes===null?'UNAVAILABLE':'AVAILABLE',scope,measurement:'UNCOMPRESSED_DATA_AND_INDEXES',usedBytes,
 dataBytes:usedBytes===null?null:usedBytes*.8,indexBytes:usedBytes===null?null:usedBytes*.2,limitBytes:1000,
 remainingBytes:usedBytes===null?null:Math.max(0,1000-usedBytes),usedPercent:usedBytes===null?null:usedBytes/10,measuredAt:new Date('2026-10-30T12:00:00Z')
});

test('pool dashboard exposes all configured banks, measured quota and preventive reserve without connection details',()=>{
 const input={enabled:true,activeSlot:2,rolloverPercent:85,uri:'mongodb://private-user:private-secret@private-host',
  slots:[{...slotStats(3,0),database:'private-database'},slotStats(1,900),{...slotStats(2,400),uri:'mongodb://private-user:private-secret@private-host'}]};
 const original=structuredClone(input),summary=storagePoolSummary(input);
 assert.deepEqual(input,original);
 assert.equal(summary.mode,'POOL');assert.equal(summary.status,'AVAILABLE');assert.equal(summary.measuredSlots,3);
 assert.equal(summary.usedBytes,1300);assert.equal(summary.limitBytes,3000);assert.equal(summary.remainingBytes,1700);
 assert.deepEqual(summary.slots.map(item=>[item.slot,item.state]),[[1,'HISTORY'],[2,'ACTIVE'],[3,'RESERVE']]);
 assert.deepEqual(summary.slots.map(item=>item.beforeRolloverBytes),[0,450,850]);
 assert(summary.slots.every(item=>item.rolloverBytes===850&&item.reserveBytes===150));
 assert.equal(summary.slots[2].usedBytes,0,'An actually measured empty bank remains a known zero.');
 assert.doesNotMatch(JSON.stringify(summary),/private-|mongodb:\/\//);
 const markup=storageCard(summary);
 assert.equal((markup.match(/data-storage-slot=/g)||[]).length,3);
 assert.match(markup,/Banco 2 para novos lotes/);assert.match(markup,/limite de 85%/);
 assert.match(markup,/Histórico preservado/);assert.match(markup,/Reserva de espaço/);assert.match(markup,/150 B/);
 assert.doesNotMatch(markup,/private-|Espaço alocado/);
});

test('partial database stats and unavailable bank never become a complete cluster balance or a zero',()=>{
 const summary=storagePoolSummary({enabled:true,activeSlot:1,rolloverPercent:85,slots:[slotStats(1,500),slotStats(2,null),slotStats(3,100,'DATABASE')]});
 assert.equal(summary.status,'PARTIAL');assert.equal(summary.measuredSlots,2);assert.equal(summary.configuredSlots,3);
 assert.equal(summary.usedBytes,null);assert.equal(summary.remainingBytes,null);
 assert.equal(summary.slots[1].usedBytes,null);assert.equal(summary.slots[1].remainingBytes,null);
 assert.equal(summary.slots[2].status,'PARTIAL');assert.equal(summary.slots[2].usedBytes,100);
 assert.equal(summary.slots[2].remainingBytes,null);assert.equal(summary.slots[2].usedPercent,null);assert.equal(summary.slots[2].beforeRolloverBytes,null);
 const markup=storageCard(summary),unavailable=markup.match(/<article[^>]*data-storage-slot="2"[\s\S]*?<\/article>/)?.[0];
 assert(unavailable);assert.match(unavailable,/Medição indisponível/);assert.match(unavailable,/Saldo indisponível/);
 assert.doesNotMatch(unavailable,/>0 B<|<progress/);
 assert.match(markup,/Medição incompleta/);assert.match(markup,/Medição parcial · saldo indisponível/);
 assert.match(markup,/Somente o banco da aplicação foi medido/);
 assert.equal((markup.match(/<progress/g)||[]).length,1);
 const missing=storagePoolSummary({enabled:true,activeSlot:1,rolloverPercent:85,slots:[slotStats(1,null),slotStats(2,null)]});
 assert.equal(missing.status,'UNAVAILABLE');assert.equal(missing.usedBytes,null);assert.equal(missing.remainingBytes,null);
});

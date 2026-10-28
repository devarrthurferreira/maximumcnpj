import test from 'node:test';
import assert from 'node:assert/strict';
import {dashboardWindow,storageSummary} from '../src/dashboard.ts';

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

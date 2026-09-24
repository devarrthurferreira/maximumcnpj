import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, digest, token, email, text, integer, escapeRegex } from '../src/security.ts';
test('Senha com scrypt, sal aleatório e comparação segura',async()=>{
 const a=await hashPassword('UmaSenhaLonga!42'),b=await hashPassword('UmaSenhaLonga!42');
 assert.notEqual(a,b);assert.equal(await verifyPassword('UmaSenhaLonga!42',a),true);
 assert.equal(await verifyPassword('outra senha',a),false);assert.equal(await verifyPassword('x','invalid'),false);
 assert.equal(await verifyPassword({},a),false);await assert.rejects(()=>hashPassword('curta'));
});
test('Tokens aleatórios, digest, validação e regex literal',()=>{
 const a=token(),b=token();assert.equal(a.length,43);assert.notEqual(a,b);assert.equal(digest(a).length,64);assert.notEqual(digest(a),a);
 assert.equal(email(' ARTHUR@EXAMPLE.COM '),'arthur@example.com');assert.throws(()=>email({$ne:''}));assert.throws(()=>text({}));assert.throws(()=>integer(1.1,0,10));
 assert.equal(new RegExp(escapeRegex('a.*$')).test('a.*$'),true);assert.equal(new RegExp(escapeRegex('a.*$')).test('abc'),false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, hashInitialAdminPassword, verifyPassword, digest, token, email, text, integer, escapeRegex, AppError } from '../src/security.ts';
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
test('Administrador inicial aceita dez caracteres e preserva a comparação exata',async()=>{
 const password='Init@12345'; // Synthetic fixture, not a production credential.
 assert.equal(password.length,10);
 const first=await hashInitialAdminPassword(password), second=await hashInitialAdminPassword(password);
 assert.notEqual(first,second);assert.equal(first.includes(password),false);
 assert.equal(await verifyPassword(password,first),true);
 assert.equal(await verifyPassword(password.toLowerCase(),first),false);
 assert.equal(await verifyPassword(password+' ',first),false);
});
test('Política inicial limita tamanho e formato sem expor o conteúdo',async()=>{
 for(const password of ['', 'x'.repeat(9), 'x'.repeat(129), null, {}, 1234567890]){
  await assert.rejects(()=>hashInitialAdminPassword(password as string),e=>e instanceof AppError && e.status===400 && e.code==='PASSWORD_POLICY' && e.message==='A senha deve ter entre 10 e 128 caracteres.');
 }
 const maximum='X'.repeat(128), hash=await hashInitialAdminPassword(maximum);
 assert.equal(await verifyPassword(maximum,hash),true);
 assert.equal(await verifyPassword(maximum+'x',hash),false);
});
test('Cadastro e troca pelo painel conservam a política regular de doze caracteres',async()=>{
 await assert.rejects(()=>hashPassword('Init@12345'),e=>e instanceof AppError && e.code==='PASSWORD_POLICY');
 const password='X'.repeat(12), hash=await hashPassword(password);
 assert.equal(await verifyPassword(password,hash),true);
});

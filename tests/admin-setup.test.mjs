import assert from 'node:assert/strict';
import { test } from 'node:test';
import { provision, validateTarget } from '../scripts/setup-admin.mjs';
function fixture(role) {
 const calls = [];
 return { calls, async query(sql, args) {
 calls.push({sql,args});
 if(sql.startsWith('SELECT id')) return {rows: role ? [{id:'fixture-id',role}] : []};
 if(sql.startsWith('SELECT role')) return {rows:[{role:'ADMIN'}]};
 return {rows:[],rowCount:1};
 }};
}
const email='fixture@example.test';
test('local guard rejects remote, production, wrong database, and conflicting environments',()=>{
 validateTarget('postgresql://localhost/reservehub_db','development');
 for(const args of [['postgresql://remote/reservehub_db'],['postgresql://localhost/other'],['postgresql://localhost/reservehub_db','production'],['postgresql://localhost/reservehub_db','development','different']]) assert.throws(()=>validateTarget(...args));
});
test('promotion normalizes email, updates only role, and verifies one ADMIN',async()=>{
 const db=fixture('USER');
 await provision(db,{mode:'promote',email:' FIXTURE@EXAMPLE.TEST ',confirmation:`ADMIN ${email}`});
 const update=db.calls.find(c=>c.sql.startsWith('UPDATE'));
 assert.match(update.sql,/SET role = 'ADMIN'/);
 assert.doesNotMatch(update.sql,/passwordHash|name|updatedAt/);
 assert.deepEqual(update.args,['fixture-id',email]);
 assert.equal(db.calls.at(-1).sql,'COMMIT');
});
test('existing ADMIN or missing user cannot be promoted',async()=>{
 for(const role of ['ADMIN',null]) {const db=fixture(role);await assert.rejects(provision(db,{mode:'promote',email,confirmation:`ADMIN ${email}`}));assert.equal(db.calls.at(-1).sql,'ROLLBACK');assert.ok(!db.calls.some(c=>c.sql.startsWith('UPDATE')));}
});
test('invalid input and confirmation cause no queries',async()=>{
 for(const input of [{mode:'promote',email:'bad',confirmation:''},{mode:'promote',email,confirmation:'no'},{mode:'create',email,name:'Test',password:'short',confirmPassword:'short',confirmation:`ADMIN ${email}`}]) {const db=fixture();await assert.rejects(provision(db,input));assert.equal(db.calls.length,0);}
});
test('creation uses cost 12 and checks duplicate emails without overwriting',async()=>{
 const input={mode:'create',email,name:'Fixture Admin',password:'safe-fixture-value',confirmPassword:'safe-fixture-value',confirmation:`ADMIN ${email}`};
 const db=fixture();let cost;
 await provision(db,input,async(_,rounds)=>{cost=rounds;return 'opaque-fixture';});
 assert.equal(cost,12);assert.equal(db.calls.filter(c=>c.sql.startsWith('INSERT')).length,1);assert.equal(db.calls.at(-1).sql,'COMMIT');
 const duplicate=fixture('USER');await assert.rejects(provision(duplicate,input,async()=> 'opaque-fixture'));assert.ok(!duplicate.calls.some(c=>c.sql.startsWith('INSERT')||c.sql.startsWith('UPDATE')));
});
test('password mismatch and excessive UTF-8 length rejected',async()=>{
 for(const password of ['a'.repeat(73),'valid-password']) {const db=fixture();await assert.rejects(provision(db,{mode:'create',email,name:'Fixture Admin',password,confirmPassword:'different',confirmation:`ADMIN ${email}`}));assert.equal(db.calls.length,0);}
});
test('wrong affected count rolls back promotion',async()=>{
 const db=fixture('USER');const query=db.query.bind(db);db.query=async(sql,args)=>sql.startsWith('UPDATE')?{rowCount:0}:query(sql,args);
 await assert.rejects(provision(db,{mode:'promote',email,confirmation:`ADMIN ${email}`}));assert.equal(db.calls.at(-1).sql,'ROLLBACK');
});

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {checkedSkillFileMetadata,readUTF8File} from '../../../lib/admin-skill-package.ts';

const raw=readFileSync(new URL('./_components/operator-skill-content-editor.tsx',import.meta.url),'utf8');
const source=ts.createSourceFile('editor.tsx',raw,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let callback;
function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='readFile')callback=node.initializer.getText(source);ts.forEachChild(node,visit)}
visit(source);assert.ok(callback);
const code=ts.transpileModule('globalThis.read = '+callback,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const file=(name='SKILL.md')=>({name,size:50,arrayBuffer:async()=>new TextEncoder().encode('---\nname: review\ndescription: Review\n---\nBody').buffer});
const valid={success:true,data:{valid:true,items:[{index:0,valid:true,errors:[],name:'review',description:'Review'}]}};

function setup(check=async()=>valid){
  const messages=[],imports=[],requests=[],confirmations=[];
  const context={Error,value:'Existing content',latestValueRef:{current:'Existing content'},readSequenceRef:{current:0},importing:false,
    MAX_OPERATOR_SKILL_DOCUMENT_BYTES:512*1024,checkedSkillFileMetadata,readUTF8File,
    adminSkillsApi:{validateFiles:async packages=>{requests.push(packages);return check()}},
    confirmDialog:async options=>{confirmations.push(options);return true},
    toast:{error:message=>messages.push(message),success:message=>messages.push(message)},
    setImporting:value=>{context.importing=value},setMode:()=>{},onImport:content=>imports.push(content)};
  vm.createContext(context);vm.runInContext(code,context);
  return {context,messages,imports,requests,confirmations,read:file=>context.read({target:{files:[file],value:'selected'}})};
}

test('operator editor rejects nonstandard filenames and server-rejected content',async()=>{
  const env=setup(async()=>({success:true,data:{valid:false,items:[{index:0,valid:false,errors:['YAML 格式错误']} ]}}));
  await env.read(file('notes.txt'));assert.equal(env.requests.length,0);
  await env.read(file());assert.equal(env.requests.length,1);
  assert.equal(env.imports.length,0);assert.equal(env.confirmations.length,0);
  assert.ok(env.messages.some(message=>message.includes('YAML 格式错误')));
  assert.equal(env.context.importing,false);
});
test('valid operator import is checked before replacement and retains its metadata',async()=>{
  const env=setup();await env.read(file());
  assert.equal(env.imports.length,1);assert.equal(env.confirmations.length,1);
  assert.equal(env.requests[0][0].files[0].content,env.imports[0]);
  assert.ok(env.imports[0].startsWith('---\nname: review'));
});
test('typing while validation is pending cannot be overwritten by the late file',async()=>{
  let complete;const pending=new Promise(resolve=>{complete=resolve});
  const env=setup(()=>pending);const reading=env.read(file());
  await new Promise(resolve=>setImmediate(resolve));
  env.context.latestValueRef.current='New typed draft';complete(valid);await reading;
  assert.equal(env.imports.length,0);assert.equal(env.confirmations.length,0);
  assert.equal(env.context.importing,false);
});

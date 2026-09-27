import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {checkedSkillFileMetadata} from '../../../lib/admin-skill-package.ts';

const raw=readFileSync(new URL('./_components/skill-import-modal.tsx',import.meta.url),'utf8');
const source=ts.createSourceFile('importer.tsx',raw,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const functions=source.statements.filter(n=>ts.isFunctionDeclaration(n)&&['truncateRunes','prepareDraftPackage'].includes(n.name?.text)).map(n=>n.getText(source)).join('\n');
const code=ts.transpileModule(functions+'\nglobalThis.prepare=prepareDraftPackage;', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;

function setup({reject=false}={}){
  const calls=[];
  const pkg={primaryFilePath:'SKILL.md',files:[{path:'SKILL.md',content:'draft header'},{path:'references/original.txt',content:'GPT raw text'}]};
  const context=vm.createContext({checkedSkillFileMetadata,adminSkillsApi:{
    prepareDraft:async(text,signal)=>{calls.push({action:'prepare',text,signal});return{success:true,data:pkg};},
    validateFiles:async(packages,signal)=>{calls.push({action:'validate',packages,signal});return {success:true,data:{valid:!reject,items:[{index:0,valid:!reject,errors:reject?['文档无效']:[],name:'imported-skill',description:'Draft'}]}};},
  }});
  vm.runInContext(code,context);return{prepare:context.prepare,calls,pkg};
}

test('GPT draft goes through admin source preparation and format validation before AI',async()=>{
  const env=setup(),signal=new AbortController().signal;
  const packages=await env.prepare('GPT raw text',signal);
  assert.deepEqual(env.calls.map(c=>c.action),['prepare','validate']);
  assert.equal(env.calls[0].text,'GPT raw text');assert.equal(env.calls[1].signal,signal);
  assert.equal(packages[0].draftSource,true);assert.equal(packages[0].files[1].content,'GPT raw text');
});
test('invalid or canceled drafts cannot become importable packages',async()=>{
  const env=setup({reject:true});await assert.rejects(env.prepare('text',new AbortController().signal),/文档无效/);
  const canceled=new AbortController();canceled.abort();const next=setup();await assert.rejects(next.prepare('text',canceled.signal),/取消/);
  assert.equal(next.calls.length,1);
});

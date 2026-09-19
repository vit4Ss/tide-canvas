import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import {checkedSkillFileMetadata,readUTF8File} from '../../../lib/admin-skill-package.ts';

const raw=readFileSync(new URL('./_components/skill-import-modal.tsx',import.meta.url),'utf8');
const source=ts.createSourceFile('import.tsx',raw,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const names=new Set(['truncateRunes','readUTF8File','prepareFiles']);
const functions=source.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.has(node.name?.text)).map(node=>node.getText(source)).join('\n');
const code=ts.transpileModule(functions+'\nglobalThis.prepare=prepareFiles;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const file=(name,content,relative='')=>({name,size:Buffer.byteLength(content),webkitRelativePath:relative,arrayBuffer:async()=>new TextEncoder().encode(content).buffer});

function setup(valid=true) {
  const requests=[];
  const context={Blob,TextDecoder,Error,checkedSkillFileMetadata,readUTF8File,MAX_ARCHIVE_BYTES:16*1024*1024,MAX_FILE_BYTES:2*1024*1024,MAX_TOTAL_BYTES:8*1024*1024,MAX_PRIMARY_FILE_BYTES:1024*1024,MAX_PACKAGES:50,
    adminSkillsApi:{validateFiles:async packages=>{
      requests.push(packages);
      return {success:true,data:{valid,items:packages.map((_,index)=>({index,valid,errors:valid?[]:['SKILL.md 缺少 name'],name:valid?'review':undefined,description:valid?'Review\nvideos':undefined}))}};
    }},
  };
  vm.createContext(context);vm.runInContext(code,context);
  return {prepare:context.prepare,requests};
}

test('plain text and incorrectly named markdown cannot be promoted to Skill',async()=>{
  const env=setup();
  for(const name of ['prompt.txt','review.md','skill.md']) await assert.rejects(env.prepare([file(name,'# Instructions')]),/标准主文件/);
  assert.equal(env.requests.length,0);
});

test('directory collections split skills at their own roots like ZIP imports',async()=>{
  const env=setup();
  const packages=await env.prepare([
    file('SKILL.md','Standard skill A','bundle/a/SKILL.md'),
    file('guide.md','Only for A','bundle/a/references/guide.md'),
    file('SKILL.md','Standard nested skill','bundle/a/nested/SKILL.md'),
    file('guide.md','Only for nested','bundle/a/nested/references/guide.md'),
    file('SKILL.md','Standard skill B','bundle/b/SKILL.md'),
    {name:'README.md',webkitRelativePath:'bundle/README.md',size:10*1024*1024,arrayBuffer:async()=>{throw new Error('outside file must not be read')}},
    file('run.py','Not imported','bundle/b/scripts/run.py'),
  ]);
  assert.equal(packages.length,3);
  const paths=env.requests[0].map(pkg=>[pkg.primaryFilePath,pkg.files.map(file=>file.path)]);
  assert.deepEqual(JSON.parse(JSON.stringify(paths)),[
    ['bundle/a/SKILL.md',['bundle/a/SKILL.md','bundle/a/references/guide.md']],
    ['bundle/a/nested/SKILL.md',['bundle/a/nested/SKILL.md','bundle/a/nested/references/guide.md']],
    ['bundle/b/SKILL.md',['bundle/b/SKILL.md']],
  ]);
  assert.equal(packages.reduce((sum,pkg)=>sum+(pkg.ignoredFiles||0),0),2);
});
test('SKILL.md content must pass server validation before the package is available to AI',async()=>{
  const env=setup(false);
  await assert.rejects(env.prepare([file('SKILL.md','# Plain prompt')]),/缺少 name/);
  assert.equal(env.requests.length,1);
});
test('directory retains its root for the server to check name against directory',async()=>{
  const env=setup();
  const content='---\nname: review\ndescription: Review videos\n---\nInstructions';
  const packages=await env.prepare([file('SKILL.md',content,'review/SKILL.md'),file('rules.md','Reference','review/references/rules.md')]);
  assert.equal(env.requests[0][0].primaryFilePath,'review/SKILL.md');
  assert.equal(packages[0].title,'review');assert.equal(packages[0].description,'Review\nvideos');
  assert.equal(packages[0].files[0].content,content,'uploaded documents are not auto-repaired');
});
test('a selected directory containing only a readme is rejected',async()=>{
  const env=setup();
  await assert.rejects(env.prepare([file('readme.md','# Hello','review/readme.md')]),/缺少 SKILL.md/);
  assert.equal(env.requests.length,0);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {authoredSkillFile,checkedSkillFileMetadata,readUTF8File} from './admin-skill-package.ts';

test('all file packages must be validated, with complete parsed metadata',()=>{
  const item={index:0,valid:true,errors:[],name:'review',description:'Review videos'};
  const response={success:true,data:{valid:true,items:[item]}};
  assert.deepEqual(checkedSkillFileMetadata(response,1),[{name:'review',description:'Review videos'}]);
  assert.throws(()=>checkedSkillFileMetadata(response,2),/不完整/);
  assert.throws(()=>checkedSkillFileMetadata({...response,data:{...response.data,items:[{...item,index:1}]}},1),/不完整/);
  assert.throws(()=>checkedSkillFileMetadata({...response,data:{...response.data,items:[{...item,description:undefined}]}},1),/description/);
  assert.throws(()=>checkedSkillFileMetadata({success:false,message:'服务暂不可用'},1),/服务暂不可用/);
});

test('malformed validation responses fail with an actionable message',()=>{
  for (const items of [[null],[{index:0,valid:'true'}],[{index:0,valid:false,errors:{unexpected:true}}]]) {
    assert.throws(()=>checkedSkillFileMetadata({success:true,data:{valid:true,items}},1),/格式不符合规范|不完整/);
  }
  assert.throws(()=>checkedSkillFileMetadata(null,1),/暂不可用/);
});

test('both import and replacement preserve valid UTF-8 and reject invalid bytes',async()=>{
  const content='---\r\nname: review\r\ndescription: 审片\r\n---\r\n内容';
  const valid={arrayBuffer:async()=>new TextEncoder().encode('\ufeff'+content).buffer};
  assert.equal(await readUTF8File(valid,'SKILL.md'),content);
  await assert.rejects(readUTF8File({arrayBuffer:async()=>new Uint8Array([255,254,254]).buffer},'SKILL.md'),/UTF-8/);
  await assert.rejects(readUTF8File({arrayBuffer:async()=>{throw new Error('io error')}},'SKILL.md'),/无法读取/);
});
test('one invalid package rejects the batch even when the others are valid',()=>{
  assert.throws(()=>checkedSkillFileMetadata({success:true,data:{valid:false,items:[
    {index:0,valid:true,name:'review',description:'Review',errors:[]},
    {index:1,valid:false,errors:['必须包含 YAML name 和 description']},
  ]}},2),/第 2 个 Skill.*YAML/);
});
test('manual authoring creates escaped YAML without changing execution instructions',()=>{
  const instructions='# Review\n{{input.prompt}}';
  const doc=authoredSkillFile('Video REVIEW / 镜头', 'He said "Hello"\nwhen reviewing.', instructions);
  assert.equal(doc.path,'SKILL.md');
  assert.match(doc.content,/name: "video-review-镜头"/);
  assert.ok(doc.content.endsWith(instructions));
  const descriptionLine=doc.content.split('\n').find(line=>line.startsWith('description: '));
  assert.equal(JSON.parse(descriptionLine.slice(13)),'He said "Hello"\nwhen reviewing.');
});

test('an existing Skill document is never wrapped to mask invalid metadata',()=>{
  const source='---\nname: WRONG_NAME\n---\nInstructions';
  assert.equal(authoredSkillFile('Valid display title','Display description',source).content,source);
  const bom='\ufeff'+source.replaceAll('\n','\r\n');
  assert.equal(authoredSkillFile('Valid','Description',bom).content,bom);
});

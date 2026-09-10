import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {useCanvasStore} from '../../../stores/use-canvas-store.ts';

const text=readFileSync(new URL('./image-node.tsx',import.meta.url),'utf8');
const source=ts.createSourceFile('image-node.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let callback;
function visit(node){
  if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='handlePanoCapture4') callback=node.initializer.arguments[0].getText(source);
  ts.forEachChild(node,visit);
}
visit(source);assert.ok(callback);
const code=ts.transpileModule(`globalThis.capture = ${callback};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;

function setup({failFirst=false,failRenderAt=-1,switchProjectAt=0}={}) {
  const node={id:'pano',type:'image',x:0,y:0,width:600,height:300,imageSrc:'https://cdn/panorama.png',title:'全景'};
  useCanvasStore.getState().loadCanvas([node],[]);
  useCanvasStore.getState().setCurrentProjectId('project');
  const messages=[],deleted=[],lock={current:false};let uploads=0,busy=null,id=0;
  const context={useCanvasStore,node,panoCaptureBusy:null,panoCaptureLockRef:lock,mountedRef:{current:true},derivativeNodeType:'image',
    generateNodeId:()=>`frame-${++id}`,setPanoCaptureBusy:value=>{busy=value},
    File,Error,toast:{info:message=>messages.push(message),error:message=>messages.push(message),success:message=>messages.push(message)},
    uploadFileSmart:async()=>{
      uploads++;
      if(switchProjectAt===uploads)useCanvasStore.getState().setCurrentProjectId('other');
      if(failFirst&&uploads===1)return {success:false,message:'first upload failed'};
      return {success:true,data:{id:`file-${uploads}`,fileUrl:`https://cdn/frame-${uploads}.png`,mimeType:'image/png'}};
    },
    fileApi:{delete:async id=>{deleted.push(id)}},
    panoApiRef:{current:{capture4:async consume=>{
      for(let i=0;i<4;i++) {
        if(i===failRenderAt)throw new Error('worker failed');
        await consume({blob:new Blob(['png'],{type:'image/png'}),width:2560,height:1280},i);
      }
    }}},
  };
  vm.createContext(context);vm.runInContext(code,context);
  return {capture:context.capture,messages,deleted,lock,getBusy:()=>busy};
}

test('first upload failure still leaves all successful views in one undoable transaction',async()=>{
  const env=setup({failFirst:true});await env.capture();
  assert.equal(useCanvasStore.getState().nodes.length,4);
  assert.equal(useCanvasStore.getState().connections.length,3);
  assert.equal(useCanvasStore.getState().undoStack.length,1);
  assert.match(env.messages.at(-1),/3\/4/);
  useCanvasStore.getState().undo();
  assert.deepEqual(useCanvasStore.getState().nodes.map(n=>n.id),['pano']);
  assert.equal(useCanvasStore.getState().connections.length,0);
  assert.equal(env.lock.current,false);assert.equal(env.getBusy(),null);
});
test('later render failure retains earlier uploaded views and reports partial success',async()=>{
  const env=setup({failRenderAt:2});await env.capture();
  assert.equal(useCanvasStore.getState().nodes.length,3);
  assert.match(env.messages.at(-1),/2\/4.*worker failed/);
  assert.equal(useCanvasStore.getState().undoStack.length,1);
});
test('switching projects during upload removes current and earlier uncommitted files',async()=>{
  const env=setup({switchProjectAt:2});await env.capture();
  assert.deepEqual(useCanvasStore.getState().nodes.map(n=>n.id),['pano']);
  assert.equal(useCanvasStore.getState().undoStack.length,0);
  assert.deepEqual(new Set(env.deleted),new Set(['file-1','file-2']));
  assert.equal(env.lock.current,false);assert.equal(env.getBusy(),null);
});

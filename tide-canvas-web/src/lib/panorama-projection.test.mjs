import assert from "node:assert/strict";
import test from "node:test";
import { projectPanorama } from "./panorama-projection.ts";
import {PerspectiveCamera,Raycaster,SphereGeometry,Mesh,MeshBasicMaterial,Vector2} from 'three';

function raster(width, height, pixel) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y=0;y<height;y++) for(let x=0;x<width;x++) data.set(pixel(x,y), (y*width+x)*4);
  return data;
}
const view = (yaw=180,pitch=0) => ({width:1,height:1,yaw,pitch,verticalFov:74});

test("panorama yaw and pitch sample the same original orientation as the viewer", () => {
  const source = raster(8,4,(x,y)=>[x*30,y*60,42,255]);
  assert.deepEqual([...projectPanorama(source,8,4,view())], [105,90,42,255]);
  assert.deepEqual([...projectPanorama(source,8,4,view(90))], [45,90,42,255]);
  assert.deepEqual([...projectPanorama(source,8,4,view(270))], [165,90,42,255]);
  assert.deepEqual([...projectPanorama(source,8,4,view(180,45))], [105,30,42,255]);
  assert.deepEqual([...projectPanorama(source,8,4,view(180,-45))], [105,150,42,255]);
});

test('off-centre export pixels match the actual Three.js inward sphere UVs',()=>{
  const width=1024,height=512;
  const data=raster(width,height,(x,y)=>[Math.round(x/width*255),Math.round(y/height*255),42,255]);
  const geometry=new SphereGeometry(500,256,128);geometry.scale(-1,1,1);
  const material=new MeshBasicMaterial();const mesh=new Mesh(geometry,material);mesh.updateMatrixWorld();
  try {
    for(const [yaw,pitch] of [[180,0],[90,32],[260,-40]]) {
      const capture={width:41,height:23,yaw,pitch,verticalFov:74};
      const pixels=projectPanorama(data,width,height,capture);
      const camera=new PerspectiveCamera(74,41/23,0.1,1100);
      const az=yaw*Math.PI/180,el=pitch*Math.PI/180;
      camera.lookAt(Math.cos(el)*Math.cos(az),Math.sin(el),Math.cos(el)*Math.sin(az));camera.updateMatrixWorld();
      for(const [x,y] of [[0,0],[40,0],[0,22],[40,22],[10,6],[20,11]]) {
        const ray=new Raycaster();ray.setFromCamera(new Vector2(2*(x+0.5)/41-1,1-2*(y+0.5)/23),camera);
        const hit=ray.intersectObject(mesh)[0];assert.ok(hit);
        const offset=(y*41+x)*4;
        assert.ok(Math.abs(pixels[offset]-(hit.uv.x*255))<=2,'horizontal direction or seam mismatch');
        assert.ok(Math.abs(pixels[offset+1]-((1-hit.uv.y)*255))<=2,'vertical direction or pole mismatch');
      }
    }
  } finally {geometry.dispose();material.dispose()}
});

test("horizontal seam wraps and the poles clamp without a black line", () => {
  const source = raster(8,4,(x)=>[x*30,25,42,255]);
  const first = projectPanorama(source,8,4,view(0));
  assert.deepEqual([...first], [105,25,42,255]);
  assert.deepEqual(projectPanorama(source,8,4,view(360)), first);
  const solid = raster(8,4,()=>[197,52,25,255]);
  const result = projectPanorama(solid,8,4,{...view(359,85),width:41,height:23});
  for(let i=0;i<result.length;i+=4) assert.deepEqual([...result.slice(i,i+4)], [197,52,25,255]);
});

test("identity-colour export stays exact and transparent edges do not darken", () => {
  const source = raster(2,2,(x)=>x===0?[200,100,50,255]:[0,0,0,0]);
  assert.deepEqual([...projectPanorama(source,2,2,view())], [200,100,50,128]);
});

test("invalid data and oversized buffers fail explicitly instead of silently resizing", () => {
  assert.throws(()=>projectPanorama(new Uint8ClampedArray(4),8192,4096,view()));
  assert.throws(()=>projectPanorama(new Uint8ClampedArray(4),1,1,{...view(),width:8192,height:8192}));
  assert.throws(()=>projectPanorama(new Uint8ClampedArray(4),1,1,{...view(),yaw:NaN}));
  assert.throws(()=>projectPanorama(new Uint8ClampedArray(4),8000,6000,view()),/尺寸或视角无效/);
});

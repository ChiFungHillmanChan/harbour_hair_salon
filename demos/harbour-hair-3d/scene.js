import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAYOUT, floorHeightAt, canWalkAt } from './layout.js';
import { batchStaticMeshes, pixelRatioFor, renderingQuality } from './rendering.js';

const emit = (name, detail = {}) => window.dispatchEvent(new CustomEvent(`salon:${name}`, { detail }));
const listen = (name, callback) => window.addEventListener(`salon:${name}`, event => callback(event.detail));
const clamp = THREE.MathUtils.clamp;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function start() {
  const canvas = document.getElementById('scene');
  const quality = renderingQuality({ coarsePointer: matchMedia('(pointer: coarse)').matches, width: innerWidth, height: innerHeight, cores: navigator.hardwareConcurrency });
  let animationId=0, needsRender=true, frameVisible=true, contextLost=false, lastTime=0;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.shadowMap.enabled = !quality.compact;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(39, 1, 0.08, 150);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.085;
  controls.minDistance = 5;
  controls.maxDistance = 32;
  controls.maxPolarAngle = Math.PI / 2.08;
  controls.minPolarAngle = 0.15;
  controls.enablePan = true;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = new RoomEnvironment();
  const envTarget = pmrem.fromScene(environment, 0.04);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.38;
  environment.dispose();
  pmrem.dispose();

  const materials = new Map();
  const mat = (color, roughness = 0.5, metalness = 0) => {
    const key=`${color}:${roughness}:${metalness}`;
    if(!materials.has(key))materials.set(key,new THREE.MeshStandardMaterial({ color, roughness, metalness }));
    return materials.get(key);
  };
  const ivory = mat('#ebe7de', 0.85);
  const black = mat('#14191c', 0.39);
  const leather = mat('#1c2429', 0.43);
  const leatherSeam = mat('#343c40', 0.68);
  const cabinet = mat('#30383b', 0.58);
  const steel = mat('#aab6c1', 0.24, 0.9);
  const darkSteel = mat('#3b4852', 0.29, 0.82);
  const wood = mat('#c9ad7f', 0.68);
  const ceramic = mat('#f4f3eb', 0.18);
  const white = mat('#e7e9e5', 0.7);
  const blue = mat('#174f7f', 0.65);
  const glass = new THREE.MeshPhysicalMaterial({ color:'#b8daee', metalness:0.05, roughness:0.14, transparent:true, opacity:0.37, side:THREE.DoubleSide, depthWrite:false });
  const glow = new THREE.MeshStandardMaterial({color: '#fff9e5', emissive:'#d7eaff', emissiveIntensity:2.6, roughness:0.35});
  const wallMaterials = [ivory];
  const chairMaterials = [leather];
  const group = new THREE.Group();
  scene.add(group);
  const stylingFloor = new THREE.Group();
  stylingFloor.position.set(0, LAYOUT.stylingRise, LAYOUT.stylingOffsetZ);
  group.add(stylingFloor);
  const geoCache = new Map();
  function box(w,h,d,material,x=0,y=0,z=0,parent=group,r=0.02) {
    const key = `${w}:${h}:${d}:${r}`;
    if (!geoCache.has(key)) geoCache.set(key, r ? new RoundedBoxGeometry(w,h,d,quality.compact?1:2,Math.min(r,w/3,h/3,d/3)) : new THREE.BoxGeometry(w,h,d));
    const mesh = new THREE.Mesh(geoCache.get(key), material);
    mesh.position.set(x,y,z); mesh.castShadow = !material.transparent; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  function cyl(rt,rb,h,material,x,y,z,parent=group,segments=24) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,quality.compact?Math.min(segments,16):segments),material);
    mesh.position.set(x,y,z); mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  function sphere(rx,ry,rz,material,x,y,z,parent=group) {
    const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,quality.compact?12:20,quality.compact?8:12),material);mesh.scale.set(rx,ry,rz);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  function rod(a,b,r,material,parent=group) {
    const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),d=bv.clone().sub(av);
    const mesh=cyl(r,r,d.length(),material,...av.clone().add(bv).multiplyScalar(.5).toArray(),parent,10);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());return mesh;
  }
  function torus(radius,tube,material,x,y,z,parent=group) {
    const mesh=new THREE.Mesh(new THREE.TorusGeometry(radius,tube,quality.compact?6:10,quality.compact?32:64),material);mesh.position.set(x,y,z);mesh.castShadow=true;parent.add(mesh);return mesh;
  }
  function texture(draw,w=1024,h=1024) {
    const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');draw(ctx,w,h);
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=renderer.capabilities.getMaxAnisotropy();return t;
  }
  let seed=12;
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const stoneMap=texture((ctx,w,h)=>{
    ctx.fillStyle='#42494e';ctx.fillRect(0,0,w,h);
    for(let i=0;i<18000;i++){const g=40+random()*50;ctx.fillStyle=`rgba(${g},${g+3},${g+6},.12)`;ctx.fillRect(random()*w,random()*h,random()*8+1,random()*4+1);}
    ctx.strokeStyle='#899193';ctx.lineWidth=3;ctx.strokeRect(1,1,w-2,h-2);
    for(let i=0;i<14;i++){ctx.strokeStyle='rgba(185,191,185,.08)';ctx.lineWidth=.3+random();ctx.beginPath();const y=random()*h;ctx.moveTo(0,y);ctx.bezierCurveTo(w*.3,y-30,w*.6,y+50,w,y+random()*100);ctx.stroke();}
  },512,512);stoneMap.wrapS=stoneMap.wrapT=THREE.RepeatWrapping;stoneMap.repeat.set(8,LAYOUT.depth/.927);
  const oakMap=texture((ctx,w,h)=>{
    ctx.fillStyle='#ae8b60';ctx.fillRect(0,0,w,h);
    for(let i=0;i<1000;i++){ctx.strokeStyle=`rgba(${80+random()*50},${60+random()*40},${30+random()*35},${.04+random()*.13})`;ctx.lineWidth=random()*3;let x=random()*w;ctx.beginPath();ctx.moveTo(x,0);ctx.bezierCurveTo(x+10,200,x-15,800,x,h);ctx.stroke();}
    ctx.strokeStyle='#745a3e';ctx.lineWidth=3;for(let x=0;x<=w;x+=128){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();ctx.beginPath();let y=((x/128)%3)*341;ctx.moveTo(x,y);ctx.lineTo(x+128,y);ctx.stroke();}
  });oakMap.wrapS=oakMap.wrapT=THREE.RepeatWrapping;oakMap.repeat.set(2,LAYOUT.depth/5.1);
  const counterMap=texture((ctx,w,h)=>{ctx.fillStyle='#575857';ctx.fillRect(0,0,w,h);for(let i=0;i<800;i++){ctx.fillStyle=`rgba(20,24,25,${random()*.15})`;ctx.fillRect(0,random()*h,w,random()*2);}},256,256);
  const counterMat=mat('#bab6ae',.48);counterMat.map=counterMap;
  const floorMat=new THREE.MeshStandardMaterial({map:stoneMap,roughness:.27,metalness:.18,color:'#c4d0d8'});
  // Reception steps inward from the wider salon; the glazing follows the return.
  function footprintSlab(height,y,material,padding=0,parent=group) {
    const half=LAYOUT.width/2;
    const outline=[[-half-padding,LAYOUT.back-padding],[half+padding,LAYOUT.back-padding],
      [half+padding,LAYOUT.receptionStartZ+padding],
      [LAYOUT.receptionMaxX+padding,LAYOUT.receptionStartZ+padding],
      [LAYOUT.receptionMaxX+padding,LAYOUT.front+padding],[-half-padding,LAYOUT.front+padding]];
    const shape=new THREE.Shape();outline.forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false,steps:1});
    geometry.rotateX(-Math.PI/2);geometry.translate(0,y-height/2,0);
    const vertices=geometry.attributes.position, uv=geometry.attributes.uv;
    for(let i=0;i<vertices.count;i++)uv.setXY(i,(vertices.getX(i)+half)/LAYOUT.width,(vertices.getZ(i)-LAYOUT.back)/LAYOUT.depth);
    uv.needsUpdate=true;
    const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  footprintSlab(.38,-.31,mat('#142735',.6),.175);
  footprintSlab(.055,-.09,wood,.08);
  function floorSlab(height, depth, y, z, width=LAYOUT.width, x=0) {
    const slab = box(width,height,depth,floorMat,x,y,z,group,0);
    // Keep the tile and wood grain scale continuous across the two levels.
    slab.geometry = slab.geometry.clone();
    const vertices = slab.geometry.attributes.position;
    const uv = slab.geometry.attributes.uv;
    for (let i=0;i<vertices.count;i++) uv.setXY(i,(vertices.getX(i)+x+LAYOUT.width/2)/LAYOUT.width,(vertices.getZ(i)+z-LAYOUT.back)/LAYOUT.depth);
    uv.needsUpdate = true;
    return slab;
  }
  footprintSlab(.13,-.005,floorMat);
  const upperDepth = LAYOUT.stylingEdge-LAYOUT.back;
  floorSlab(LAYOUT.stylingRise,upperDepth,.06+LAYOUT.stylingRise/2,(LAYOUT.back+LAYOUT.stylingEdge)/2);
  const stairWidth=LAYOUT.width/2-LAYOUT.aisleMinX, stairX=LAYOUT.aisleMinX+stairWidth/2;
  floorSlab(LAYOUT.stepRise,LAYOUT.stepDepth,.06+LAYOUT.stepRise/2,LAYOUT.stylingEdge+LAYOUT.stepDepth/2,stairWidth,stairX);
  // Two visible nosings mark the two rises to the styling floor.
  for (const [z,rise] of [[LAYOUT.stylingEdge,LAYOUT.stylingRise],[LAYOUT.stylingEdge+LAYOUT.stepDepth,LAYOUT.stepRise]]) {
    box(stairWidth-.06,.014,.035,steel,stairX,.066+rise,z-.018,group,.003);
  }
  // Floating miniature rests above a soft studio shadow.
  const shadowMap=texture((ctx,w,h)=>{const g=ctx.createRadialGradient(w/2,h/2,50,w/2,h/2,w/2);g.addColorStop(0,'rgba(0,0,0,.75)');g.addColorStop(.65,'rgba(0,0,0,.38)');g.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);});
  const shadow=new THREE.Mesh(new THREE.PlaneGeometry(17,LAYOUT.depth+10),new THREE.MeshBasicMaterial({map:shadowMap,transparent:true,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.set(0,-.53,LAYOUT.center);scene.add(shadow);
  const stage = new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.ShadowMaterial({opacity:.17}));stage.rotation.x=-Math.PI/2;stage.position.y=-.51;stage.receiveShadow=true;scene.add(stage);

  const walls={left:new THREE.Group(),right:new THREE.Group(),front:new THREE.Group(),back:new THREE.Group()};
  Object.values(walls).forEach(w=>group.add(w));
  const stylingWalls = {left:new THREE.Group(),right:new THREE.Group()};
  for (const side of ['left','right']) {
    stylingWalls[side].position.copy(stylingFloor.position);
    walls[side].add(stylingWalls[side]);
  }
  const halfWidth=LAYOUT.width/2;
  const wallHeight = 3.15;
  const doorStart = LAYOUT.entrance.z-LAYOUT.entrance.width/2;
  const doorEnd = LAYOUT.entrance.z+LAYOUT.entrance.width/2;
  const backWallZ = LAYOUT.back-.03;
  box(.16,wallHeight,LAYOUT.depth,ivory,-halfWidth-.02,wallHeight/2,LAYOUT.center,walls.left);
  // Solid white wall behind the garment stand; only the entrance corner is glazed.
  const glazing=LAYOUT.glazing, mainWallDepth=glazing.returnZ-LAYOUT.back;
  box(.16,wallHeight,mainWallDepth,ivory,halfWidth+.02,wallHeight/2,(LAYOUT.back+glazing.returnZ)/2,walls.right);
  box(.14,.21,mainWallDepth,ivory,halfWidth+.02,.12,(LAYOUT.back+glazing.returnZ)/2);
  const returnWidth=glazing.outerX-LAYOUT.receptionMaxX, glassReturnX=(glazing.outerX+LAYOUT.receptionMaxX)/2;
  box(returnWidth,2.57,.035,glass,glassReturnX,1.355,glazing.returnZ,group,0);
  for(const x of [glazing.outerX,LAYOUT.receptionMaxX])box(.04,2.65,.04,darkSteel,x,1.385,glazing.returnZ);
  for(const y of [.075,2.7])box(returnWidth,.045,.045,darkSteel,glassReturnX,y,glazing.returnZ);
  box(returnWidth,wallHeight-2.7,.16,ivory,glassReturnX,(wallHeight+2.7)/2,glazing.returnZ,walls.right);
  // Glazed sidelights join that return directly to the closer entrance.
  for(const [start,end] of [[LAYOUT.receptionStartZ,doorStart],[doorEnd,LAYOUT.front]]) {
    if(end-start<.001)continue;
    box(.035,2.7,end-start,glass,LAYOUT.entrance.x,1.42,(start+end)/2,group,0);
    for(const y of [.075,2.82])box(.045,.045,end-start,darkSteel,LAYOUT.entrance.x,y,(start+end)/2);
  }
  box(.16,wallHeight-2.82,LAYOUT.front-LAYOUT.receptionStartZ,ivory,LAYOUT.entrance.x,(wallHeight+2.82)/2,(LAYOUT.front+LAYOUT.receptionStartZ)/2,walls.right);
  // Small circular garment stand beside the single entrance-side glass step.
  const rackX=LAYOUT.coat.x, rackZ=LAYOUT.coat.z, railRadius=LAYOUT.coat.railRadius;
  const rack=new THREE.Group();rack.position.set(rackX,0,rackZ);group.add(rack);
  cyl(.205,.22,.045,darkSteel,0,.0825,0,rack,36);
  rod([0,.105,0],[0,1.82,0],.022,darkSteel,rack);
  const roundRail=torus(railRadius,.018,darkSteel,0,1.82,0,rack);roundRail.rotation.x=Math.PI/2;
  const coat=mat('#26313a',.98);
  for(let i=0;i<3;i++) {
    const angle=i*Math.PI*2/3+.3;
    rod([0,1.82,0],[Math.sin(angle)*railRadius,1.82,Math.cos(angle)*railRadius],.012,darkSteel,rack);
    const hanger=new THREE.Group();hanger.position.set(Math.sin(angle)*railRadius,0,Math.cos(angle)*railRadius);hanger.rotation.y=angle;rack.add(hanger);
    rod([0,1.82,0],[0,1.69,0],.01,steel,hanger);
    rod([0,1.69,0],[-.145,1.57,0],.013,wood,hanger);rod([0,1.69,0],[.145,1.57,0],.013,wood,hanger);
    rod([-.145,1.57,0],[.145,1.57,0],.013,wood,hanger);
    if(i===1) {
      box(.22,.62,.05,coat,0,1.22,0,hanger,.045);
      for(const side of [-1,1])box(.06,.32,.05,coat,side*.115,1.37,0,hanger,.025);
      box(.012,.55,.008,steel,0,1.23,.029,hanger,.003);
    }
  }
  const receptionWidth=LAYOUT.receptionMaxX+LAYOUT.width/2, receptionX=(LAYOUT.receptionMaxX-LAYOUT.width/2)/2;
  box(receptionWidth+.1,wallHeight,.16,ivory,receptionX,wallHeight/2,LAYOUT.front+.03,walls.front);
  box(.14,.21,LAYOUT.depth,ivory,-halfWidth-.02,.12,LAYOUT.center);
  box(receptionWidth+.1,.22,.16,ivory,receptionX,.12,LAYOUT.front+.03);
  // Keep the open portal and its sill visible in the cutaway view as well.
  for (const z of [doorStart,doorEnd]) box(.085,2.82,.075,darkSteel,LAYOUT.entrance.x,1.41,z);
  box(.085,.075,LAYOUT.entrance.width+.075,darkSteel,LAYOUT.entrance.x,2.82,LAYOUT.entrance.z);
  box(.16,.025,LAYOUT.entrance.width,steel,LAYOUT.entrance.x,.075,LAYOUT.entrance.z);
  const rise = LAYOUT.stylingRise;
  const windowWidth=LAYOUT.width-.65, windowBottom=1.65+rise, windowHeight=.94;
  box(LAYOUT.width+.1,windowBottom,.16,ivory,0,windowBottom/2,backWallZ,walls.back);
  box(LAYOUT.width+.1,wallHeight-windowBottom-windowHeight,.16,ivory,0,(wallHeight+windowBottom+windowHeight)/2,backWallZ,walls.back);
  for(const side of [-1,1])box(.36,windowHeight,.16,ivory,side*(halfWidth-.13),windowBottom+windowHeight/2,backWallZ,walls.back);
  box(windowWidth+.12,.10,.28,white,0,windowBottom,LAYOUT.back+.08,walls.back);
  const paneWidth=windowWidth/4;
  for(let i=0;i<4;i++) {
    const x=-windowWidth/2+paneWidth*(i+.5);
    box(paneWidth-.035,windowHeight-.04,.035,glass,x,windowBottom+windowHeight/2,backWallZ,walls.back,0);
    box(.035,windowHeight,.07,steel,x-paneWidth/2,windowBottom+windowHeight/2,LAYOUT.back+.05,walls.back,0);
  }
  box(.035,windowHeight,.07,steel,windowWidth/2,windowBottom+windowHeight/2,LAYOUT.back+.05,walls.back,0);
  [windowBottom,windowBottom+windowHeight].forEach(y=>box(windowWidth,.035,.08,steel,0,y,LAYOUT.back+.05,walls.back,0));
  const outsideMap=texture((ctx,w,h)=>{
    const grad=ctx.createLinearGradient(0,0,0,h);grad.addColorStop(0,'#bad5df');grad.addColorStop(.65,'#dde0d5');grad.addColorStop(1,'#a9b7b7');ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);
    for(let i=0;i<8;i++){let x=i*140-30,y=100+random()*150;ctx.fillStyle=['#b6b4ad','#bfc2bd','#a9b5b6'][i%3];ctx.fillRect(x,y,120,h-y);ctx.fillStyle='#849aab';for(let a=0;a<3;a++)for(let b=0;b<3;b++)ctx.fillRect(x+14+a*35,y+24+b*66,19,35);}
  },1024,512);
  const backdrop=new THREE.Mesh(new THREE.PlaneGeometry(windowWidth-.04,windowHeight-.04),new THREE.MeshBasicMaterial({map:outsideMap,transparent:true,opacity:.63}));backdrop.position.set(0,windowBottom+windowHeight/2,LAYOUT.back-.12);walls.back.add(backdrop);
  // Baseboards follow each floor level and stop at the side entrance.
  for(const side of [-1,1]) {
    const wall=walls[side<0?'left':'right'];
    box(.055,.16,upperDepth,white,side*(halfWidth-.08),.15+rise,(LAYOUT.back+LAYOUT.stylingEdge)/2,wall);
    const frontSegments=side<0?[[LAYOUT.stylingEdge+LAYOUT.stepDepth,LAYOUT.front]]:[[LAYOUT.stylingEdge+LAYOUT.stepDepth,LAYOUT.glazing.returnZ]];
    for (const [start,end] of frontSegments) if(end-start>.001)box(.055,.16,end-start,white,side*(halfWidth-.08),.15,(start+end)/2,wall);
  }
  box(LAYOUT.width-.05,.16,.035,white,0,.14+rise,LAYOUT.back+.075,walls.back);

  function chair(x,z,rotation=0,reclined=false,parent=group) {
    const g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=rotation;parent.add(g);
    cyl(.36,.4,.065,darkSteel,0,.12,0,g,40);cyl(.085,.11,.48,steel,0,.38,0,g);cyl(.12,.12,.085,black,0,.25,0,g);
    box(.67,.16,.66,leather,0,.69,0,g,.065);
    const back=box(.66,.64,.15,leather,0,1.03,.28,g,.06);back.rotation.x=reclined?-.4:-.09;
    box(.54,.025,.012,leatherSeam,0,.98,.197,g,.004);
    for(const side of [-1,1]){rod([side*.37,.67,.23],[side*.37,.96,.23],.025,steel,g);rod([side*.37,.73,-.25],[side*.37,.96,-.25],.025,steel,g);box(.12,.1,.67,leather,side*.37,.99,0,g,.042);}
    rod([-.25,.55,-.2],[-.25,.31,-.67],.022,steel,g);rod([.25,.55,-.2],[.25,.31,-.67],.022,steel,g);box(.58,.055,.16,darkSteel,0,.32,-.67,g);
    rod([.15,.27,.04],[.4,.2,.13],.018,steel,g);box(.14,.025,.08,black,.41,.19,.13,g,.01);
    return g;
  }
  const mirrorFaces=[];
  const reflectors=[];
  const mirrorMap=texture((ctx,w,h)=>{const g=ctx.createLinearGradient(0,0,w,h);g.addColorStop(0,'#9fb4c1');g.addColorStop(.4,'#d8e0df');g.addColorStop(.41,'#c7d2d3');g.addColorStop(1,'#6c828e');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);ctx.fillStyle='#edf2ee';ctx.globalAlpha=.7;ctx.fillRect(w*.15,h*.2,w*.7,10);ctx.globalAlpha=.35;ctx.fillStyle='#344954';ctx.fillRect(w*.2,h*.74,w*.6,h*.25);},512,512);
  const mirrorMat=new THREE.MeshStandardMaterial({color:'#c2d1da',map:mirrorMap,metalness:.8,roughness:.1});
  function bottle(x,y,z,color,parent=group,size=1,pump=false) {
    const m=mat(color,.3);cyl(.045*size,.047*size,.19*size,m,x,y+.095*size,z,parent,12);
    cyl(.024*size,.024*size,.037*size,black,x,y+.207*size,z,parent,10);
    if(pump){box(.075*size,.018*size,.025*size,black,x+.012*size,y+.234*size,z,parent,.004);}
    box(.063*size,.073*size,.004,white,x,y+.11*size,z+.046*size,parent,.003);
  }
  function scissors(x,y,z,parent=group) {
    const g=new THREE.Group();g.position.set(x,y,z);parent.add(g);
    const a=torus(.034,.006,steel,-.036,.01,0,g);a.rotation.x=Math.PI/2;
    const b=torus(.032,.006,steel,.036,.01,0,g);b.rotation.x=Math.PI/2;
    rod([-.037,.01,-.03],[.045,.01,-.23],.006,steel,g);rod([.035,.012,-.03],[-.025,.012,-.22],.006,steel,g);
  }
  for(const side of [-1,1]) {
    const sideWall=stylingWalls[side<0?'left':'right'];
    box(.57,.83,5.86,cabinet,side*(halfWidth-.34),.48,-1.08,stylingFloor);
    box(.67,.085,6.02,counterMat,side*(halfWidth-.39),.94,-1.08,stylingFloor);
    for(let i=0;i<4;i++){
      const z=LAYOUT.styling.z[i];
      const station=new THREE.Group();station.position.set(side*(halfWidth-.11),0,z);station.rotation.y=side<0?Math.PI/2:-Math.PI/2;sideWall.add(station);
      const face=new THREE.Mesh(new THREE.CircleGeometry(.49,64),mirrorMat);face.position.set(0,1.83,.03);station.add(face);mirrorFaces.push(face);
      torus(.514,.025,glow,0,1.83,.006,station);
      const halo=new THREE.Mesh(new THREE.CircleGeometry(.575,64),new THREE.MeshBasicMaterial({color:'#d7ecff',transparent:true,opacity:.13}));halo.position.set(0,1.83,-.007);station.add(halo);
      box(.027,1.93,.022,white,-.76,1.83,-.005,station,.004);
      for(const dz of [-.37,.37]) {
        box(.025,.64,.71,cabinet,side*(halfWidth-.65),.49,z+dz,stylingFloor);
        rod([side*(halfWidth-.67),.65,z+dz-.23],[side*(halfWidth-.67),.44,z+dz-.23],.015,steel,stylingFloor);
      }
      chair(side*LAYOUT.styling.chairX,z,side<0?Math.PI/2:-Math.PI/2,false,stylingFloor);
      bottle(side*(halfWidth-.34),1.0,z-.55,['#ecf0e8','#995758','#799896','#dab895'][i],stylingFloor);
      bottle(side*(halfWidth-.32),1.0,z-.4,'#292e34',stylingFloor,.75,true);
      if(i===1 || i===3) scissors(side*(halfWidth-.50),1.002,z+.38,stylingFloor);
      box(.07,.015,.24,black,side*(halfWidth-.51),1.005,z+.1,stylingFloor,.003);
      for(let k=0;k<9;k++) box(.055,.012,.007,black,side*(halfWidth-.465),1.009,z+.01+k*.024,stylingFloor,.002);
      // Small wall sockets.
      box(.026,.11,.13,white,side*(halfWidth-.11),1.18,z+.65,sideWall,.012);
    }
  }
  // One reflection pass per wall serves all four round mirrors. Reflections of
  // the opposite mirror use the underlying material, avoiding recursive passes.
  for (const side of quality.compact?[]:[-1, 1]) {
    const discs = Array.from({length: 4}, (_, i) => new THREE.CircleGeometry(.49, 48).translate(side * LAYOUT.styling.z[i], 0, 0));
    const mirror = new Reflector(mergeGeometries(discs), { color: 0xa3aab1, textureWidth: 512, textureHeight: 512, clipBias: .003, multisample: 0 });
    discs.forEach(geometry => geometry.dispose());
    mirror.position.set(side * (halfWidth-.15), 1.83, 0);
    mirror.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    stylingWalls[side < 0 ? 'left' : 'right'].add(mirror);
    const reflect = mirror.onBeforeRender;
    mirror.onBeforeRender = function(...args) {
      const previous = reflectors.map(item => item.visible);
      reflectors.forEach(item => item.visible = false);
      reflect.apply(this, args);
      reflectors.forEach((item, i) => item.visible = previous[i]);
    };
    reflectors.push(mirror);
  }
  function trolley(x,z){
    const g=new THREE.Group();g.position.set(x,0,z);group.add(g);
    for(const a of [-.21,.21])for(const b of [-.19,.19]){sphere(.045,.048,.03,black,a,.12,b,g);rod([a,.14,b],[a,.91,b],.016,darkSteel,g);}
    for(let i=0;i<4;i++)box(.48,.065,.45,black,0,.28+i*.19,0,g,.02);
    box(.53,.065,.49,cabinet,0,1.04,0,g,.02);
    bottle(-.1,1.08,-.08,'#b8c6c0',g,.7,true);scissors(.07,1.078,.03,g);
    return g;
  }
  for(const z of [-2.475,.425]){const cart=trolley(-1.55,z);cart.scale.set(.78,.9,.78);stylingFloor.add(cart);}
  // Transverse colour bar faces the styling floor, leaving only the side stair open.
  const shelf=new THREE.Group();shelf.position.set(LAYOUT.colour.x,0,LAYOUT.colour.z);shelf.rotation.y=Math.PI;group.add(shelf);
  const towelMats=['#477e99','#697583','#8e969f'].map(c=>mat(c,.96));
  const colourWidth=LAYOUT.colour.width, colourDepth=LAYOUT.colour.depth;
  // Open through-cubbies: no backing panel on either the lower counter or tower.
  const bayCount=5, bayWidth=(colourWidth-.06)/bayCount, shelfLeft=-colourWidth/2+.025;
  for(const y of [.14,.75,1.36])box(colourWidth,.05,colourDepth+.04,cabinet,0,y,0,shelf,.006);
  for(let i=0;i<=bayCount;i++) {
    const x=shelfLeft+i*bayWidth;
    box(.045,1.25,colourDepth+.04,cabinet,x,.75,0,shelf,.005);
    box(.07,.06,colourDepth-.08,black,x,.0875,0,shelf,.005);
  }
  const towerX=shelfLeft+(bayCount-.5)*bayWidth;
  for(const x of [towerX-bayWidth/2,towerX+bayWidth/2])box(.045,.6,colourDepth+.04,cabinet,x,1.66,0,shelf,.005);
  for(const y of [1.65,1.96])box(bayWidth+.045,.045,colourDepth+.04,cabinet,towerX,y,0,shelf,.005);
  // Leave open pockets so both faces and the room beyond remain visible.
  for(let bayIndex=0;bayIndex<2;bayIndex++)for(let row=0;row<2;row++)for(let col=0;col<3;col++) {
    const x=shelfLeft+.13+bayIndex*bayWidth+col*.19,y=.255+row*.18;
    const t=cyl(.082,.082,.34,towelMats[(col+row)%3],x,y,0,shelf,16);t.rotation.x=Math.PI/2;
    for(const side of [-1,1])torus(.052,.008,towelMats[(col+row+1)%3],x,y,side*.175,shelf);
  }
  for(const x of [shelfLeft+.23,shelfLeft+bayWidth+.22])for(let row=0;row<3;row++)box(.32,.10,.34,towelMats[row%3],x,.825+row*.103,.005,shelf,.023);
  for(const x of [-.14,.08,.3])bottle(x,.78,-.04,'#dfe1df',shelf,1.05,true);
  for(let row=0;row<3;row++)for(let col=0;col<4;col++) {
    const x=towerX-bayWidth/2+.13+col*.13,y=.23+row*.145;
    box(.108,.125,.28,white,x,y,0,shelf,.003);
    for(const side of [-1,1])box(.094,.035,.004,mat(['#c194a4','#8e6a81','#baa28e'][col%3],.8),x,y+.015,side*.142,shelf,.001);
  }
  for(const x of [towerX-.19,towerX+.05])bottle(x,.78,-.045,'#dfe1df',shelf,1.1,true);
  for(const x of [towerX-.17,towerX+.13])bottle(x,1.675,0,'#292e34',shelf,.85);
  for(const x of [-.9,-.25]) {
    box(.59,.12,.26,blue,x,1.445,0,shelf,.009);
    box(.52,.025,.2,white,x,1.52,0,shelf,.004);
  }
  cyl(.12,.075,.085,black,.43,1.427,0,shelf,24);
  bottle(.77,1.39,0,'#e1e4dd',shelf,.9,true);

  // Compact integrated shampoo couches: black oval upholstery, ivory trim,
  // a bowl embedded at the head, a black pedestal and an angled white foot support.
  for(const z of LAYOUT.wash.z){
    const g=new THREE.Group();g.position.set(LAYOUT.wash.x,0,z);g.rotation.y=Math.PI/2;group.add(g);
    const footZ=LAYOUT.wash.footEndX-LAYOUT.wash.x;
    box(.88,.14,.44-footZ,ceramic,0,.68,(.44+footZ)/2,g,.10);
    const headShell=cyl(.44,.44,.14,ceramic,0,.68,.70,g,48);headShell.scale.z=.36/.44;
    box(.93,.24,.38-footZ,leather,0,.84,(.38+footZ)/2,g,.115);
    // A real cut-out leaves the bowl hollow instead of filling it with upholstery.
    const surroundShape=new THREE.Shape();surroundShape.absellipse(0,0,.465,.385,0,Math.PI*2,false);
    const bowlOpening=new THREE.Path();bowlOpening.absellipse(0,0,.405,.34,0,Math.PI*2,true);surroundShape.holes.push(bowlOpening);
    const surroundGeometry=new THREE.ExtrudeGeometry(surroundShape,{depth:.24,bevelEnabled:false,curveSegments:40});surroundGeometry.rotateX(-Math.PI/2);
    const surround=new THREE.Mesh(surroundGeometry,leather);surround.position.set(0,.72,.70);surround.castShadow=true;surround.receiveShadow=true;g.add(surround);
    // Broad black column sits directly beneath the basin; the rear support is a tapered ivory wedge.
    cyl(.27,.32,.59,black,0,.355,.67,g,32);
    cyl(.32,.34,.055,darkSteel,0,.0875,.67,g,32);
    const pedestal=cyl(.24,.37,.58,ceramic,0,.35,footZ+.63,g,4);pedestal.rotation.y=Math.PI/4;pedestal.scale.z=1.5;
    const padDepth=.30-footZ;
    const pad=box(.74,.13,padDepth,leather,0,.965,(footZ+.30)/2,g,.07);pad.rotation.x=-.055;
    for(const dz of [footZ+.43,footZ+.96])box(.65,.013,.018,leatherSeam,0,.997,dz,g,.005);
    for(const side of [-1,1])box(.14,.13,.54,leather,side*.40,1.04,-.35,g,.06);
    // Shallow oval ceramic basin with an open glazed interior.
    const profile=[new THREE.Vector2(0,0),new THREE.Vector2(.23,0),new THREE.Vector2(.38,.08),new THREE.Vector2(.43,.19),new THREE.Vector2(.43,.23),new THREE.Vector2(.395,.245),new THREE.Vector2(.365,.19),new THREE.Vector2(.27,.075),new THREE.Vector2(.055,.045),new THREE.Vector2(0,.045)];
    const basin=new THREE.Mesh(new THREE.LatheGeometry(profile,48),ceramic);basin.position.set(0,.84,.70);basin.scale.z=.86;basin.castShadow=true;basin.receiveShadow=true;g.add(basin);
    cyl(.035,.035,.009,steel,0,.895,.70,g);
    box(.21,.055,.13,black,0,1.076,.365,g,.023);
    rod([.22,1.04,.85],[.22,1.17,.85],.018,steel,g);rod([.22,1.17,.85],[.15,1.17,.79],.018,steel,g);
    sphere(.026,.04,.026,steel,-.20,1.076,.81,g);
  }
  // Toilet sits between the reception's staff gap and the wash divider.
  const wc=LAYOUT.toilet, wcWidth=wc.maxX-wc.minX, wcDepth=wc.maxZ-wc.minZ;
  const wcX=(wc.minX+wc.maxX)/2, wcZ=(wc.minZ+wc.maxZ)/2;
  const wcHeight=wallHeight-.06, wcWallY=.06+wcHeight/2;
  const toiletRoom=new THREE.Group();group.add(toiletRoom);
  box(wcWidth,wcHeight,.1,ivory,wcX,wcWallY,wc.minZ,toiletRoom);
  box(.1,wcHeight,wcDepth,ivory,wc.minX,wcWallY,wcZ,toiletRoom);
  // White flush door, visible from the aisle, with inset panels and a chrome lever.
  const doorZ=wcZ, doorWidth=.72;
  for(const [start,end] of [[wc.minZ,doorZ-doorWidth/2],[doorZ+doorWidth/2,wc.maxZ]])box(.1,wcHeight,end-start,ivory,wc.maxX,wcWallY,(start+end)/2,toiletRoom);
  box(.1,wallHeight-2.2,doorWidth,ivory,wc.maxX,(wallHeight+2.2)/2,doorZ,toiletRoom);
  box(.065,2.12,doorWidth-.04,white,wc.maxX+.02,1.14,doorZ,toiletRoom,.008);
  for(const z of [doorZ-doorWidth/2,doorZ+doorWidth/2])box(.14,2.22,.065,white,wc.maxX+.035,1.17,z,toiletRoom,.007);
  box(.14,.065,doorWidth+.09,white,wc.maxX+.035,2.28,doorZ,toiletRoom,.007);
  for(const y of [.62,1.6])box(.018,.76,.52,ceramic,wc.maxX+.06,y,doorZ,toiletRoom,.006);
  rod([wc.maxX+.08,1.04,doorZ+.27],[wc.maxX+.16,1.04,doorZ+.27],.018,steel,toiletRoom);
  rod([wc.maxX+.16,1.04,doorZ+.27],[wc.maxX+.16,1.04,doorZ+.11],.018,steel,toiletRoom);
  const wcSign=texture((ctx,w,h)=>{ctx.fillStyle='#e9ece8';ctx.fillRect(0,0,w,h);ctx.fillStyle='#465463';ctx.textAlign='center';ctx.font='52px sans-serif';ctx.fillText('WC',w/2,73);},256,128);
  const wcPlate=new THREE.Mesh(new THREE.PlaneGeometry(.22,.11),new THREE.MeshBasicMaterial({map:wcSign}));wcPlate.rotation.y=Math.PI/2;wcPlate.position.set(wc.maxX+.073,1.87,doorZ);toiletRoom.add(wcPlate);
  // Roofless miniature reveals just enough detail to identify the small room.
  box(.47,.65,.18,ceramic,wc.minX+.35,.435,wcZ-.35,toiletRoom,.065);
  sphere(.23,.13,.29,ceramic,wc.minX+.35,.46,wcZ-.03,toiletRoom);
  const seatRing=torus(.17,.03,white,wc.minX+.35,.57,wcZ+.01,toiletRoom);seatRing.rotation.x=Math.PI/2;seatRing.scale.y=1.25;
  box(.30,.13,.25,ceramic,wc.maxX-.22,.86,wc.maxZ-.20,toiletRoom,.055);
  rod([wc.maxX-.22,.93,wc.maxZ-.27],[wc.maxX-.22,1.09,wc.maxZ-.27],.018,steel,toiletRoom);
  const toiletCeiling=box(wcWidth,.09,wcDepth,white,wcX,wallHeight-.045,wcZ,toiletRoom,0);
  // One uninterrupted flat white wall: no overlapping seams or projecting return.
  const privacy=LAYOUT.privacyWall;
  box(privacy.maxX-privacy.minX,wcHeight,.10,ivory,(privacy.maxX+privacy.minX)/2,wcWallY,privacy.z,group,0);

  // A small sink sits beside the WC, with both fronts facing the +X aisle.
  const utility=LAYOUT.utility, sinkX=(utility.minX+utility.maxX)/2, sinkZ=(utility.minZ+utility.maxZ)/2;
  const sinkWidth=utility.maxZ-utility.minZ, sinkDepth=utility.maxX-utility.minX;
  const sinkUnit=new THREE.Group();sinkUnit.position.set(sinkX,0,sinkZ);sinkUnit.rotation.y=Math.PI/2;group.add(sinkUnit);
  box(sinkWidth-.14,.045,sinkDepth-.12,cabinet,0,.0825,0,sinkUnit,.008);
  box(sinkWidth-.04,.055,sinkDepth-.04,white,0,.1125,0,sinkUnit,.008);
  for(const side of [-1,1])box(.045,.75,sinkDepth-.04,white,side*(sinkWidth/2-.04),.49,0,sinkUnit,.008);
  for(const side of [-1,1])box(sinkWidth-.06,.75,.035,white,0,.49,side*(sinkDepth/2-.035),sinkUnit,.008);
  box(.015,.69,.014,cabinet,0,.48,sinkDepth/2-.012,sinkUnit,.002);
  for(const x of [-.07,.07])rod([x,.68,sinkDepth/2+.018],[x,.79,sinkDepth/2+.018],.012,steel,sinkUnit);
  for(const side of [-1,1]) {
    box(sinkWidth,.055,(sinkDepth-.32)/2,ceramic,0,.895,side*(.16+(sinkDepth-.32)/4),sinkUnit,.008);
    box((sinkWidth-.36)/2,.055,.32,ceramic,side*(.18+(sinkWidth-.36)/4),.895,0,sinkUnit,.008);
  }
  const sinkProfile=[new THREE.Vector2(0,0),new THREE.Vector2(.18,0),new THREE.Vector2(.265,.14),new THREE.Vector2(.29,.22),new THREE.Vector2(.29,.25),new THREE.Vector2(.265,.25),new THREE.Vector2(.24,.17),new THREE.Vector2(.14,.045),new THREE.Vector2(0,.04)];
  const utilityBowl=new THREE.Mesh(new THREE.LatheGeometry(sinkProfile,36),ceramic);utilityBowl.position.set(0,.68,0);utilityBowl.scale.set(.68,1,.62);utilityBowl.castShadow=true;utilityBowl.receiveShadow=true;sinkUnit.add(utilityBowl);
  cyl(.025,.025,.009,steel,0,.725,0,sinkUnit,16);
  rod([0,.94,-.235],[0,1.13,-.235],.018,steel,sinkUnit);rod([0,1.13,-.235],[0,1.13,-.055],.018,steel,sinkUnit);
  bottle(.17,.925,-.22,'#e1e4dd',sinkUnit,.6,true);
  // Transverse black fins end at the same service/aisle boundary as the colour bar.
  const divider=LAYOUT.screen, dividerWidth=divider.maxX-divider.minX;
  for(let i=0;i<=28;i++)box(.065,1.56,.09,cabinet,divider.minX+i*dividerWidth/28,.85,divider.z);
  box(dividerWidth+.065,.075,.13,cabinet,(divider.minX+divider.maxX)/2,1.655,divider.z);
  const returnDepth=divider.returnDepth, returnX=divider.maxX-.055;
  for(let i=0;i<=5;i++)box(.11,1.56,.065,cabinet,returnX,.85,divider.z-i*returnDepth/5);
  for(const [y,height] of [[.16,.18],[1.655,.075]])box(.11,height,returnDepth+.065,cabinet,returnX,y,divider.z-returnDepth/2);
  box(dividerWidth+.065,.18,.13,cabinet,(divider.minX+divider.maxX)/2,.16,divider.z);
  // The actual ink artwork is sampled from the source photo on the wall, without invented text.
  const muralPhoto=new THREE.TextureLoader().load('__PHOTO_3__',requestRender);muralPhoto.colorSpace=THREE.SRGBColorSpace;
  const muralGeo=new THREE.PlaneGeometry(2.7,1.62);
  const uvs=muralGeo.attributes.uv;
  uvs.setXY(0,.50,.85);uvs.setXY(1,.813,.63);uvs.setXY(2,.365,.46);uvs.setXY(3,.787,.115);
  const muralMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{photo:{value:muralPhoto}},vertexShader:'varying vec2 vUv; varying vec2 vLocal; void main(){vUv=uv;vLocal=vec2(position.x/2.7+.5,position.y/1.62+.5);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'uniform sampler2D photo; varying vec2 vUv; varying vec2 vLocal; void main(){vec3 c=texture2D(photo,vUv).rgb;float v=dot(c,vec3(.299,.587,.114));float a=1.0-smoothstep(.16,.31,v);a*=smoothstep(.02,.05,vLocal.y)*(1.0-smoothstep(.89,.92,vLocal.y));if(vLocal.x>.76 && vLocal.y<.29)a=0.0;if(vLocal.x>.91 && vLocal.y<.46)a=0.0;gl_FragColor=vec4(vec3(.018,.022,.024),a*.93);}'});
  const mural=new THREE.Mesh(muralGeo,muralMat);mural.rotation.y=Math.PI/2;mural.position.set(-halfWidth+.075,2.05,3.75);walls.left.add(mural);

  // Reception: white vertical ribs over dark narrow grooves, as in the entrance photo.
  const desk=new THREE.Group();desk.position.set(LAYOUT.desk.x,0,LAYOUT.desk.z);desk.rotation.y=Math.PI/2;group.add(desk);
  const deskDepth=LAYOUT.desk.depth, deskFace=(deskDepth-.13)/2;
  box(LAYOUT.desk.width-.12,1.04,deskDepth-.13,cabinet,0,.61,0,desk,.035);
  box(LAYOUT.desk.width,.045,deskDepth,white,0,1.135,0,desk,.018);
  box(LAYOUT.desk.width,.045,deskDepth,counterMat,0,1.1775,0,desk,.018);
  const deskRibCount=27, deskRibStep=(LAYOUT.desk.width-.12)/deskRibCount;
  for(let i=0;i<deskRibCount;i++)box(deskRibStep*.64,.91,.035,white,-(LAYOUT.desk.width-.12)/2+deskRibStep*(i+.5),.61,deskFace+.018,desk,.006);
  const signMap=texture((ctx,w,h)=>{ctx.clearRect(0,0,w,h);ctx.textAlign='center';ctx.fillStyle='#f6f4e9';ctx.font='italic 145px Georgia';ctx.fillText('Harbour',w/2,160);ctx.font='italic 128px Georgia';ctx.fillText('Hair',w/2,290);ctx.font='28px sans-serif';ctx.fillText('H A R B O U R   H A I R',w/2,366);},1024,420);
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(LAYOUT.desk.width-.22,.6),new THREE.MeshBasicMaterial({map:signMap,transparent:true}));sign.position.set(0,.65,deskFace+.042);desk.add(sign);
  const ipad=box(.32,.22,.026,black,-.40,1.3,0,desk,.02);ipad.rotation.x=-.3;
  const screen=box(.28,.176,.003,blue,-.40,1.3,.018,desk,.008);screen.rotation.x=-.3;
  box(.12,.035,.16,steel,-.40,1.215,-.01,desk);
  box(.31,.04,.23,white,.32,1.225,.12,desk,.01);
  // A tiny maneki-neko echoes the ornament visible in the reception photograph.
  const cat=new THREE.Group();cat.position.set(.54,1.23,-.13);desk.add(cat);
  sphere(.085,.105,.072,ceramic,0,.10,0,cat);sphere(.07,.062,.059,ceramic,0,.22,0,cat);
  for(const s of [-1,1]){const ear=new THREE.Mesh(new THREE.ConeGeometry(.026,.06,3),ceramic);ear.position.set(s*.046,.277,0);cat.add(ear);sphere(.008,.011,.006,black,s*.026,.23,.054,cat);}
  sphere(.028,.06,.029,ceramic,-.084,.21,0,cat);torus(.04,.009,mat('#b9453b',.5),0,.16,.056,cat);
  // The entrance mat faces the counter across the unobstructed right aisle.
  const entryMat = new THREE.Group();entryMat.position.set(LAYOUT.entrance.x-.63,0,LAYOUT.entrance.z);entryMat.rotation.y=Math.PI/2;group.add(entryMat);
  const welcomeMat=mat('#263746',.97);box(1.34,.025,.73,welcomeMat,0,.084,0,entryMat,.035);
  const matText=texture((ctx,w,h)=>{ctx.clearRect(0,0,w,h);ctx.fillStyle='#dbddd3';ctx.textAlign='center';ctx.font='38px sans-serif';ctx.fillText('welcome / 歡迎',w/2,75);},512,128);
  const welcomeText=new THREE.Mesh(new THREE.PlaneGeometry(1.18,.3),new THREE.MeshBasicMaterial({map:matText,transparent:true}));welcomeText.rotation.x=-Math.PI/2;welcomeText.position.set(0,.101,0);entryMat.add(welcomeText);

  function plant(x,y,z,size=1,parent=group) {
    const g=new THREE.Group();g.position.set(x,y,z);g.scale.setScalar(size);parent.add(g);
    cyl(.18,.135,.29,ceramic,0,.15,0,g,24);cyl(.152,.152,.013,mat('#3d352c',1),0,.299,0,g,20);
    const leaves=[mat('#254b3f',.76),mat('#426e4e',.75),mat('#597c4c',.82)];
    for(let i=0;i<9;i++){
      const a=i*2.4, r=.16+(i%3)*.05, height=.56+(i%4)*.14;
      const end=[Math.cos(a)*r,height,Math.sin(a)*r];rod([0,.29,0],end,.008,leaves[0],g);
      const leaf=sphere(.065,.20,.022,leaves[i%3],end[0]*1.25,height+.04,end[2]*1.25,g);leaf.rotation.z=-Math.cos(a)*.65;leaf.rotation.x=Math.sin(a)*.65;leaf.rotation.y=-a;
    }
  }
  plant(-2.11,.07,-3.87,.68,stylingFloor);plant(2.11,.07,-3.87,.64,stylingFloor);plant(towerX,1.99,.01,.52,shelf);plant(-.58,1.21,.04,.40,desk);
  // Window-side hood / digital perm machines with bent chrome stems and cords.
  for(const [x,z] of [[-.55,-3.65],[.55,-3.65]]) {
    const g=new THREE.Group();g.position.set(x,0,z);stylingFloor.add(g);
    for(let k=0;k<5;k++){const a=k*Math.PI*2/5;rod([0,.15,0],[Math.cos(a)*.34,.11,Math.sin(a)*.34],.025,steel,g);sphere(.04,.04,.04,black,Math.cos(a)*.34,.09,Math.sin(a)*.34,g);}
    rod([0,.16,0],[0,1.37,0],.035,steel,g);rod([0,1.37,0],[.12,1.92,-.12],.045,black,g);
    const hood=sphere(.23,.18,.25,black,.16,1.96,-.18,g);hood.rotation.x=.5;
    for(let k=0;k<5;k++) {
      const a=k*1.25;const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(.15+Math.cos(a)*.17,1.97,-.18+Math.sin(a)*.18),new THREE.Vector3(.27+Math.cos(a)*.26,1.53,-.12+Math.sin(a)*.27),new THREE.Vector3(.14+Math.cos(a)*.2,1.15,Math.sin(a)*.18)]);
      const cord=new THREE.Mesh(new THREE.TubeGeometry(curve,12,.007,5,false),black);g.add(cord);cyl(.018,.024,.095,black,.14+Math.cos(a)*.2,1.1,Math.sin(a)*.18,g,8);
    }
  }
  // The walk-in ceiling returns when viewing from inside; the miniature remains open.
  const ceiling=new THREE.Group();group.add(ceiling);
  footprintSlab(.08,wallHeight-.01,ivory,0,ceiling);
  for(const x of [-1.5,1.5])for(const z of [-4.5,-2.1,.3,6.6,8.6]) {
    if(x>LAYOUT.receptionMaxX&&z+.85>LAYOUT.receptionStartZ)continue;
    box(.085,.07,1.7,white,x,wallHeight-.11,z,ceiling,.02);box(.067,.025,1.62,glow,x,wallHeight-.155,z,ceiling,.012);
  }
  rod([-.9,wallHeight-.16,1.7],[-.9,wallHeight-.16,5.5],.025,darkSteel,ceiling);
  for(const z of [1.9,2.65,3.4,4.15,4.9,5.4]) {
    rod([-.9,wallHeight-.16,z],[-.9,wallHeight-.31,z],.018,steel,ceiling);
    const spot=cyl(.065,.065,.16,steel,-.9,wallHeight-.36,z,ceiling,16);spot.rotation.z=-.3;
    cyl(.048,.048,.012,glow,-.923,wallHeight-.436,z,ceiling,16);
  }
  const ceilingLights=[];
  for(const z of [-4.8,-1.5,1.8,5.1,8.4]){const p=new THREE.PointLight('#fff1dd',4,8,2);p.position.set(0,wallHeight-.3,z);scene.add(p);ceilingLights.push(p);}
  const ambient=new THREE.HemisphereLight('#deeeff','#89877a',2.1);scene.add(ambient);
  const sun=new THREE.DirectionalLight('#fff0d6',4);sun.position.set(-3,8,-4);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-12;sun.shadow.camera.right=12;sun.shadow.camera.top=12;sun.shadow.camera.bottom=-12;sun.shadow.camera.near=.5;sun.shadow.camera.far=30;sun.shadow.normalBias=.025;sun.shadow.bias=-.0002;sun.shadow.radius=4;scene.add(sun);sun.target.position.set(0,0,.5);scene.add(sun.target);
  const fill=new THREE.DirectionalLight('#bed7f3',1.5);fill.position.set(5,6,8);scene.add(fill);
  // A small plaque on the plinth anchors the model without competing with controls.
  const plaqueMap=texture((ctx,w,h)=>{ctx.clearRect(0,0,w,h);ctx.textAlign='center';ctx.fillStyle='#b9ccda';ctx.font='46px sans-serif';ctx.fillText('HARBOUR HAIR',w/2,66);ctx.fillStyle='#6f93aa';ctx.font='21px sans-serif';ctx.fillText('C E N T R A L   A R C A D E   /   L E E D S',w/2,111);},1024,140);
  const plaque=new THREE.Mesh(new THREE.PlaneGeometry(3.2,.43),new THREE.MeshBasicMaterial({map:plaqueMap,transparent:true}));plaque.position.set(receptionX,-.29,LAYOUT.front+.21);group.add(plaque);

  let mode='dollhouse', zone=null, lightValue=70, labelsVisible=true, tourPlaying=false, tourTimer=null;
  let tween=null, yaw=0, pitch=0, drag=null;
  const batchedParts=batchStaticMeshes(group,[...Object.values(walls),ceiling],[toiletCeiling]);
  const keys=new Set(), touchMoves=new Set();
  const zoneData={
    welcome:{point:[LAYOUT.desk.x,1.6,LAYOUT.desk.z],label:'Welcome in',zh:'接待區',eye:[LAYOUT.entrance.x-.37,1.62,LAYOUT.entrance.z],look:[LAYOUT.desk.x,1.2,LAYOUT.desk.z]},
    styling:{point:[-1.6,2.36,-3.5],label:'The styling floor',zh:'造型區',eye:[.25,1.98,-2.8],look:[-2.35,2.01,-3.55]},
    wash:{point:[LAYOUT.wash.x,1.65,LAYOUT.wash.z[1]],label:'Wash & unwind',zh:'洗髮區',eye:[LAYOUT.aisleMinX+.5,1.62,LAYOUT.wash.z[1]],look:[LAYOUT.wash.x,1.05,LAYOUT.wash.z[1]]},
    colour:{point:[LAYOUT.colour.x,1.9,LAYOUT.colour.z],label:'Colour corner',zh:'染髮區',eye:[.3,1.98,-1.1],look:[-.25,1.32,LAYOUT.colour.z]},
  };
  const labelRoot=document.getElementById('hotspots');
  const labels=Object.entries(zoneData).map(([key,data])=>{
    const el=document.createElement('button');el.type='button';el.setAttribute('aria-label',`Visit ${data.label}`);el.className='absolute pointer-events-auto flex items-center gap-2 rounded-full border border-white/20 bg-[#102331]/90 px-3 py-2 text-[11px] text-white shadow-lg transition-colors hover:bg-[#174F7F] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-300';
    el.innerHTML=`<span class="h-1.5 w-1.5 rounded-full bg-sky-200 shadow-[0_0_8px_#7dd3fc]"></span><span>${data.label}</span>`;
    el.addEventListener('click',()=>{stopTour();visit(key);});labelRoot.appendChild(el);return{key,el,point:new THREE.Vector3(...data.point)};
  });
  const state=()=>emit('state',{mode,zone,light:lightValue,tour:tourPlaying});
  function size(){
    const {width,height}=canvas.getBoundingClientRect();if(!width||!height)return;
    renderer.setPixelRatio(pixelRatioFor(width,height,devicePixelRatio,quality));renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
    if(mode==='dollhouse'&&!zone) home(false);
    if(mode==='plan') plan(false);
    requestRender();
  }
  function animateCamera(pos,target,duration=1100){
    tween={from:camera.position.clone(),to:new THREE.Vector3(...pos),fromTarget:controls.target.clone(),target:new THREE.Vector3(...target),start:performance.now(),duration:reducedMotion?0:duration};
    requestRender();
  }
  function fitCamera(direction, target, animate) {
    const rect = canvas.getBoundingClientRect();
    const desktop = rect.width > 900;
    const short = rect.height < 500;
    const availableWidth = rect.width - (desktop&&!short ? 520 : 28);
    const availableHeight = Math.max(80,rect.height - (short ? 120 : desktop ? 225 : 310));
    const centerX = rect.width / 2 + (desktop ? 6 : 0);
    const centerY = (short ? 56 : desktop ? 80 : 142) + availableHeight / 2;
    camera.clearViewOffset();
    const aim = new THREE.Vector3(...target);
    const dir = new THREE.Vector3(...direction).normalize();
    const corners = [];
    for (const x of [-halfWidth-.25, LAYOUT.glazing.outerX+.2]) for (const y of [-.5, wallHeight+.05]) for (const z of [LAYOUT.back-.3, LAYOUT.front+.3]) corners.push(new THREE.Vector3(x,y,z));
    const probe = camera.clone();
    let distance = 12;
    for (let i = 0; i < 80; i++) {
      probe.position.copy(aim).addScaledVector(dir, distance);probe.lookAt(aim);probe.updateMatrixWorld();
      const points = corners.map(point => point.clone().project(probe));
      const width = (Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)))*rect.width/2;
      const height = (Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y)))*rect.height/2;
      if (width <= availableWidth && height <= availableHeight) break;
      distance *= 1.035;
    }
    controls.maxDistance = Math.max(32, distance * 1.6);
    camera.setViewOffset(rect.width, rect.height, rect.width/2-centerX, rect.height/2-centerY, rect.width, rect.height);
    const pos = aim.clone().addScaledVector(dir, distance);
    if (animate) animateCamera(pos.toArray(), target);
    else { tween=null;camera.position.copy(pos);controls.target.copy(aim);camera.lookAt(aim); }
  }
  function home(animate=true){fitCamera([13,13.2,17],[0,1,LAYOUT.center],animate);}
  function plan(animate=true){fitCamera([0,1,.0001],[0,0,LAYOUT.center],animate);}
  function stopTour(){if(tourTimer)clearTimeout(tourTimer);tourTimer=null;tourPlaying=false;state();}
  function setLookFromTarget(target){const dir=new THREE.Vector3(...target).sub(camera.position).normalize();yaw=Math.atan2(-dir.x,-dir.z);pitch=Math.asin(clamp(dir.y,-1,1));}
  function setMode(next,notify=true){
    mode=next;controls.mouseButtons.LEFT=mode==='plan'?THREE.MOUSE.PAN:THREE.MOUSE.ROTATE;controls.touches.ONE=mode==='plan'?THREE.TOUCH.PAN:THREE.TOUCH.ROTATE;keys.clear();touchMoves.clear();tween=null;controls.enabled=mode!=='walk';controls.enableRotate=mode==='dollhouse';controls.enablePan=mode!=='walk';
    if(mode==='walk'){
      const d=zone?zoneData[zone]:zoneData.welcome;camera.clearViewOffset();camera.position.set(...d.eye);camera.position.y=LAYOUT.eyeHeight+floorHeightAt(camera.position.x,camera.position.z);setLookFromTarget(d.look);camera.fov=68;camera.updateProjectionMatrix();
    }else{camera.fov=39;camera.updateProjectionMatrix();if(mode==='plan')plan();else{zone=null;home();}}
    canvas.style.cursor=mode==='walk'?'grab':'grab';
    requestRender();
    if(notify)state();
  }
  function visit(key){
    if(!zoneData[key])return;zone=key;
    const d=zoneData[key];
    if(mode==='walk'){camera.position.set(...d.eye);camera.position.y=LAYOUT.eyeHeight+floorHeightAt(camera.position.x,camera.position.z);setLookFromTarget(d.look);tween=null;}
    else {mode='dollhouse';controls.mouseButtons.LEFT=THREE.MOUSE.ROTATE;controls.touches.ONE=THREE.TOUCH.ROTATE;controls.enabled=true;controls.enableRotate=true;const p=d.point;const scale=innerWidth<900?1.3:1;if(key==='colour')animateCamera([7*scale,9*scale,-7*scale],[0,1,LAYOUT.colour.z+1.4]);else animateCamera([p[0]+6*scale,7.4*scale,p[2]+7.7*scale],[p[0]*.5,.85,p[2]*.5]);}
    state();
    requestRender();
  }
  function daylight(value){
    lightValue=clamp(Number(value),0,100);
    const t=lightValue/100;
    // Slider progresses from intimate evening through warm afternoon to clear daylight.
    sun.color.set(t<.5?'#ffbe7a':'#fff3df');sun.intensity=.3+t*3.8;
    sun.position.set(-6+12*t,4.5+t*5,-4+7*(1-t));
    ambient.intensity=.52+t*1.8;ambient.color.set(t<.35?'#7c97c0':'#deeeff');
    fill.intensity=.55+t*.7;glow.emissiveIntensity=2.8+(1-t)*1.8;
    ceilingLights.forEach(p=>{p.intensity=3+(1-t)*8;p.color.set(t<.5?'#ffd8a6':'#fff1dd');});
    renderer.toneMappingExposure=.86+t*.28;scene.environmentIntensity=.24+t*.2;
    renderer.shadowMap.needsUpdate=true;
    requestRender();
    state();
  }
  function finish({surface,value}){
    if(surface==='floor'){
      floorMat.map=value==='oak'?oakMap:value==='stone'?null:stoneMap;
      floorMat.color.set(value==='stone'?'#f2ead8':value==='oak'?'#ffffff':'#c4d0d8');
      floorMat.roughness=value==='original'?.27:.68;floorMat.metalness=value==='original'?.18:0;floorMat.needsUpdate=true;
    }
    if(surface==='walls')wallMaterials.forEach(m=>m.color.set(value==='warm'?'#d9c7ac':value==='blue'?'#9fbbcc':'#ebe7de'));
    if(surface==='chairs')chairMaterials.forEach(m=>m.color.set(value==='tan'?'#b8814d':value==='blue'?'#174f7f':'#1c2429'));
    requestRender();
  }
  listen('mode',({mode:next})=>{stopTour();setMode(next);});listen('zone',({zone:key})=>{stopTour();visit(key);});
  listen('light',({value})=>daylight(value));listen('finish',finish);listen('labels',({visible})=>{labelsVisible=visible;requestRender();});
  listen('reset',()=>{stopTour();zone=null;setMode('dollhouse');daylight(70);['floor','walls','chairs'].forEach(surface=>finish({surface,value:'original'}));labelsVisible=true;state();});
  listen('capture',()=>{renderer.render(scene,camera);emit('captured',{url:canvas.toDataURL('image/png')});});
  listen('move',({direction,active})=>{if(active){if(tourPlaying)stopTour();touchMoves.add(direction);}else touchMoves.delete(direction);requestRender();});
  listen('tour',({playing})=>{
    stopTour();if(!playing)return;tourPlaying=true;setMode('walk',false);let index=0;const steps=['welcome','styling','wash','colour'];
    function next(){if(!tourPlaying)return;visit(steps[index]);index++;if(index<steps.length)tourTimer=setTimeout(next,6500);else tourTimer=setTimeout(stopTour,6500);}
    next();
  });
  function move(dt){
    if(document.querySelector('dialog[open]')){keys.clear();touchMoves.clear();return;}
    let forward=(keys.has('KeyW')||keys.has('ArrowUp')||touchMoves.has('forward')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')||touchMoves.has('back')?1:0);
    let right=(keys.has('KeyD')||keys.has('ArrowRight')||touchMoves.has('right')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')||touchMoves.has('left')?1:0);
    const length=Math.hypot(forward,right)||1;forward/=length;right/=length;
    const speed=dt*1.65;
    const dx=(-Math.sin(yaw)*forward+Math.cos(yaw)*right)*speed,dz=(-Math.cos(yaw)*forward-Math.sin(yaw)*right)*speed;
    if(canWalkAt(camera.position.x+dx,camera.position.z))camera.position.x+=dx;
    if(canWalkAt(camera.position.x,camera.position.z+dz))camera.position.z+=dz;
    const eyeY=LAYOUT.eyeHeight+floorHeightAt(camera.position.x,camera.position.z);
    camera.position.y=THREE.MathUtils.damp(camera.position.y,eyeY,14,dt);
    camera.rotation.order='YXZ';camera.rotation.set(pitch,yaw,0);
  }
  const isUI=target=>target instanceof Element&&!!target.closest('button,input,select,textarea,a,dialog');
  window.addEventListener('keydown',event=>{if(mode!=='walk'||isUI(event.target)||document.querySelector('dialog[open]'))return;if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code)){event.preventDefault();keys.add(event.code);if(tourPlaying)stopTour();requestRender();}if(event.code==='Escape'){stopTour();setMode('dollhouse');}});
  window.addEventListener('keyup',event=>keys.delete(event.code));window.addEventListener('blur',()=>{keys.clear();touchMoves.clear();drag=null;});
  canvas.addEventListener('pointerdown',event=>{if(mode!=='walk')return;if(tourPlaying)stopTour();drag={x:event.clientX,y:event.clientY,id:event.pointerId};canvas.setPointerCapture(event.pointerId);canvas.style.cursor='grabbing';});
  canvas.addEventListener('pointermove',event=>{if(!drag||mode!=='walk')return;yaw-=(event.clientX-drag.x)*.004;pitch=clamp(pitch-(event.clientY-drag.y)*.003,-1.05,1.05);drag.x=event.clientX;drag.y=event.clientY;requestRender();});
  const release=()=>{drag=null;canvas.style.cursor='grab';};canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);
  controls.addEventListener('start',()=>{tween=null;if(tourPlaying)stopTour();});
  controls.addEventListener('change',requestRender);
  const resizeObserver=new ResizeObserver(size);resizeObserver.observe(canvas);
  const projected=new THREE.Vector3();
  const previousPosition=new THREE.Vector3(), previousRotation=new THREE.Quaternion();
  let shadowState='', frameCount=0;
  function paused(){return contextLost||document.hidden||!frameVisible||Boolean(document.querySelector('#photos-dialog[open],#export-dialog[open]'));}
  function requestRender(){
    needsRender=true;
    if(!animationId&&!paused())animationId=requestAnimationFrame(render);
  }
  function render(now){
    animationId=0;
    if(paused())return;
    if(now-lastTime<1000/quality.fps-.5){animationId=requestAnimationFrame(render);return;}
    const dt=Math.min((now-lastTime)/1000,.05);lastTime=now;
    const changing=needsRender||Boolean(tween);needsRender=false;
    previousPosition.copy(camera.position);previousRotation.copy(camera.quaternion);
    if(tween){
      const t=tween.duration===0?1:clamp((now-tween.start)/tween.duration,0,1),ease=1-Math.pow(1-t,3);
      camera.position.lerpVectors(tween.from,tween.to,ease);controls.target.lerpVectors(tween.fromTarget,tween.target,ease);
      if(t===1)tween=null;
    }
    if(mode==='walk')move(dt);else controls.update();
    const moved=previousPosition.distanceToSquared(camera.position)>1e-10||1-Math.abs(previousRotation.dot(camera.quaternion))>1e-10;
    const walking=mode==='walk'&&!document.querySelector('dialog[open]')&&(keys.size>0||touchMoves.size>0||Math.abs(camera.position.y-LAYOUT.eyeHeight-floorHeightAt(camera.position.x,camera.position.z))>.0001);
    if(!changing&&!moved&&!walking)return;
    ceiling.visible=mode==='walk';toiletCeiling.visible=mode==='walk';
    if(mode==='walk')Object.values(walls).forEach(w=>w.visible=true);
    else if(mode==='plan'){Object.values(walls).forEach(w=>w.visible=false);}
    else{
      walls.left.visible=camera.position.x>-.5;walls.right.visible=camera.position.x<.5;
      walls.back.visible=camera.position.z>-.5;walls.front.visible=camera.position.z<.5;
    }
    const nextShadowState=[ceiling.visible,...Object.values(walls).map(w=>w.visible)].join(':');
    if(nextShadowState!==shadowState){renderer.shadowMap.needsUpdate=true;shadowState=nextShadowState;}
    const rect=canvas.getBoundingClientRect();
    labels.forEach(({el,point})=>{
      if(!labelsVisible||mode==='walk'||innerWidth<700){el.style.display='none';return;}
      projected.copy(point).project(camera);const x=(projected.x*.5+.5)*rect.width+rect.left,y=(-projected.y*.5+.5)*rect.height+rect.top;
      el.style.display=projected.z<1&&x>270&&x<innerWidth-245&&y>115&&y<innerHeight-135?'flex':'none';
      el.style.transform=`translate(${x}px,${y}px) translate(-50%,-50%)`;
    });
    renderer.info.reset();renderer.render(scene,camera);frameCount++;
    if(frameCount===1)console.info(`Harbour Hair 3D: ${quality.compact?'compact':'desktop'} / ${quality.fps} fps cap / ${batchedParts} parts batched / ${renderer.info.render.calls} draw calls / ${renderer.info.render.triangles} triangles`);
    if(tween||moved||walking||needsRender)requestRender();
  }
  function resumeOrPause(){
    cancelAnimationFrame(animationId);animationId=0;lastTime=0;
    if(paused()||document.querySelector('dialog[open]')){keys.clear();touchMoves.clear();drag=null;if(tourPlaying)stopTour();}
    if(!paused())requestRender();
  }
  document.addEventListener('visibilitychange',resumeOrPause);
  window.addEventListener('message',event=>{if(event.origin===location.origin&&event.source===window.parent&&event.data?.type==='harbour:visibility'){frameVisible=event.data.visible===true;resumeOrPause();}});
  const dialogsObserver=new MutationObserver(resumeOrPause);
  document.querySelectorAll('dialog').forEach(dialog=>dialogsObserver.observe(dialog,{attributes:true,attributeFilter:['open']}));
  window.addEventListener('pagehide',()=>{cancelAnimationFrame(animationId);animationId=0;});
  window.addEventListener('pageshow',resumeOrPause);
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();contextLost=true;cancelAnimationFrame(animationId);animationId=0;emit('error',{message:'The 3D graphics context was interrupted. Reload this file to reopen the studio.'});});
  size();daylight(70);state();requestRender();emit('ready');
  // A small read-only diagnostic surface for checking the standalone demo.
  window.harbourStudio={getState:()=>({mode,zone,light:lightValue,tour:tourPlaying,position:camera.position.toArray(),drawCalls:renderer.info.render.calls,frames:frameCount,quality:quality.compact?'compact':'desktop'}),renderer};
}
try { start(); } catch(error) { console.error(error);emit('error',{message:'This browser could not start the 3D view. Open this HTML in a recent Chrome, Edge, Safari or Firefox with WebGL enabled. The real salon photos are still available.'}); }

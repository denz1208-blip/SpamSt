// ================= ГЕНЕРАЦИЯ ЭТАЖЕЙ И КОМНАТ =================
const DIRS = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] };
const FLOORS = [
  { name:'Подвал',    rooms:6, bossIdx:0, palette:{floor:'#3d3128',floorAlt:'#372c24',wall:'#5a4636',wallTop:'#6b5442',pit:'#14100e'} },
  { name:'Катакомбы', rooms:7, bossIdx:1, palette:{floor:'#2f2a35',floorAlt:'#292430',wall:'#4a4258',wallTop:'#574e68',pit:'#100d14'} },
  { name:'Чрево',     rooms:8, bossIdx:2, palette:{floor:'#4a2c30',floorAlt:'#432629',wall:'#6e3f44',wallTop:'#7d4a4f',pit:'#1a0d10'} },
];

class Room {
  constructor(floor,x,y,type){
    this.fx=x; this.fy=y; this.type=type; // 'start','normal','treasure','shop','boss','secret'
    this.grid=[]; this.seeded=false; this.cleared=(type!=='normal'&&type!=='boss');
    this.enemies=[]; this.tears=[]; this.pickups=[]; this.rocks=[];
    this.item=null; this.activeGiven=false; this.doorOpen={up:false,down:false,left:false,right:false};
    this.bossSpec=null; this.explored=false; this.spikes=[];
  }
  seed(g){
    if(this.seeded) return; this.seeded=true;
    for(let r=0;r<T.ROWS;r++){ this.grid.push([]); for(let c=0;c<T.COLS;c++) this.grid[r].push('F'); }
    // border walls
    for(let c=0;c<T.COLS;c++){ this.grid[0][c]='W'; this.grid[T.ROWS-1][c]='W'; }
    for(let r=0;r<T.ROWS;r++){ this.grid[r][0]='W'; this.grid[r][T.COLS-1]='W'; }
    // doors carved based on neighbors
    const nb=this.neighbors(g);
    for(const d of ['up','down','left','right']) if(nb[d]){
      if(d==='up')   { this.grid[0][5]='D'; this.grid[0][6]='D'; }
      if(d==='down') { this.grid[T.ROWS-1][5]='D'; this.grid[T.ROWS-1][6]='D'; }
      if(d==='left') { this.grid[3][0]='D'; }
      if(d==='right'){ this.grid[3][T.COLS-1]='D'; }
    }
    if(this.type==='boss'){
      this.bossSpec=BOSSES[g.floorIdx];
      this.cleared=false;
    } else if(this.type==='treasure'||this.type==='start'){
      // empty clean room
    } else if(this.type==='shop'){
      this.stock=[{x:T.wx(3),y:T.wy(2),item:g.rollItem()},{x:T.wx(8),y:T.wy(2),item:g.rollItem()}];
      this.price=3;
    } else if(this.type==='secret'){
      this.item=g.rollItem(); this.pickups.push({kind:'heart',x:T.wx(6),y:T.wy(4)});
    } else {
      // normal combat room: obstacles + enemies
      const obs=2+Math.floor(Math.random()*4);
      for(let i=0;i<obs;i++){
        const c=2+Math.floor(Math.random()*(T.COLS-4)), r=2+Math.floor(Math.random()*(T.ROWS-4));
        if(this.grid[r][c]==='F'){ this.grid[r][c]=Math.random()<0.7?'R':'P'; if(this.grid[r][c]==='P')this.rocks.push([c,r]); }
      }
      if(Math.random()<0.3){ const c=3+Math.floor(Math.random()*6),r=2+Math.floor(Math.random()*3);
        if(this.grid[r][c]==='F'){ this.grid[r][c]='H'; this.spikes.push([c,r]); } }
      const tier=g.floorIdx;
      const pool=['fly','attackfly','spider','gaper','shooter','spitter','charger','lump'];
      const n=2+Math.floor(Math.random()*3)+tier;
      for(let i=0;i<n;i++){
        let t=pool[Math.floor(Math.random()*pool.length)];
        if(t==='lump'&&tier===0&&Math.random()<0.7)t='gaper';
        if((t==='charger')&&tier===0&&Math.random()<0.5)t='gaper';
        let x=T.wx(3+Math.random()*6), y=T.wy(2+Math.random()*3);
        this.enemies.push(new Enemy(t,x,y));
      }
      if(Math.random()<0.5) this.pickups.push({kind:Math.random()<0.5?'coin':(Math.random()<0.5?'heart':'bomb'),x:T.wx(6),y:T.wy(3.5)});
    }
  }
  neighbors(g){
    const o={};
    for(const d in DIRS){ const [dx,dy]=DIRS[d]; const n=g.map.get(`${this.fx+dx},${this.fy+dy}`); o[d]=!!n; }
    return o;
  }
}

function generateFloor(g){
  const cfg=FLOORS[g.floorIdx];
  const map=new Map();
  const target=cfg.rooms;
  function at(x,y){ return map.get(`${x},${y}`); }
  const start=new Room(cfg,startRoomPos(),0,'start');
  map.set(`${start.fx},${start.fy}`,start);
  const frontier=[];
  function addFrontier(room){
    for(const d in DIRS){ const [dx,dy]=DIRS[d];
      if(!at(room.fx+dx,room.fy+dy)) frontier.push([room.fx+dx,room.fy+dy,d]); }
  }
  addFrontier(start);
  let last=start;
  while(map.size<target && frontier.length){
    const idx=Math.floor(Math.random()*frontier.length);
    const [x,y,d]=frontier.splice(idx,1)[0];
    if(at(x,y)) continue;
    // avoid too many adjacencies (loops) sometimes
    let adj=0; for(const dd in DIRS){const [ax,ay]=DIRS[dd]; if(at(x+ax,y+ay))adj++;}
    if(adj>2&&Math.random()<0.7) continue;
    const room=new Room(cfg,x,y,'normal'); map.set(`${x},${y}`,room);
    last=room; addFrontier(room);
  }
  // place boss adjacent to last room
  let bossPlaced=false;
  for(const d in DIRS){ const [dx,dy]=DIRS[d];
    if(!at(last.fx+dx,last.fy+dy)){ const b=new Room(cfg,last.fx+dx,last.fy+dy,'boss'); map.set(`${b.fx},${b.fy}`,b); bossPlaced=true; break; } }
  if(!bossPlaced){ // fallback: extend
    const b=new Room(cfg,last.fx+2,last.fy,'boss'); map.set(`${b.fx},${b.fy}`,b);
    const mid=new Room(cfg,last.fx+1,last.fy,'normal'); map.set(`${mid.fx},${mid.fy}`,mid);
  }
  // treasure room adjacent to some room, not boss/start
  const cells=[...map.values()];
  function tryPlace(type,count){
    let placed=0;
    for(let tries=0;tries<80&&placed<count;tries++){
      const r=cells[Math.floor(Math.random()*cells.length)];
      if(r.type!=='normal')continue;
      for(const d in DIRS){ const [dx,dy]=DIRS[d];
        if(!at(r.fx+dx,r.fy+dy)){ const nr=new Room(cfg,r.fx+dx,r.fy+dy,type); map.set(`${nr.fx},${nr.fy}`,nr); placed++; break; } }
    }
    return placed;
  }
  tryPlace('treasure',1);
  tryPlace('shop',1);
  tryPlace('secret',1);
  g.map=map;
  g.startRoom=start;
}

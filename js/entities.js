// ================= СУЩНОСТИ: ИГРОК, СЛЁЗЫ, ВРАГИ, БОССЫ =================
const T = { // tile helpers (shared with rooms)
  X0:120, Y0:70, TILE:60, COLS:12, ROWS:7,
  wx(c){ return this.X0 + c*this.TILE; },
  wy(r){ return this.Y0 + r*this.TILE; },
};

let nextId = 1;

class Tear {
  constructor(x,y,vx,vy,dmg,opts={}){
    this.x=x; this.y=y; this.vx=vx; this.vy=vy; this.dmg=dmg;
    this.r=opts.r||9; this.range=opts.range||430; this.traveled=0;
    this.dead=false; this.pierce=opts.pierce||0; this.homing=opts.homing||false;
    this.burn=opts.burn||false; this.fromEnemy=!!opts.fromEnemy; this.hitSet=new Set();
    this.life=0;
  }
  update(g){
    this.life++;
    if(this.homing && !this.fromEnemy){
      let best=null,bd=220;
      for(const e of g.room.enemies){ if(e.dead) continue; const d=Math.hypot(e.x-this.x,e.y-this.y); if(d<bd){bd=d;best=e;} }
      if(best){ const ang=Math.atan2(best.y-this.y,best.x-this.x); const cur=Math.atan2(this.vy,this.vx);
        let da=ang-cur; while(da>Math.PI)da-=2*Math.PI; while(da<-Math.PI)da+=2*Math.PI;
        const na=cur+Math.max(-0.08,Math.min(0.08,da)); const sp=Math.hypot(this.vx,this.vy);
        this.vx=Math.cos(na)*sp; this.vy=Math.sin(na)*sp; }
    }
    this.x+=this.vx; this.y+=this.vy; this.traveled+=Math.hypot(this.vx,this.vy);
    if(this.traveled>this.range) this.dead=true;
    // walls / rocks
    const c=Math.floor((this.x-T.X0)/T.TILE), r=Math.floor((this.y-T.Y0)/T.TILE);
    if(c<0||r<0||c>=T.COLS||r>=T.ROWS){ if(!this.edgeOk) this.dead=true; return; }
    const t=g.room.grid[r][c];
    if(t==='W'){ this.dead=true; g.splash(this.x,this.y,'#9ab'); return; }
    if(t==='R'&&!this.pierce){ this.dead=true; g.splash(this.x,this.y,'#9ab'); return; }
    if(this.fromEnemy){
      if(Math.hypot(this.x-g.player.x,this.y-g.player.y)<16+this.r){ if(g.player.hurt(this.dmg,g)) this.dead=true; }
    } else {
      for(const e of g.room.enemies){
        if(e.dead||this.hitSet.has(e.id)) continue;
        if(Math.hypot(this.x-e.x,this.y-e.y)<e.r+this.r){
          e.hit(this.dmg,this.burn,g); this.hitSet.add(e.id);
          if(this.pierce>0) this.pierce--; else { this.dead=true; break; }
        }
      }
    }
  }
  draw(ctx){
    ctx.save();
    ctx.fillStyle=this.fromEnemy?'#b8506a':'#bfe3f2';
    ctx.beginPath(); ctx.arc(this.x,this.y,this.r,0,7); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.5)';
    ctx.beginPath(); ctx.arc(this.x-this.r*0.3,this.y-this.r*0.3,this.r*0.35,0,7); ctx.fill();
    ctx.restore();
  }
}

class Player {
  constructor(charId){
    const c=CHARACTERS[charId]; this.charId=charId; this.def=c;
    this.stats={ maxHearts:c.hp, hearts:c.hp, speed:c.speed, damage:c.damage, fireDelay:c.fireDelay,
      tearRange:c.tearRange, tearSpeed:c.tearSpeed, luck:c.luck, shots:1, spread:0.05, tearSize:9, pierce:0, burn:false, homing:false };
    this.x=T.wx(6); this.y=T.wy(3.5); this.invuln=0; this.fireCd=0;
    this.coins=0; this.keys=0; this.bombs=1; this.activeCd=0; this.activeMax=600; this.hasActive=false;
    this.items=[]; this.lastDir={x:1,y:0}; this.walkT=0;
  }
  get hp(){ return Math.ceil(this.stats.hearts/2); }
  hurt(dmg,g){
    if(this.invuln>0) return false;
    this.stats.hearts-=dmg; this.invuln=60; g.shake=12;
    if(this.stats.hearts<=0){ this.stats.hearts=0; g.onPlayerDeath(); }
    return true;
  }
  heal(n,g){ this.stats.hearts=Math.min(this.stats.maxHearts,this.stats.hearts+n); }
  addItem(item,g){
    item.apply(this.stats); this.items.push(item);
    if(item.id==='tearkeeper') this.stats.hearts+=2;
    g.toast(`Подобрано: ${item.name}`);
  }
  update(g){
    const k=g.keys; let dx=0,dy=0;
    if(k['KeyW']||k['ArrowUpMove'])dy-=1; // reserved
    if(k['KeyW'])dy-=1; if(k['KeyS'])dy+=1; if(k['KeyA'])dx-=1; if(k['KeyD'])dx+=1;
    if(dx||dy){ const l=Math.hypot(dx,dy); this.lastDir.x=dx/l; this.lastDir.y=dy/l; this.walkT+=0.25; }
    const sp=this.stats.speed;
    this.moveBy(dx/sp*1, dy/sp*1, g, sp);
    if(this.invuln>0)this.invuln--;
    if(this.fireCd>0)this.fireCd--;
    if(this.activeCd>0)this.activeCd--;
    // shooting with arrows
    let sx=0,sy=0;
    if(k['ArrowUp'])sy=-1; if(k['ArrowDown'])sy=1; if(k['ArrowLeft'])sx=-1; if(k['ArrowRight'])sx=1;
    if((sx||sy)&&this.fireCd<=0){
      const base=Math.atan2(sy,sx);
      const n=this.stats.shots;
      for(let i=0;i<n;i++){
        const off=(i-(n-1)/2)*this.stats.spread;
        const a=base+off+(Math.random()-0.5)*0.05;
        g.spawnTear(new Tear(this.x+Math.cos(a)*14,this.y+Math.sin(a)*14,
          Math.cos(a)*this.stats.tearSpeed,Math.sin(a)*this.stats.tearSpeed,
          this.stats.damage,{range:this.stats.tearRange*80,pierce:this.stats.pierce,homing:this.stats.homing,burn:this.stats.burn,r:this.stats.tearSize}));
      }
      this.fireCd=this.stats.fireDelay;
    }
    // active item burst
    if(k['Space']&&this.hasActive&&this.activeCd<=0){
      this.invuln=Math.max(this.invuln,90);
      for(let i=0;i<10;i++){ const a=i/10*Math.PI*2;
        g.spawnTear(new Tear(this.x,this.y,Math.cos(a)*6,Math.sin(a)*6,this.stats.damage*1.3,{range:500,r:10})); }
      this.activeCd=this.activeMax; g.toast('ИЗВЕРЖЕНИЕ СЛЁЗ!'); k['Space']=false;
    }
  }
  moveBy(nx,ny,g,sp){
    // normalize step to speed magnitude
    const l=Math.hypot(nx,ny); if(l>0){ nx=nx/l*sp; ny=ny/l*sp; }
    this.tryAxis(g,'x',nx); this.tryAxis(g,'y',ny);
  }
  solidAt(g,x,y){
    // is world point (x,y) a blocking tile? Outside grid = wall UNLESS in door gap column/row
    const c=Math.floor((x-T.X0)/T.TILE), r=Math.floor((y-T.Y0)/T.TILE);
    if(c>=0&&r>=0&&c<T.COLS&&r<T.ROWS){
      const t=g.room.grid[r][c];
      return t==='W'||t==='R'||t==='P'||t==='H';
    }
    // inside door corridor zone: free movement (handled by game.inDoorZone)
    if(g.inDoorZone(x,y))return false;
    // outside the playfield: only passable through door gaps
    if(r===-1&&(c===5||c===6)&&g.room.grid[0]&&g.room.grid[0][c]==='D')return false;
    if(r===T.ROWS&&(c===5||c===6)&&g.room.grid[T.ROWS-1][c]==='D')return false;
    if(c===-1&&r===3&&g.room.grid[3][0]==='D')return false;
    if(c===T.COLS&&r===3&&g.room.grid[3][T.COLS-1]==='D')return false;
    return true;
  }
  tryAxis(g,axis,d){
    if(!d)return;
    const r=14;
    const ox=this.x, oy=this.y;
    if(axis==='x')this.x+=d; else this.y+=d;
    // check leading edge corners against tiles
    const lead = d>0 ? r : -r;
    let blocked=false;
    if(axis==='x'){
      const cx=this.x+lead;
      for(const cy of [this.y-r+2,this.y+r-2]) if(this.solidAt(g,cx,cy))blocked=true;
    } else {
      const cy=this.y+lead;
      for(const cx of [this.x-r+2,this.x+r-2]) if(this.solidAt(g,cx,cy))blocked=true;
    }
    if(blocked){ this.x=ox; this.y=oy; }
  }
  draw(ctx,g){
    const bob=Math.sin(this.walkT)*2;
    ctx.save(); ctx.translate(this.x,this.y+bob);
    if(this.invuln>0 && Math.floor(this.invuln/4)%2===0) ctx.globalAlpha=0.4;
    const col=this.def.color;
    // body
    ctx.fillStyle='#c9573d'; ctx.fillRect(-11,2,22,14); // diaper/shorts
    ctx.fillStyle=col;
    ctx.beginPath(); ctx.arc(0,-2,16,0,7); ctx.fill(); // head/body
    // eyes
    ctx.fillStyle='#222';
    const ex=this.lastDir.x*2;
    ctx.beginPath(); ctx.arc(-5+ex,-3,2.6,0,7); ctx.arc(5+ex,-3,2.6,0,7); ctx.fill();
    // tears under eyes
    ctx.fillStyle='#bfe3f2';
    ctx.beginPath(); ctx.arc(-6,3,1.8,0,7); ctx.arc(6,3,1.8,0,7); ctx.fill();
    if(this.charId==='cain'){ ctx.strokeStyle='#a33'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(-8,-14); ctx.lineTo(8,-6); ctx.stroke(); }
    if(this.charId==='magda'){ ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(0,-16,5,0,7); ctx.fill(); }
    ctx.restore();
  }
}

class Enemy {
  constructor(type,x,y){
    const d=ENEMY_TYPES[type]; this.type=type; this.def=d;
    this.id=nextId++; this.x=x; this.y=y; this.hp=d.hp; this.maxHp=d.hp; this.r=d.r;
    this.dead=false; this.vx=0; this.vy=0; this.t=Math.random()*100; this.shootCd=60+Math.random()*60;
    this.burnT=0; this.state='idle'; this.hopT=0; this.dir=1;
  }
  hit(dmg,burn,g){
    this.hp-=dmg; if(burn)this.burnT=120;
    if(this.hp<=0){ this.dead=true; g.onEnemyKill(this); }
  }
  moveStep(g,sp){
    this.x+=this.vx; this.y+=this.vy;
    const c=Math.floor((this.x-T.X0)/T.TILE), r=Math.floor((this.y-T.Y0)/T.TILE);
    if(c<1||r<1||c>=T.COLS-1||r>=T.ROWS-1){ this.vx*=-1; this.vy*=-1; this.x+=this.vx; this.y+=this.vy; }
    else{ const t=g.room.grid[r][c]; if(t==='W'||t==='R'||t==='S'){ this.vx*=-1; this.vy*=-1; } }
  }
  update(g){
    this.t++;
    const p=g.player; const dx=p.x-this.x, dy=p.y-this.y, dl=Math.hypot(dx,dy)||1;
    const ai=this.def.ai, sp=this.def.speed;
    if(ai==='fly'){ this.vx=Math.cos(this.t*0.05+this.id)*sp; this.vy=Math.sin(this.t*0.08)*sp*0.8; }
    else if(ai==='chase'){ this.vx=dx/dl*sp; this.vy=dy/dl*sp; }
    else if(ai==='hop'){
      this.hopT--;
      if(this.hopT<=0){ this.hopT=40+Math.random()*30; this.vx=dx/dl*sp*3; this.vy=dy/dl*sp*3; }
      this.vx*=0.92; this.vy*=0.92;
    }
    else if(ai==='shoot'){
      if(dl>220){ this.vx=dx/dl*sp; this.vy=dy/dl*sp; } else { this.vx*=0.8; this.vy*=0.8; }
      this.shootCd--;
      if(this.shootCd<=0){ this.shootCd=90+Math.random()*50;
        const a=Math.atan2(dy,dx);
        g.enemyShoot(this.x,this.y,Math.cos(a)*4,Math.sin(a)*4,1); }
    }
    else if(ai==='charge'){
      if(this.state==='idle'){ this.vx*=0.85; this.vy*=0.85; this.shootCd--;
        if(this.shootCd<=0&&dl<380){ this.state='wind'; this.shootCd=35; } }
      else if(this.state==='wind'){ this.vx=0;this.vy=0; this.shootCd--; if(this.shootCd<=0){ this.state='dash'; this.shootCd=28; this.vx=dx/dl*sp*5.5; this.vy=dy/dl*sp*5.5; } }
      else { this.shootCd--; if(this.shootCd<=0){ this.state='idle'; this.shootCd=100+Math.random()*60; } }
    }
    this.moveStep(g);
    if(this.burnT>0){ this.burnT--; if(this.t%12===0){ this.hp-=0.5; if(this.hp<=0){this.dead=true;g.onEnemyKill(this);} } }
    if(dl<this.r+15){ p.hurt(this.def.dmg,g); }
  }
  draw(ctx){
    const d=this.def; ctx.save(); ctx.translate(this.x,this.y);
    if(this.burnT>0){ ctx.shadowColor='#e67e22'; ctx.shadowBlur=12; }
    if(this.type==='fly'||this.type==='attackfly'){
      ctx.fillStyle=d.color; ctx.beginPath(); ctx.arc(0,0,d.r*0.7,0,7); ctx.fill();
      ctx.fillStyle='rgba(220,220,230,.6)';
      const w=Math.sin(this.t*0.6)*4;
      ctx.beginPath(); ctx.ellipse(-d.r*0.7,-4+w*0.2,7,3,-0.5,0,7); ctx.ellipse(d.r*0.7,-4-w*0.2,7,3,0.5,0,7); ctx.fill();
      ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(-3,-2,2.5,0,7); ctx.arc(3,-2,2.5,0,7); ctx.fill();
      if(this.type==='attackfly'){ ctx.fillStyle='#c0392b'; ctx.beginPath(); ctx.arc(-3,-2,1.2,0,7); ctx.arc(3,-2,1.2,0,7); ctx.fill(); }
    } else if(this.type==='spider'){
      ctx.strokeStyle='#222'; ctx.lineWidth=2;
      for(let i=0;i<4;i++){ const a=0.5+i*0.6+Math.sin(this.t*0.3)*0.15;
        ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(Math.cos(a)*d.r,Math.sin(a)*d.r); ctx.moveTo(0,0); ctx.lineTo(-Math.cos(a)*d.r,Math.sin(a)*d.r); ctx.stroke(); }
      ctx.fillStyle=d.color; ctx.beginPath(); ctx.arc(0,0,d.r*0.6,0,7); ctx.fill();
      ctx.fillStyle='#eee'; ctx.beginPath(); ctx.arc(-3,-2,1.6,0,7); ctx.arc(3,-2,1.6,0,7); ctx.fill();
    } else {
      // humanoid blobs (gaper/shooter/charger/lump/spitter)
      const squash=this.state==='wind'?0.8:1;
      ctx.fillStyle=d.color;
      ctx.beginPath(); ctx.ellipse(0,0,d.r*squash,d.r*(2-squash)*0.9,0,0,7); ctx.fill();
      ctx.fillStyle='#fff';
      ctx.beginPath(); ctx.arc(-d.r*0.3,-d.r*0.2,d.r*0.22,0,7); ctx.arc(d.r*0.3,-d.r*0.2,d.r*0.22,0,7); ctx.fill();
      ctx.fillStyle='#222';
      const pdx=(g=>g)(0); ctx.beginPath();
      ctx.arc(-d.r*0.3,-d.r*0.2,1.8,0,7); ctx.arc(d.r*0.3,-d.r*0.2,1.8,0,7); ctx.fill();
      ctx.strokeStyle='#3a1f1f'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(0,d.r*0.3,d.r*0.3,0.2,Math.PI-0.2); ctx.stroke();
      if(this.type==='charger'&&this.state==='wind'){ ctx.fillStyle='#ff5'; ctx.beginPath(); ctx.arc(0,-d.r-6,3,0,7); ctx.fill(); }
    }
    ctx.restore();
  }
}

class Boss {
  constructor(spec,x,y){
    this.spec=spec; this.id=nextId++; this.x=x; this.y=y;
    this.hp=spec.hp; this.maxHp=spec.hp; this.r=spec.r; this.t=0; this.dead=false;
    this.vx=0; this.vy=0; this.phase=0; this.cd=80; this.burnT=0; this.jumpT=0;
  }
  hit(dmg,burn,g){ this.hp-=dmg; if(burn)this.burnT=150;
    if(this.hp<=0){ this.dead=true; g.onBossKill(this); } }
  update(g){
    this.t++; const p=g.player; const dx=p.x-this.x,dy=p.y-this.y,dl=Math.hypot(dx,dy)||1;
    const k=this.spec.kind;
    if(k==='gaperking'){
      this.vx=dx/dl*this.spec.speed; this.vy=dy/dl*this.spec.speed;
      this.cd--;
      if(this.cd<=0){ this.cd=70-Math.min(40,this.t/200);
        for(let i=-1;i<=1;i++){ const a=Math.atan2(dy,dx)+i*0.35;
          g.enemyShoot(this.x,this.y,Math.cos(a)*4.2,Math.sin(a)*4.2,1); }
        if(this.hp<this.maxHp*0.5&&this.t%3===0){ const s=new Enemy('attackfly',this.x,this.y); s.hp=3; g.room.enemies.push(s); }
      }
    } else if(k==='monarch'){
      // flies around, dashes, spawns flies
      this.jumpT--;
      if(this.jumpT<=0){ this.jumpT=60+Math.random()*40;
        this.vx=dx/dl*4.2; this.vy=dy/dl*4.2; }
      this.vx*=0.96; this.vy*=0.96;
      this.cd--;
      if(this.cd<=0){ this.cd=90;
        for(let i=0;i<2;i++){ const s=new Enemy('fly',this.x+(Math.random()-0.5)*40,this.y+(Math.random()-0.5)*40); g.room.enemies.push(s); }
        for(let i=0;i<6;i++){ const a=i/6*Math.PI*2+this.t*0.01; g.enemyShoot(this.x,this.y,Math.cos(a)*3.4,Math.sin(a)*3.4,1); }
      }
    } else if(k==='dome'){
      this.vx=dx/dl*this.spec.speed; this.vy=dy/dl*this.spec.speed;
      this.cd--;
      if(this.cd<=0){ this.cd=110;
        const ring=this.hp<this.maxHp*0.5;
        const n=ring?12:8;
        for(let i=0;i<n;i++){ const a=i/n*Math.PI*2;
          g.enemyShoot(this.x,this.y,Math.cos(a)*3.2,Math.sin(a)*3.2,1); }
        if(ring){ const s=new Enemy('shooter',this.x+(Math.random()-0.5)*120,this.y+(Math.random()-0.5)*80); g.room.enemies.push(s); }
      }
    }
    this.x+=this.vx; this.y+=this.vy;
    this.x=Math.max(T.wx(1.5),Math.min(T.wx(T.COLS-1.5),this.x));
    this.y=Math.max(T.wy(1.5),Math.min(T.wy(T.ROWS-1.5),this.y));
    if(this.burnT>0){ this.burnT--; if(this.t%15===0){ this.hp-=0.7; if(this.hp<=0){this.dead=true;g.onBossKill(this);} } }
    if(dl<this.r+14) p.hurt(this.spec.dmg,g);
  }
  draw(ctx){
    const s=this.spec; ctx.save(); ctx.translate(this.x,this.y);
    if(this.burnT>0){ ctx.shadowColor='#e67e22'; ctx.shadowBlur=18; }
    ctx.fillStyle=s.color;
    ctx.beginPath(); ctx.arc(0,0,this.r,0,7); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.12)';
    ctx.beginPath(); ctx.arc(-this.r*0.3,-this.r*0.35,this.r*0.45,0,7); ctx.fill();
    // face
    ctx.fillStyle='#fff';
    ctx.beginPath(); ctx.arc(-this.r*0.32,-this.r*0.15,this.r*0.2,0,7); ctx.arc(this.r*0.32,-this.r*0.15,this.r*0.2,0,7); ctx.fill();
    ctx.fillStyle='#111';
    const p=g=>0;
    ctx.beginPath(); ctx.arc(-this.r*0.32,-this.r*0.15,3.4,0,7); ctx.arc(this.r*0.32,-this.r*0.15,3.4,0,7); ctx.fill();
    ctx.strokeStyle='#2a1414'; ctx.lineWidth=3;
    ctx.beginPath(); ctx.arc(0,this.r*0.35,this.r*0.4,0.15,Math.PI-0.15); ctx.stroke();
    if(s.kind==='monarch'){ // wings
      ctx.fillStyle='rgba(200,200,220,.5)';
      const w=Math.sin(this.t*0.5)*6;
      ctx.beginPath(); ctx.ellipse(-this.r,-8+w*0.2,this.r*0.7,this.r*0.3,-0.6,0,7); ctx.ellipse(this.r,-8-w*0.2,this.r*0.7,this.r*0.3,0.6,0,7); ctx.fill();
    }
    ctx.restore();
    // hp bar
    const ctxBar=ctx; const w=120;
    ctxBar.fillStyle='#000a'; ctxBar.fillRect(this.x-w/2,this.y-this.r-16,w,7);
    ctxBar.fillStyle='#c0392b'; ctxBar.fillRect(this.x-w/2+1,this.y-this.r-15,(w-2)*Math.max(0,this.hp/this.maxHp),5);
  }
}

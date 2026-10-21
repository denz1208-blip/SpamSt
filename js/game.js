// ================= ГЛАВНЫЙ КЛАСС ИГРЫ =================
const W=960, H=560;
const cvs=document.getElementById('game'), ctx=cvs.getContext('2d');

class Game {
  constructor(){
    this.keys={};
    this.state='menu';
    this.toastText=''; this.toastT=0; this.showMap=false;
    addEventListener('keydown',e=>{ this.keys[e.code]=true;
      if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();
      if(e.code==='Escape'&&this.state==='play')this.showMap=!this.showMap; });
    addEventListener('keyup',e=>{ this.keys[e.code]=false; });
    this.loop=this.loop.bind(this);
    requestAnimationFrame(()=>this.loop());
  }
  start(charId){
    this.player=new Player(charId);
    this.floorIdx=0; this.kills=0; this.shake=0; this.time=0;
    this.usedItems=[];
    this.enterFloor(0);
    this.state='play'; this.showMap=false;
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('death').classList.add('hidden');
    document.getElementById('win').classList.add('hidden');
  }
  enterFloor(i){
    this.floorIdx=i;
    generateFloor(this);
    this.room=this.startRoom; this.room.seed(this); this.room.explored=true;
    this.player.x=T.wx(6); this.player.y=T.wy(3.5);
    this.tears=[]; this.parts=[];
    this.toast(`${FLOORS[i].name} — этаж ${i+1}`);
  }
  rollItem(){
    const avail=ITEMS.filter(it=>!this.usedItems.includes(it.id));
    if(!avail.length)return ITEMS[Math.floor(Math.random()*ITEMS.length)];
    const w=avail.map(it=>({it,wt:Math.max(1,6-it.rare)}));
    let s=w.reduce((a,b)=>a+b.wt,0),r=Math.random()*s;
    for(const e of w){ r-=e.wt; if(r<=0){ this.usedItems.push(e.it.id); return e.it; } }
    return avail[0];
  }
  gotoRoom(dx,dy){
    const nk=`${this.room.fx+dx},${this.room.fy+dy}`;
    const nr=this.map.get(nk);
    if(!nr) return;
    this.room=nr;
    nr.seed(this); nr.explored=true;
    this.tears=[]; this.parts=[];
    if(dx===-1){ this.player.x=T.wx(1.4); this.player.y=T.wy(3.5); }
    if(dx===1){ this.player.x=T.wx(T.COLS-1.6); this.player.y=T.wy(3.5); }
    if(dy===-1){ this.player.x=T.wx(6); this.player.y=T.wy(1.4); }
    if(dy===1){ this.player.x=T.wx(6); this.player.y=T.wy(T.ROWS-1.6); }
    if(nr.type==='boss'&&!nr.cleared&&!nr.bossSpawned){
      nr.bossSpawned=true;
      nr.boss=new Boss(nr.bossSpec,T.wx(6),T.wy(2.5));
      this.toast(`БОСС: ${nr.bossSpec.name}`);
    }
  }
  roomDoorAt(x,y){ // returns dir name if center is inside a doorway gap, else null
    const c=Math.floor((x-T.X0)/T.TILE), r=Math.floor((y-T.Y0)/T.TILE);
    if(r===-1&&(c===5||c===6)&&this.room.grid[0]&&this.room.grid[0][c]==='D')return 'up';
    if(r===T.ROWS&&(c===5||c===6)&&this.room.grid[T.ROWS-1][c]==='D')return 'down';
    if(c===-1&&r===3&&this.room.grid[3][0]==='D')return 'left';
    if(c===T.COLS&&r===3&&this.room.grid[3][T.COLS-1]==='D')return 'right';
    return null;
  }
  // allow the player to cross the wall band around door gaps (visual passage)
  inDoorZone(x,y){
    const g=this.room.grid;
    if(!g.length)return false;
    // vertical corridors at columns 5..6 (top/bottom doors)
    if(g[0][5]==='D'&&x>T.wx(5)+8&&x<T.wx(7)-8&&y>T.wy(0)-24)return true;
    if(g[T.ROWS-1][5]==='D'&&x>T.wx(5)+8&&x<T.wx(7)-8&&y<T.wy(T.ROWS)+24)return true;
    if(g[3][0]==='D'&&y>T.wy(3)+8&&y<T.wy(4)-8&&x>T.wx(0)-24)return true;
    if(g[3][T.COLS-1]==='D'&&y>T.wy(3)+8&&y<T.wy(4)-8&&x<T.wx(T.COLS)+24)return true;
    return false;
  }
  spawnTear(t){ this.tears.push(t); }
  enemyShoot(x,y,vx,vy,dmg){ this.tears.push(new Tear(x,y,vx,vy,dmg,{fromEnemy:true,range:600,r:8})); }
  splash(x,y,col){ for(let i=0;i<4;i++)this.parts.push({x,y,vx:(Math.random()-0.5)*3,vy:(Math.random()-0.5)*3,t:14,col}); }
  burst(x,y,col,n=10){ for(let i=0;i<n;i++){ const a=Math.random()*7,s=1+Math.random()*3;
    this.parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,t:24,col}); } }
  toast(txt){ this.toastText=txt; this.toastT=180; }
  onEnemyKill(e){ this.kills++; this.burst(e.x,e.y,e.def.color);
    if(Math.random()<0.12)this.room.pickups.push({kind:Math.random()<0.5?'coin':'heart',x:e.x,y:e.y});
    this.checkClear(); }
  onBossKill(b){
    this.kills++; this.burst(b.x,b.y,b.spec.color,30); this.shake=25;
    this.room.cleared=true; this.room.boss=null;
    this.room.pickups.push({kind:'heart',x:T.wx(4),y:T.wy(3.5)});
    this.room.pickups.push({kind:'coin',x:T.wx(8),y:T.wy(3.5)});
    this.toast('БОСС ПОВЕРЖЕН!');
    this.room.itemAfterBoss=this.rollItem();
    this.stairs={x:T.wx(6),y:T.wy(4.6)}; // exit to next floor appears
    if(this.floorIdx>=FLOORS.length-1){ /* win triggers when taking stairs */ }
  }
  checkClear(){
    const alive=this.room.enemies.some(e=>!e.dead);
    if(!alive&&!this.room.cleared){ this.room.cleared=true;
      if(this.room.type==='normal'&&Math.random()<0.25+this.player.stats.luck*0.02){
        this.room.item=this.rollItem();
      }
    }
  }
  onPlayerDeath(){ this.state='dead';
    const p=this.player;
    localStorage.setItem('isaac_best', JSON.stringify({
      floor: FLOORS[this.floorIdx].name, kills:this.kills, items:p.items.length,
      char: CHARACTERS[p.charId] ? CHARACTERS[p.charId].name : p.charId, t: Math.floor(this.time/60)
    }));
    document.getElementById('deathStats').textContent=
      `Этаж: ${FLOORS[this.floorIdx].name} · Убито: ${this.kills} · Предметов: ${p.items.length}`;
    document.getElementById('death').classList.remove('hidden'); }
  onWin(){ this.state='won';
    localStorage.setItem('isaac_wins', String(Number(localStorage.getItem('isaac_wins')||0)+1));
    document.getElementById('winStats').textContent=
      `Все три этажа пройдены! Убито врагов: ${this.kills} · Собрано предметов: ${this.player.items.length}`;
    document.getElementById('win').classList.remove('hidden'); }

  update(){
    if(this.state!=='play')return;
    this.time++;
    if(this.shake>0)this.shake--;
    if(this.toastT>0)this.toastT--;
    this.player.update(this);
    const p=this.player;
    // exits
    if(this.room.cleared){
      const d=this.roomDoorAt(p.x,p.y);
      if(d==='up'){this.gotoRoom(0,-1);return;}
      if(d==='down'){this.gotoRoom(0,1);return;}
      if(d==='left'){this.gotoRoom(-1,0);return;}
      if(d==='right'){this.gotoRoom(1,0);return;}
    } else {
      const c=Math.floor((p.x-T.X0)/T.TILE), r=Math.floor((p.y-T.Y0)/T.TILE);
      if(this.room.grid[r]&&this.room.grid[r][c]==='D'){ p.x=T.wx(6); p.y=T.wy(3.5); }
    }
    // stairs to next floor
    if(this.stairs&&Math.hypot(p.x-this.stairs.x,p.y-this.stairs.y)<24){
      this.stairs=null;
      if(this.floorIdx>=FLOORS.length-1){ this.onWin(); return; }
      this.enterFloor(this.floorIdx+1); return;
    }
    // tears
    for(const t of this.tears)t.update(this);
    this.tears=this.tears.filter(t=>!t.dead);
    // enemies + boss
    for(const e of this.room.enemies)if(!e.dead)e.update(this);
    this.room.enemies=this.room.enemies.filter(e=>!e.dead);
    if(this.room.boss&&!this.room.boss.dead)this.room.boss.update(this);
    // spikes damage
    for(const [sc,sr] of this.room.spikes){
      if(Math.abs(p.x-T.wx(sc+0.5))<26&&Math.abs(p.y-T.wy(sr+0.5))<26)p.hurt(1,this);
    }
    // pickups
    this.room.pickups=this.room.pickups.filter(pk=>{
      if(Math.hypot(p.x-pk.x,p.y-pk.y)<22){
        if(pk.kind==='heart'){p.heal(2,this);this.toast('+Здоровье');}
        if(pk.kind==='coin'){p.coins++;}
        if(pk.kind==='key'){p.keys++;}
        if(pk.kind==='bomb'){p.bombs++;}
        this.burst(pk.x,pk.y,'#fff',6); return false;
      }
      return true;
    });
    // items pedestal pickup
    const it=this.room.item||(this.room.cleared&&this.room.itemAfterBoss)||
             (this.room.type==='treasure'&&this.treasureItem);
    if(it&&Math.hypot(p.x-T.wx(6),p.y-T.wy(3))<26){
      p.addItem(it,this); this.room.item=null; this.room.itemAfterBoss=null; this.treasureItem=null;
      if(!p.hasActive){ p.hasActive=true; }
    }
    // shop purchase with E
    if(this.room.type==='shop'&&this.room.stock){
      this.shopHint=null;
      for(let i=this.room.stock.length-1;i>=0;i--){
        const st=this.room.stock[i];
        if(Math.hypot(p.x-st.x,p.y-st.y)<26){
          this.shopHint=`${st.item.name} — ${st.item.desc} · Цена ${this.room.price} монет (E купить)`;
          if(this.keys['KeyE']&&p.coins>=this.room.price){
            p.coins-=this.room.price; p.addItem(st.item,this); this.room.stock.splice(i,1); this.keys['KeyE']=false;
          }
        }
      }
    } else this.shopHint=null;
    // bomb explode with Q
    if(this.keys['KeyQ']&&p.bombs>0){ this.keys['KeyQ']=false; p.bombs--;
      this.explode(p.x,p.y,130); }
    // particles
    for(const pt of this.parts){ pt.x+=pt.vx; pt.y+=pt.vy; pt.vx*=0.9; pt.vy*=0.9; pt.t--; }
    this.parts=this.parts.filter(pt=>pt.t>0);
  }
  explode(x,y,r){
    this.shake=18; this.burst(x,y,'#e67e22',24);
    for(const e of this.room.enemies)if(Math.hypot(e.x-x,e.y-y)<r)e.hit(99,false,this);
    if(this.room.boss&&Math.hypot(this.room.boss.x-x,this.room.boss.y-y)<r+this.room.boss.r)this.room.boss.hit(15,false,this);
    for(let rr=0;rr<T.ROWS;rr++)for(let cc=0;cc<T.COLS;cc++){
      const tx=T.wx(cc+0.5),ty=T.wy(rr+0.5);
      if(Math.hypot(tx-x,ty-y)<r){ const t=this.room.grid[rr][cc];
        if(t==='R'||t==='P'){this.room.grid[rr][cc]='F';this.burst(tx,ty,'#8a7a5a',6);} }
    }
    this.checkClear();
  }

  // ============ RENDER ============
  draw(){
    ctx.save();
    if(this.shake>0)ctx.translate((Math.random()-0.5)*this.shake,(Math.random()-0.5)*this.shake);
    if(this.state==='menu'){ ctx.fillStyle='#1a1214'; ctx.fillRect(0,0,W,H); ctx.restore(); return; }
    const pal=FLOORS[this.floorIdx].palette;
    ctx.fillStyle='#0d0a0b'; ctx.fillRect(-20,-20,W+40,H+40);
    // floor tiles
    for(let r=0;r<T.ROWS;r++)for(let c=0;c<T.COLS;c++){
      const x=T.wx(c),y=T.wy(r),t=this.room.grid[r][c];
      if(t==='W'||t==='D') continue;
      ctx.fillStyle=(r+c)%2?pal.floorAlt:pal.floor;
      ctx.fillRect(x,y,T.TILE,T.TILE);
      if(t==='P'){ ctx.fillStyle=pal.pit; ctx.fillRect(x+4,y+4,T.TILE-8,T.TILE-8);
        ctx.strokeStyle='#000'; ctx.strokeRect(x+4,y+4,T.TILE-8,T.TILE-8); }
      if(t==='R'){ ctx.fillStyle='#8a7a5a'; ctx.fillRect(x+6,y+10,T.TILE-12,T.TILE-14);
        ctx.fillStyle='#6e6148'; ctx.fillRect(x+6,y+10,T.TILE-12,8); }
      if(t==='H'){ ctx.fillStyle='#5a4a4a'; ctx.fillRect(x+2,y+2,T.TILE-4,T.TILE-4);
        ctx.strokeStyle='#c9b8a8'; ctx.lineWidth=2;
        for(let i=0;i<3;i++){ ctx.beginPath(); ctx.moveTo(x+12+i*16,y+T.TILE-12); ctx.lineTo(x+18+i*16,y+12); ctx.lineTo(x+24+i*16,y+T.TILE-12); ctx.stroke(); } }
    }
    // walls
    for(let r=0;r<T.ROWS;r++)for(let c=0;c<T.COLS;c++){
      if(this.room.grid[r][c]!=='W')continue;
      const x=T.wx(c),y=T.wy(r);
      ctx.fillStyle=pal.wall; ctx.fillRect(x,y,T.TILE,T.TILE);
      ctx.fillStyle=pal.wallTop; ctx.fillRect(x,y,T.TILE,10);
      ctx.strokeStyle='rgba(0,0,0,.25)'; ctx.strokeRect(x+.5,y+.5,T.TILE-1,T.TILE-1);
    }
    // doors
    for(const d of ['up','down','left','right']){
      const has=this.room.neighbors(this)[d]; if(!has)continue;
      let x,y,w,h;
      if(d==='up'){x=T.wx(5);y=T.wy(0)-14;w=T.TILE*2;h=16;}
      if(d==='down'){x=T.wx(5);y=T.wy(T.ROWS)-2;w=T.TILE*2;h=16;}
      if(d==='left'){x=T.wx(0)-14;y=T.wy(3);w=16;h=T.TILE;}
      if(d==='right'){x=T.wx(T.COLS)-2;y=T.wy(3);w=16;h=T.TILE;}
      const open=this.room.cleared;
      ctx.fillStyle=open?'#120d0e':pal.wallTop;
      ctx.fillRect(x,y,w,h);
      if(open){
        ctx.fillStyle='rgba(240,230,210,.35)';
        ctx.font='16px serif'; ctx.textAlign='center';
        ctx.fillText(d==='up'?'▲':d==='down'?'▼':d==='left'?'◀':'▶',x+w/2,y+h/2+5);
      } else {
        ctx.fillStyle='#7a5a46'; ctx.fillRect(x+2,y+2,w-4,h-4);
        ctx.fillStyle='#3a2a20'; ctx.fillRect(x+w/2-2,y+h/2-4,4,8);
      }
    }
    // treasure room item (seed once per room visit)
    if(this.room.type==='treasure'&&!this.room.item&&!this.treasureItem&&!this.room.seededT){
      this.room.seededT=true; this.treasureItem=this.rollItem();
    }
    // pedestals/items
    const drawPed=(x,y,item,label)=>{
      ctx.fillStyle='#2a2226'; ctx.beginPath(); ctx.ellipse(x,y+16,20,8,0,0,7); ctx.fill();
      ctx.fillStyle='#463a40'; ctx.fillRect(x-14,y-2,28,16);
      ctx.fillStyle=item.color; ctx.beginPath(); ctx.arc(x,y-12,12,0,7); ctx.fill();
      ctx.fillStyle='rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(x-4,y-16,4,0,7); ctx.fill();
      if(label){ ctx.fillStyle='#f0e6d2'; ctx.font='12px serif'; ctx.textAlign='center'; ctx.fillText(label,x,y+38); }
    };
    if(this.room.item)drawPed(T.wx(6),T.wy(3),this.room.item,this.room.item.name);
    if(this.room.cleared&&this.room.itemAfterBoss)drawPed(T.wx(6),T.wy(3),this.room.itemAfterBoss,this.room.itemAfterBoss.name);
    if(this.treasureItem)drawPed(T.wx(6),T.wy(3),this.treasureItem,this.treasureItem.name);
    if(this.room.type==='shop'&&this.room.stock)for(const st of this.room.stock){
      drawPed(st.x,st.y-6,st.item,'');
      ctx.fillStyle='#d4b06a'; ctx.font='bold 13px serif'; ctx.textAlign='center'; ctx.fillText(this.room.price+'¢',st.x,st.y+30);
    }
    // stairs
    if(this.stairs){
      ctx.fillStyle='#1a1416'; ctx.beginPath(); ctx.ellipse(this.stairs.x,this.stairs.y,26,14,0,0,7); ctx.fill();
      ctx.strokeStyle='#d4b06a'; ctx.lineWidth=2;
      for(let i=1;i<=3;i++){ ctx.beginPath(); ctx.ellipse(this.stairs.x,this.stairs.y-i*4,26-i*6,12-i*3,0,0,7); ctx.stroke(); }
      ctx.fillStyle='#d4b06a'; ctx.font='12px Georgia'; ctx.textAlign='center'; ctx.fillText('ВНИЗ',this.stairs.x,this.stairs.y+30);
    }
    // pickups
    for(const pk of this.room.pickups){
      const x=pk.x,y=pk.y+Math.sin(this.time*0.1+pk.x)*2;
      if(pk.kind==='heart'){ this.drawHeart(x,y,1,'#c0392b'); }
      if(pk.kind==='coin'){ ctx.fillStyle='#d4af37'; ctx.beginPath(); ctx.arc(x,y,8,0,7); ctx.fill();
        ctx.strokeStyle='#a8842a'; ctx.beginPath(); ctx.arc(x,y,5,0,7); ctx.stroke(); }
      if(pk.kind==='bomb'){ ctx.fillStyle='#222'; ctx.beginPath(); ctx.arc(x,y,8,0,7); ctx.fill();
        ctx.strokeStyle='#e67e22'; ctx.beginPath(); ctx.moveTo(x,y-8); ctx.quadraticCurveTo(x+6,y-14,x+9,y-11); ctx.stroke(); }
      if(pk.kind==='key'){ ctx.strokeStyle='#d4b06a'; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(x-3,y,4,0,7); ctx.moveTo(x+1,y); ctx.lineTo(x+9,y); ctx.moveTo(x+7,y); ctx.lineTo(x+7,y+4); ctx.stroke(); }
    }
    // entities
    for(const e of this.room.enemies)if(!e.dead)e.draw(ctx);
    if(this.room.boss&&!this.room.boss.dead)this.room.boss.draw(ctx);
    for(const t of this.tears)t.draw(ctx);
    this.player.draw(ctx,this);
    for(const pt of this.parts){ ctx.globalAlpha=pt.t/24; ctx.fillStyle=pt.col; ctx.fillRect(pt.x-2,pt.y-2,4,4); ctx.globalAlpha=1; }
    ctx.restore();
    this.drawHUD();
    if(this.showMap)this.drawMap();
    if(this.toastT>0){
      ctx.globalAlpha=Math.min(1,this.toastT/40);
      ctx.fillStyle='rgba(0,0,0,.6)'; ctx.fillRect(W/2-220,16,440,34);
      ctx.fillStyle='#f0e6d2'; ctx.font='16px Georgia'; ctx.textAlign='center';
      ctx.fillText(this.toastText,W/2,38); ctx.globalAlpha=1;
    }
    if(this.shopHint){ ctx.fillStyle='rgba(0,0,0,.6)'; ctx.fillRect(W/2-300,H-34,600,26);
      ctx.fillStyle='#d4b06a'; ctx.font='14px Georgia'; ctx.textAlign='center'; ctx.fillText(this.shopHint,W/2,H-15); }
  }
  drawHeart(x,y,scale,color){
    ctx.save(); ctx.translate(x,y); ctx.scale(scale,scale);
    ctx.fillStyle=color; ctx.beginPath();
    ctx.moveTo(0,6); ctx.bezierCurveTo(-10,-4,-4,-12,0,-5); ctx.bezierCurveTo(4,-12,10,-4,0,6); ctx.fill();
    ctx.restore();
  }
  drawHUD(){
    const p=this.player;
    const total=p.stats.maxHearts;
    for(let i=0;i<total;i+=2){
      const hx=18+i*15, hy=20;
      const full=p.stats.hearts>=i+2, half=p.stats.hearts===i+1;
      this.drawHeart(hx,hy,1.1,full?'#c0392b':'#3a2a2a');
      if(half){ ctx.save(); ctx.beginPath(); ctx.rect(hx-12,hy-12,12,24); ctx.clip(); this.drawHeart(hx,hy,1.1,'#c0392b'); ctx.restore(); }
    }
    ctx.font='15px Georgia'; ctx.textAlign='left';
    ctx.fillStyle='#d4af37'; ctx.fillText(`Монеты: ${p.coins}`,16,52);
    ctx.fillStyle='#8899aa'; ctx.fillText(`Бомбы: ${p.bombs} (Q)`,120,52);
    ctx.fillStyle='#e8dcc8'; ctx.fillText(`Убийства: ${this.kills}`,240,52);
    ctx.fillStyle='#9a8a76'; ctx.fillText(`${FLOORS[this.floorIdx].name} ${this.floorIdx+1}/3`,380,52);
    if(p.hasActive){
      const ready=p.activeCd<=0;
      ctx.fillStyle=ready?'#f5e6ab':'#55504a';
      ctx.fillRect(W-160,14,130,30);
      ctx.fillStyle='#222'; ctx.font='12px Georgia'; ctx.textAlign='center';
      ctx.fillText(ready?'SPACE: ИЗВЕРЖЕНИЕ':'ПЕРЕЗАРЯДКА…',W-95,33);
      if(!ready){ ctx.fillStyle='#8a7a5a'; ctx.fillRect(W-158,40,126*(1-p.activeCd/p.activeMax),3); }
    }
    ctx.textAlign='left'; ctx.font='12px Georgia'; ctx.fillStyle='#6a5a4a';
    ctx.fillText(`УРОН ${p.stats.damage.toFixed(1)} · ТЕМП ${(60/p.stats.fireDelay).toFixed(1)}/с · СКОР ${p.stats.speed.toFixed(2)} · УДАЧА ${p.stats.luck} · Esc: карта`,16,H-12);
    p.items.forEach((it,i)=>{ ctx.fillStyle=it.color; ctx.beginPath(); ctx.arc(W-20-i*18,H-20,7,0,7); ctx.fill(); });
  }
  drawMap(){
    ctx.fillStyle='rgba(0,0,0,.75)'; ctx.fillRect(0,0,W,H);
    const cells=[...this.map.values()];
    let minX=9,maxX=-9,minY=9,maxY=-9;
    for(const r of cells){minX=Math.min(minX,r.fx);maxX=Math.max(maxX,r.fx);minY=Math.min(minY,r.fy);maxY=Math.max(maxY,r.fy);}
    const cw=64,ch=44, ox=W/2-(maxX-minX+1)*cw/2, oy=H/2-(maxY-minY+1)*ch/2;
    ctx.font='11px Georgia'; ctx.textAlign='center';
    for(const r of cells){
      if(!r.explored&&r.type!=='boss')continue;
      const x=ox+(r.fx-minX)*cw, y=oy+(r.fy-minY)*ch;
      let col='#555';
      if(r.explored){
        col=({start:'#7a8f5d',normal:'#8a7a5a',treasure:'#d4af37',shop:'#5d8fa8',boss:'#a04a3a',secret:'#9a5da8'})[r.type];
      } else if(r.type==='boss'){ col='#5a2a22'; }
      ctx.fillStyle=col; ctx.fillRect(x+3,y+3,cw-6,ch-6);
      if(r===this.room){ ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeRect(x+3,y+3,cw-6,ch-6); }
      if(r.type==='boss')ctx.fillText('☠',x+cw/2,y+ch/2+4);
      if(r.type==='treasure'&&r.explored)ctx.fillText('★',x+cw/2,y+ch/2+4);
      if(r.type==='shop'&&r.explored)ctx.fillText('$',x+cw/2,y+ch/2+4);
    }
    ctx.fillStyle='#e8dcc8'; ctx.font='16px Georgia';
    ctx.fillText('КАРТА ЭТАЖА — Esc закрыть',W/2,oy-20);
  }
  loop(){
    this.update(); this.draw();
    requestAnimationFrame(()=>this.loop());
  }
}

function startRoomPos(){ return [0,0]; }

// ---- UI wiring ----
const game=new Game();
let selectedChar='isaac';
document.querySelectorAll('.char').forEach(el=>el.addEventListener('click',()=>{
  document.querySelectorAll('.char').forEach(e=>e.classList.remove('selected'));
  el.classList.add('selected'); selectedChar=el.dataset.char;
}));
document.getElementById('startBtn').onclick=()=>game.start(selectedChar);
document.getElementById('restartBtn').onclick=()=>game.start(selectedChar);
document.getElementById('againBtn').onclick=()=>game.start(selectedChar);
document.getElementById('menuBtn').onclick=()=>{
  game.state='menu';
  document.getElementById('death').classList.add('hidden');
  document.getElementById('menu').classList.remove('hidden');
};
// статистика прошлых забегов в меню
(function(){
  const el=document.getElementById('statsLine'); if(!el)return;
  let s=[];
  try{
    const b=JSON.parse(localStorage.getItem('isaac_best')||'null');
    const w=Number(localStorage.getItem('isaac_wins')||0);
    if(b)s.push(`Рекорд: ${b.char} — ${b.floor}, убийств ${b.kills}`);
    if(w)s.push(`Побед всего: ${w}`);
  }catch(e){}
  el.textContent=s.join(' · ');
})();

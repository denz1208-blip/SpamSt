// ================= ДАННЫЕ: ПЕРСОНАЖИ, ПРЕДМЕТЫ, ВРАГИ =================
const CHARACTERS = {
  isaac:  { name:'Плакса', hp:6, speed:3.05, damage:1.0, fireDelay:22, tearRange:5.6, tearSpeed:7.4, luck:0, color:'#f2e4cd' },
  magda:  { name:'Магда',  hp:9, speed:2.85, damage:0.8, fireDelay:24, tearRange:5.2, tearSpeed:7.0, luck:0, color:'#eecfd4' },
  cain:   { name:'Каин',   hp:5, speed:3.35, damage:1.25,fireDelay:20, tearRange:6.0, tearSpeed:8.0, luck:2, color:'#d9b7a8' },
};

// passive items: apply(stats) modifies player stats; some add flags
const ITEMS = [
  { id:'tearkeeper', name:'Сердце слезотворца', desc:'+1 контейнер сердца', rare:2, color:'#c0392b',
    apply(s){ s.maxHearts += 1; } },
  { id:'hemothorn', name:'Кровавая шиповница', desc:'+0.5 урон, −немного скорость', rare:2, color:'#8e2f22',
    apply(s){ s.damage += 0.5; s.speed -= 0.1; } },
  { id:'quickdrop', name:'Ртутная капля', desc:'Стреляешь быстрее', rare:1, color:'#9aa5b1',
    apply(s){ s.fireDelay = Math.max(8, s.fireDelay - 6); } },
  { id:'longsigh', name:'Долгий вздох', desc:'Слёзы летят дальше и быстрее', rare:1, color:'#7fa8c9',
    apply(s){ s.tearRange += 2.2; s.tearSpeed += 1.2; } },
  { id:'splitgrief', name:'Расколотое горе', desc:'+1 слеза одновременно', rare:3, color:'#5d6df0',
    apply(s){ s.shots += 1; s.spread += 0.16; } },
  { id:'bigpain', name:'Тупая игла', desc:'Большие слёзы, +урон', rare:2, color:'#b06ac9',
    apply(s){ s.damage += 0.4; s.tearSize += 4; } },
  { id:'sisterhood', name:'Сестринский долг', desc:'Скорость и слёзы', rare:2, color:'#e88fb0',
    apply(s){ s.speed += 0.35; s.shots += 1; s.spread += 0.22; s.damage -= 0.15; } },
  { id:'luckybean', name:'Счастливое зерно', desc:'+3 удачи', rare:1, color:'#7bb56a',
    apply(s){ s.luck += 3; } },
  { id:'ironbile', name:'Желечная желчь', desc:'Слёзы пробивают врагов', rare:3, color:'#6a7f8f', pierce:true,
    apply(s){ s.pierce += 1; } },
  { id:'combustion', name:'Тлеющий уголёк', desc:'Слёзы поджигают', rare:3, color:'#e67e22', burn:true,
    apply(s){ s.burn = true; } },
  { id:'gravitywell', name:'Взвешенное сердце', desc:'Слёзы притягиваются к врагам', rare:3, color:'#444a63', homing:true,
    apply(s){ s.homing = true; } },
  { id:'tripleSad', name:'Тройная печаль', desc:'Выстрелы веером втрое мощнее', rare:4, color:'#3f51b5',
    apply(s){ s.shots += 2; s.spread += 0.3; } },
];

// active item (one): gives temporary invulnerability burst
const ACTIVE_ITEM = { id:'tearburst', name:'Извержение слёз', desc:'Нажми SPACE: неуязвимость + залп во все стороны (перезарядка долго)', color:'#f5e6ab' };

// enemy type definitions
const ENEMY_TYPES = {
  fly:      { hp:2,  speed:1.6, r:12, dmg:1, color:'#3a3a3a', ai:'fly',     score:1 },
  attackfly:{ hp:3,  speed:2.3, r:12, dmg:1, color:'#5b2d2d', ai:'chase',   score:2 },
  spider:   { hp:4,  speed:1.2, r:14, dmg:1, color:'#4a3b52', ai:'hop',     score:2 },
  gaper:    { hp:10, speed:1.15,r:17, dmg:1, color:'#c9a08a', ai:'chase',   score:3 },
  shooter:  { hp:8,  speed:0.7, r:16, dmg:1, color:'#7a8f5d', ai:'shoot',   score:4 },
  charger:  { hp:14, speed:0.9, r:19, dmg:1, color:'#8f5d5d', ai:'charge',  score:5 },
  spitter:  { hp:6,  speed:0.5, r:15, dmg:1, color:'#5d8f8a', ai:'shoot',   score:3 },
  lump:     { hp:24, speed:0.55,r:26, dmg:2, color:'#6e4a6e', ai:'chase',   score:8 },
};

const BOSSES = [
  { name:'ГНОЙНЫЙ ГУЗЕНИК', hp:90,  r:46, speed:0.8, dmg:2, color:'#a86f52', kind:'gaperking' },
  { name:'МИМОЗА, ЖУЖЖАЩИЙ БОГ', hp:120, r:40, speed:1.4, dmg:2, color:'#2f2f38', kind:'monarch' },
  { name:'ЧРЕВОХОД', hp:170, r:56, speed:0.6, dmg:2, color:'#7a4f8f', kind:'dome' },
];

const PICKUPS = {
  heart:   { heal:2 },
  coin:    {},
  key:     {},
  bomb:    {},
};

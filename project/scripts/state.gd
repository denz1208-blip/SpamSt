extends Node
## Автоoload "State": метасостояние между сценами + база данных предметов/персонажей.

const SAVE_PATH := "user://save.dat"

var character := "isaac"          # выбранный персонаж
var run_seed := 0                 # сид текущего забега
var rng := RandomNumberGenerator.new()
var wins := 0                     # завершено побегов (для меню)
var best_floor := 1               # рекорд глубины

# Статы игрока, переносимые между комнатами/этажами
var stats := {}

# Активный предмет (Q)
var active_item := ""
var active_cooldown := 0.0
var active_max := 1.0


func reset_run():
	stats = {
		"max_hp": 6,            # в полу-сердцах
		"speed": 230.0,
		"damage": 3.5,
		"tear_speed": 430.0,
		"cooldown": 0.75,       # сек между слезами
		"range": 520.0,         # дальность жизни слезы (пикс)
		"shots": 1,             # кол-во слёз за выстрел
		"multi_shot_spread": 0.28,
		"bomb_count": 1,
		"coins": 0,
		"keys": 0,
		"homing": false,
		"piercing": 0,
		"growth": false,        # аура "печальной звезды"
		"fire_rate_mult": 1.0,
		"tear_size": 1.0,
		"armor": 0,             # снижает урон
		"lifesteal": 0.0,       # шанс сердца за убийство
		"revives": 0,           # доп. жизни (1up)
		"items_taken": [],
	}
	active_item = ""
	active_cooldown = 0.0
	active_max = 1.0
	rng.seed = run_seed if run_seed != 0 else randi()


# ---------------- база предметов ----------------

const ITEMS := {
	"cracked_teardrop": {
		"name": "Трещина в сердце", "pool": "passive",
		"desc": "+ скорость слёз, -немного урона",
	},
	"seraphim": {
		"name": "Серафим", "pool": "passive",
		"desc": "+1.2 урона, самонаводящиеся слёзы",
	},
	"brimstone": {
		"name": "Серный огонь", "pool": "passive",
		"desc": "Мощные пронзающие слёзы",
	},
	"spoon_bend": {
		"name": "Гнутая ложка", "pool": "passive",
		"desc": "Самонаведение на врагов",
	},
	"polyphemus": {
		"name": "Полифем", "pool": "passive",
		"desc": "Залп из 3 слёз, -урон каждой",
	},
	"the_noise": {
		"name": "Шум", "pool": "active",
		"desc": "[Q] 40 слёз во все стороны",
	},
	"midas_touch": {
		"name": "Касание Мидаса", "pool": "passive",
		"desc": "+монета за каждое убийство",
	},
	"harlequin_bomb": {
		"name": "Бомбы Арлекина", "pool": "passive",
		"desc": "+2 бомбы",
	},
	"magic_mushroom": {
		"name": "Волшебный гриб", "pool": "passive",
		"desc": "Больше, сильнее, быстрее!",
	},
	"blood_of_martyr": {
		"name": "Кровь мученика", "pool": "passive",
		"desc": "+1 макс. сердце, вампиризм",
	},
	"the_wafer": {
		"name": "Облатка", "pool": "passive",
		"desc": "Броня: -1 получаемый урон",
	},
	"sad_star": {
		"name": "Печальная звезда", "pool": "passive",
		"desc": "+1 сердце, аура урона",
	},
	"hypercoagulation": {
		"name": "Гиперкоагуляция", "pool": "passive",
		"desc": "+урон, +размер слезы",
	},
	"the_common_booker": {
		"name": "Простой блокнот", "pool": "passive",
		"desc": "Быстрая стрельба",
	},
	"god_flesh": {
		"name": "Плоть бога", "pool": "passive",
		"desc": "Огромный урон и слёзы, медленнее",
	},
}

const ITEM_POOL_PASSIVE := [
	"cracked_teardrop", "spoon_bend", "the_common_booker", "hypercoagulation",
	"brimstone", "seraphim", "polyphemus", "magic_mushroom", "blood_of_martyr",
	"the_wafer", "sad_star", "midas_touch", "harlequin_bomb", "god_flesh",
]

const PILL_EFFECTS := [
	{"text": "Амфетамины! +скорость", "key": "speed"},
	{"text": "Передозировка! -1 сердце", "key": "overdose"},
	{"text": "Хорошая таблетка! +1 сердце", "key": "maxhp"},
	{"text": "Горькая пилюля: -урон", "key": "dmgdown"},
	{"text": "Пилюля силы! +урон", "key": "dmgup"},
	{"text": "Пилюля фокуса! Самонаведение", "key": "homing"},
	{"text": "Пилюля взрывов! +3 бомбы", "key": "bombs"},
	{"text": "Пилюля жадности! +5 монет", "key": "coins"},
	{"text": "Пилюля... странная. Ничего", "key": "none"},
	{"text": "Пилюля здоровья! Исцеление", "key": "heal"},
]

const CHARACTERS := {
	"isaac": {"name": "Иссак", "sprite": "player_isaac",
		"desc": "Обычный мальчик. Сбалансированный.",
		"hp": 6, "speed": 230, "damage": 3.5, "start_item": ""},
	"maggy": {"name": "Магдалина", "sprite": "player_maggy",
		"desc": "Быстрая и живучая, но слабее бьёт.",
		"hp": 8, "speed": 245, "damage": 3.0, "start_item": "cracked_teardrop"},
	"cain": {"name": "Каин", "sprite": "player_cain",
		"desc": "Два сердца, но огромный урон.",
		"hp": 4, "speed": 225, "damage": 4.5, "start_item": "brimstone"},
}


func apply_item(id: String):
	if not ITEMS.has(id):
		return
	stats["items_taken"].append(id)
	match id:
		"cracked_teardrop":
			stats["tear_speed"] += 40; stats["damage"] -= 0.3
		"seraphim":
			stats["damage"] += 1.2; stats["homing"] = true
		"brimstone":
			stats["damage"] += 1.5; stats["piercing"] += 2; stats["tear_size"] += 0.4
		"spoon_bend":
			stats["homing"] = true
		"polyphemus":
			stats["shots"] += 2; stats["damage"] -= 1.0; stats["cooldown"] += 0.25
		"the_noise":
			active_item = "the_noise"; active_max = 6.0
		"harlequin_bomb":
			stats["bomb_count"] += 2
		"magic_mushroom":
			stats["speed"] += 25; stats["damage"] += 1.0
			stats["tear_size"] += 0.5; stats["max_hp"] += 2
		"blood_of_martyr":
			stats["max_hp"] += 2; stats["lifesteal"] += 0.12
		"the_wafer":
			stats["armor"] += 1
		"sad_star":
			stats["max_hp"] += 2; stats["growth"] = true
		"hypercoagulation":
			stats["damage"] += 0.7; stats["tear_size"] += 0.35
		"the_common_booker":
			stats["fire_rate_mult"] *= 0.65
		"god_flesh":
			stats["damage"] += 3.5; stats["tear_size"] += 1.2
			stats["speed"] -= 15; stats["cooldown"] += 0.15


func random_item(exclude: Array) -> String:
	var pool := ITEM_POOL_PASSIVE.filter(func(x): return x not in exclude and x not in stats["items_taken"])
	if pool.is_empty():
		pool = ITEM_POOL_PASSIVE
	return pool[rng.randi_range(0, pool.size() - 1)]


func _ready():
	load_meta()


func save_meta():
	var d = {"wins": wins, "best_floor": best_floor, "character": character}
	var f: FileAccess = FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(d))


func load_meta():
	if FileAccess.file_exists(SAVE_PATH):
		var f: FileAccess = FileAccess.open(SAVE_PATH, FileAccess.READ)
		var d = JSON.parse_string(f.get_as_text())
		if typeof(d) == TYPE_DICTIONARY:
			wins = int(d.get("wins", 0))
			best_floor = int(d.get("best_floor", 1))
			character = str(d.get("character", "isaac"))

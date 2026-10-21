extends Node2D
## Комната подземелья: генерация этажа (BFS), враги, двери, предметы, магазин, ХП-комната.

const CELL := 32          # тайл пола/стены
const GW := 15            # ширина комнаты в тайлах
const GH := 9             # высота комнаты в тайлах
const MAP_W := 9          # размер карты этажа
const MAP_H := 7
const FLOOR_COLORS := {
	"basement": {"floor": Color(0.36, 0.29, 0.22), "floor2": Color(0.32, 0.26, 0.2), "wall": Color(0.2, 0.16, 0.13)},
	"caves": {"floor": Color(0.3, 0.28, 0.34), "floor2": Color(0.27, 0.25, 0.3), "wall": Color(0.15, 0.14, 0.19)},
	"depths": {"floor": Color(0.22, 0.26, 0.24), "floor2": Color(0.2, 0.23, 0.21), "wall": Color(0.1, 0.13, 0.12)},
}

var floor_id := "basement"
var floor_num := 1
var grid := {}            # Vector2i -> словарь комнаты
var cur := Vector2i.ZERO
var start_cell := Vector2i.ZERO
var boss_cell := Vector2i(-1, -1)
var enemies_alive := 0
var locked := false
var rocks := []
var boss_dead := false

@onready var player := $Player
@onready var walls := $Walls         # StaticBody2D с CollisionShape2D[]
@onready var map_layer := $MapLayer  # MapLayer: рисует фон комнаты (колбэк draw_map)


func _ready():
	State.reset_run()
	map_layer.cb = Callable(self, "draw_map")
	var c = State.CHARACTERS[State.character]
	State.stats["max_hp"] = int(c["hp"])
	State.stats["speed"] = float(c["speed"])
	State.stats["damage"] = float(c["damage"])
	if c["start_item"] != "":
		State.apply_item(c["start_item"])
	player.setup()
	player.died.connect(_on_player_died)
	_generate_floor()
	cur = start_cell
	_enter_room(Vector2i.ZERO, Vector2(GW * CELL / 2.0, GH * CELL / 2.0 + 40))
	_build_hud()


# ================= ГЕНЕРАЦИЯ ЭТАЖА =================

func _generate_floor():
	match floor_num:
		1: floor_id = "basement"
		2: floor_id = "caves"
		_: floor_id = "depths"
	grid.clear()
	var rng := State.rng
	var center := Vector2i(MAP_W / 2, MAP_H / 2)
	start_cell = center
	var queue := [center]
	var room_count := 0
	var target_rooms := 7 + floor_num
	grid[center] = _mkroom("start")
	while queue.size() > 0 and room_count < target_rooms:
		var cell: Vector2i = queue.pop_front()
		for d in [Vector2i.UP, Vector2i.DOWN, Vector2i.LEFT, Vector2i.RIGHT]:
			var n: Vector2i = cell + d
			if grid.has(n) or not _in_bounds(n):
				continue
			if rng.randf() < 0.35:
				continue
			room_count += 1
			var t := "normal"
			if room_count == 4:
				t = "treasure"
			elif room_count == 6:
				t = "shop"
			elif room_count == 8:
				t = "hp"
			elif room_count >= 5 and rng.randf() < 0.15:
				t = "treasure"
			grid[n] = _mkroom(t)
			queue.append(n)
	# если босс-комнаты нет — самая дальняя normal становится боссом
	var has_boss := false
	for k in grid.keys():
		if grid[k]["type"] == "boss":
			has_boss = true
	if not has_boss:
		var far := center
		var fard := -1.0
		for k in grid.keys():
			if grid[k]["type"] == "normal":
				var dd: int = absi(int(k.x) - int(center.x)) + absi(int(k.y) - int(center.y))
				if dd > fard:
					fard = dd
					far = k
		grid[far]["type"] = "boss"
	boss_cell = _find_cell("boss")
	cur = start_cell


func _find_cell(t: String):
	for k in grid.keys():
		if grid[k]["type"] == t:
			return k
	return null


func _mkroom(t: String) -> Dictionary:
	return {"type": t, "cleared": t in ["start", "treasure", "shop", "hp"],
		"visited": false, "spawned": false, "spawned_items": false}


func _in_bounds(c: Vector2i) -> bool:
	return c.x >= 0 and c.y >= 0 and c.x < MAP_W and c.y < MAP_H


# ================= ВХОД В КОМНАТУ =================

func _enter_room(from_dir := Vector2i.ZERO, entry_pos := Vector2.ZERO):
	var room: Dictionary = grid.get(cur, {})
	room["visited"] = true
	map_layer.queue_redraw()
	_clear_room_entities()
	rocks.clear()
	var pos := entry_pos
	if from_dir != Vector2i.ZERO:
		pos = _door_inner_pos(from_dir)
	player.global_position = pos
	$Camera.position = Vector2(GW * CELL / 2.0, GH * CELL / 2.0)
	_rebuild_walls()
	if not room["cleared"] and not room["spawned"]:
		room["spawned"] = true
		_spawn_room_enemies(room)
	enemies_alive = get_tree().get_nodes_in_group("enemy").size()
	locked = enemies_alive > 0
	if not room["spawned_items"]:
		room["spawned_items"] = true
		_place_room_content(room)
	_update_hud()


func _clear_room_entities():
	for g in ["enemy", "tear_p", "tear_e", "pickup", "bombs", "rock", "pedestal", "shopkeeper"]:
		for n in get_tree().get_nodes_in_group(g):
			n.queue_free()


func _rebuild_walls():
	for ch in walls.get_children():
		ch.queue_free()
	var cells := {}
	# верхние/нижние ряды стен
	for x in range(GW):
		for y in [0, 1, GH - 2, GH - 1]:
			cells[Vector2i(x, y)] = true
	# левые/правые колонки (средняя часть высоты)
	for y in range(2, GH - 2):
		for x in [0, 1, GW - 3, GW - 2]:
			cells[Vector2i(x, y)] = true
	# дверные проёмы: убираем стены в клетках двери (только внутренний слой!)
	for d in _dirs():
		if _neighbor(cur, d) != null:
			match d:
				Vector2i.UP: cells.erase(Vector2i(int(GW / 2), GH - 2))
				Vector2i.DOWN: cells.erase(Vector2i(int(GW / 2), 1))
				Vector2i.LEFT: cells.erase(Vector2i(GW - 3, int(GH / 2)))
				Vector2i.RIGHT: cells.erase(Vector2i(1, int(GH / 2)))
	for c in cells.keys():
		_add_wall_col(Vector2(c.x * CELL + CELL / 2.0, c.y * CELL + CELL / 2.0))


func _add_wall_col(pos: Vector2):
	var cs := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(CELL, CELL)
	cs.shape = rect
	cs.position = pos
	walls.add_child(cs)


# ================= КОНТЕНТ КОМНАТЫ =================

func _place_room_content(room: Dictionary):
	var mid := Vector2(GW * CELL / 2.0, GH * CELL / 2.0)
	match room["type"]:
		"treasure":
			_spawn_item_on_pedestal(mid, 0)
		"shop":
			_sprite_node("shopkeeper", 48, mid + Vector2(0, -70)).add_to_group("shopkeeper")
			_spawn_item_on_pedestal(mid + Vector2(0, 10), 3)
		"hp":
			_spawn_pickup("heart", mid + Vector2(-40, 0))
			_spawn_pickup("heart", mid + Vector2(40, 0))
			_spawn_pickup("pill", mid + Vector2(0, 40))
		"boss":
			_spawn_pickup("heart", mid + Vector2(-60, -80))
			_spawn_pickup("bomb_pickup", mid + Vector2(60, -80))
		"normal":
			if randf() < 0.35:
				_spawn_pickup(["coin", "coin", "heart", "key", "bomb_pickup"][randi() % 5],
					mid + Vector2(randf_range(-80, 80), randf_range(-60, 60)))
	var n_rock := randi_range(2, 5)
	for i in range(n_rock):
		var rp := Vector2(randf_range(3.2, GW - 4.2), randf_range(3.2, GH - 4.2)) * CELL
		if rp.distance_to(player.global_position) < 80:
			continue
		_spawn_rock(rp)


func _spawn_rock(pos: Vector2):
	var r := StaticBody2D.new()
	r.set_script(load("res://scripts/rock.gd"))
	r.position = pos
	add_child(r)
	rocks.append(r)


func _spawn_item_on_pedestal(pos: Vector2, price: int):
	_sprite_node("item_base", 40, pos).add_to_group("pedestal")
	var it := Area2D.new()
	it.set_script(load("res://scripts/item.gd"))
	it.id = State.random_item([])
	it.price = price
	it.position = pos + Vector2(0, -16)
	add_child(it)


func _spawn_pickup(kind: String, pos: Vector2):
	var pk := Area2D.new()
	pk.set_script(load("res://scripts/pickup.gd"))
	pk.kind = kind
	pk.position = pos
	add_child(pk)


func _sprite_node(key: String, sz: int, pos: Vector2) -> Sprite2D:
	var s := Sprite2D.new()
	s.texture = Art.tex(key, sz)
	s.position = pos
	add_child(s)
	return s


# ================= ВРАГИ =================

func _spawn_room_enemies(room: Dictionary):
	var rng := State.rng
	var pool: Array
	match floor_id:
		"basement": pool = ["fly", "gaper", "pacer", "spitter", "host", "fatty"]
		"caves": pool = ["fly", "gaper", "pacer", "spitter", "host", "fatty", "gaper", "pacer"]
		_: pool = ["gaper", "pacer", "spitter", "host", "fatty", "fly", "fatty", "spitter"]
	var count := 2 + mini(floor_num, 3) + rng.randi_range(0, 2)
	if room["type"] == "boss":
		var bk: String = ["boss_monstro", "boss_duke", "boss_eye"][clampi(floor_num - 1, 0, 2)]
		var b: CharacterBody2D = load("res://scenes/boss.tscn").instantiate()
		b.setup(bk, Vector2(GW * CELL / 2.0, GH * CELL / 2.0 - 30))
		b.died.connect(_on_enemy_killed)
		add_child(b)
		count = rng.randi_range(1, 2)
		pool = ["fly"]
	for i in range(count):
		var kk: String = pool[rng.randi_range(0, pool.size() - 1)]
		var e: CharacterBody2D = load("res://scenes/enemy.tscn").instantiate()
		var pos := Vector2(rng.randf_range(3.2, GW - 4.2), rng.randf_range(3.2, GH - 4.2)) * CELL
		if pos.distance_to(player.global_position) < 110:
			pos.x = GW * CELL - pos.x
		e.setup(kk, pos)
		e.died.connect(_on_enemy_killed)
		add_child(e)


func _on_enemy_killed(e: Node2D):
	enemies_alive = maxi(0, enemies_alive - 1)
	if e.is_in_group("boss"):
		boss_dead = true
		FX.popup_text(e.global_position, "Босс повержен! Ищи люк в центре", Color(1, 0.9, 0.4), 16)
		_spawn_item_on_pedestal(Vector2(GW * CELL / 2.0, GH * CELL / 2.0), 0)
	else:
		if randf() < 0.12:
			_spawn_pickup(["coin", "heart", "bomb_pickup"][randi() % 3], e.global_position)
		if State.stats["items_taken"].has("midas_touch") and randf() < 0.5:
			_spawn_pickup("coin", e.global_position)
		if float(State.stats["lifesteal"]) > 0 and randf() < float(State.stats["lifesteal"]):
			_spawn_pickup("heart", e.global_position)
	_refresh_enemies()


func _refresh_enemies():
	var cnt := 0
	for e in get_tree().get_nodes_in_group("enemy"):
		if is_instance_valid(e):
			cnt += 1
	enemies_alive = cnt
	if cnt == 0 and locked:
		_cleared()


func _cleared():
	locked = false
	grid[cur]["cleared"] = true
	FX.play("door")
	if randf() < 0.12:
		_spawn_item_on_pedestal(Vector2(GW * CELL / 2.0, GH * CELL / 2.0), 0)
	map_layer.queue_redraw()


# ================= ДВЕРИ / ПЕРЕХОДЫ =================

func _dirs() -> Array:
	return [Vector2i.UP, Vector2i.DOWN, Vector2i.LEFT, Vector2i.RIGHT]


func _neighbor(cell: Vector2i, d: Vector2i):
	var n := cell + d
	return n if grid.has(n) else null


func _door_open(d: Vector2i) -> bool:
	var n = _neighbor(cur, d)
	if n == null:
		return false
	var nr: Dictionary = grid[n]
	if nr["type"] == "boss":
		return grid[cur]["cleared"] and not boss_dead
	return true


func _door_inner_pos(d: Vector2i) -> Vector2:
	match d:
		Vector2i.UP: return Vector2(GW * CELL / 2.0, (GH - 2.6) * CELL)
		Vector2i.DOWN: return Vector2(GW * CELL / 2.0, 2.6 * CELL)
		Vector2i.LEFT: return Vector2((GW - 2.6) * CELL, GH * CELL / 2.0)
		_: return Vector2(2.6 * CELL, GH * CELL / 2.0)


func _door_center(d: Vector2i) -> Vector2:
	match d:
		Vector2i.UP: return Vector2(GW * CELL / 2.0, CELL * 1.0)
		Vector2i.DOWN: return Vector2(GW * CELL / 2.0, (GH - 1.0) * CELL)
		Vector2i.LEFT: return Vector2(CELL * 1.0, GH * CELL / 2.0)
		_: return Vector2((GW - 1.0) * CELL, GH * CELL / 2.0)


func _try_leave():
	if player.dead:
		return
	for d in _dirs():
		var n = _neighbor(cur, d)
		if n == null:
			continue
		var dp := _door_inner_pos(d)
		if player.global_position.distance_to(dp) < 30 and _door_open(d):
			cur = n
			FX.play("door")
			_enter_room(-d)
			return
	if grid[cur].get("type", "") == "boss" and boss_dead:
		if player.global_position.distance_to(Vector2(GW * CELL / 2.0, GH * CELL / 2.0)) < 34:
			_next_floor()


func _next_floor():
	floor_num += 1
	if floor_num > 3:
		_win()
		return
	boss_dead = false
	State.best_floor = maxi(State.best_floor, floor_num)
	State.save_meta()
	FX.play("button")
	FX.popup_text(player.global_position, "СПУСК НА ЭТАЖ %d..." % floor_num, Color(1, 1, 0.6), 16)
	await get_tree().create_timer(0.5).timeout
	_generate_floor()
	cur = start_cell
	_enter_room(Vector2i.ZERO, Vector2(GW * CELL / 2.0, GH * CELL / 2.0 + 40))


func _win():
	State.wins += 1
	State.save_meta()
	get_tree().change_scene_to_file("res://scenes/win.tscn")


func _on_player_died():
	await get_tree().create_timer(1.2).timeout
	get_tree().change_scene_to_file("res://scenes/gameover.tscn")


# ================= ЦИКЛ / HUD =================

var hud: CanvasLayer
var hearts_label: Label
var stats_label: Label
var item_label: Label
var pause_lbl: Label


func _build_hud():
	hud = CanvasLayer.new()
	add_child(hud)
	hearts_label = Label.new()
	hearts_label.position = Vector2(14, 8)
	hearts_label.add_theme_font_size_override("font_size", 26)
	hud.add_child(hearts_label)
	stats_label = Label.new()
	stats_label.position = Vector2(14, 44)
	stats_label.add_theme_font_size_override("font_size", 13)
	stats_label.modulate = Color(0.9, 0.9, 0.9, 0.85)
	hud.add_child(stats_label)
	item_label = Label.new()
	item_label.position = Vector2(14, 66)
	item_label.add_theme_font_size_override("font_size", 13)
	item_label.modulate = Color(0.7, 0.9, 1.0)
	hud.add_child(item_label)
	var hint := Label.new()
	hint.text = "WASD ход · Стрелки огонь · E бомба · Q предмет · M пауза"
	hint.position = Vector2(250, 512)
	hint.add_theme_font_size_override("font_size", 12)
	hint.modulate = Color(0.6, 0.6, 0.65)
	hud.add_child(hint)
	_update_hud()


func _update_hud():
	if hearts_label == null:
		return
	var full := int(player.hp / 2.0)
	var half: int = player.hp % 2
	var s := ""
	for i in range(full):
		s += "♥"
	if half == 1:
		s += "◐"
	hearts_label.text = s
	hearts_label.add_theme_color_override("font_outline_color", Color(0, 0, 0))
	hearts_label.add_theme_constant_override("outline_size", 6)
	hearts_label.add_theme_color_override("font_color", Color(0.95, 0.25, 0.3))
	stats_label.text = "Монеты: %d   Ключи: %d   Бомбы: %d   Этаж %d/3   Урон %.1f" % [
		State.stats["coins"], State.stats["keys"], State.stats["bomb_count"],
		floor_num, State.stats["damage"]]
	if State.active_item != "":
		var ready := State.active_cooldown <= 0.0
		item_label.text = "[Q] %s: %s" % [State.ITEMS[State.active_item]["name"],
			"ГОТОВ" if ready else "%.1fс" % State.active_cooldown]
	else:
		item_label.text = "Предметов собрано: %d" % State.stats["items_taken"].size()


func _process(_delta):
	_update_hud()
	_try_leave()
	if Input.is_action_just_pressed("pause_map"):
		if pause_lbl:
			pause_lbl.get_parent().queue_free()
			pause_lbl = null
			get_tree().paused = false
		else:
			var cl := CanvasLayer.new()
			cl.layer = 60
			cl.process_mode = Node.PROCESS_MODE_ALWAYS
			add_child(cl)
			pause_lbl = Label.new()
			pause_lbl.text = "ПАУЗА\nM — продолжить"
			pause_lbl.position = Vector2(380, 220)
			pause_lbl.add_theme_font_size_override("font_size", 28)
			cl.add_child(pause_lbl)
			get_tree().paused = true


# ================= РИСОВАНИЕ ФОНА =================

func draw_map(li: CanvasItem):
	var fc = FLOOR_COLORS[floor_id]
	li.draw_rect(Rect2(-100, -100, GW * CELL + 200, GH * CELL + 200), Color(0.05, 0.04, 0.05))
	for y in range(2, GH - 2):
		for x in range(2, GW - 2):
			var col: Color = fc["floor"] if (x + y) % 2 == 0 else fc["floor2"]
			li.draw_rect(Rect2(x * CELL, y * CELL, CELL, CELL), col)
	for y in range(GH):
		for x in range(GW):
			var wall: bool = not (x > 1 and x < GW - 2 and y > 1 and y < GH - 2)
			if wall:
				var wcol: Color = fc["wall"] if (x + y) % 2 == 0 else fc["wall"].lightened(0.08)
				li.draw_rect(Rect2(x * CELL, y * CELL, CELL, CELL), wcol)
				li.draw_rect(Rect2(x * CELL, y * CELL, CELL, 3), wcol.lightened(0.15))
	for d in _dirs():
		if _neighbor(cur, d) != null:
			var open := _door_open(d)
			li.draw_texture(Art.tex("door_open" if open else "door_closed", 32),
				_door_center(d) - Vector2(16, 16))
	if grid[cur].get("type", "") == "boss" and boss_dead:
		li.draw_texture(Art.tex("trapdoor", 44), Vector2(GW * CELL / 2.0 - 22, GH * CELL / 2.0 - 22))
	_draw_minimap(li)


func _draw_minimap(li: CanvasItem):
	var ox := 700
	var oy := 14
	var csz := 13
	li.draw_rect(Rect2(ox - 5, oy - 5, MAP_W * (csz + 2) + 10, MAP_H * (csz + 2) + 10), Color(0, 0, 0, 0.55))
	for k in grid.keys():
		var r: Dictionary = grid[k]
		if not r["visited"]:
			continue
		var col := Color(0.75, 0.7, 0.6)
		match r["type"]:
			"boss": col = Color(0.9, 0.3, 0.3)
			"treasure": col = Color(0.95, 0.85, 0.3)
			"shop": col = Color(0.4, 0.8, 0.95)
			"hp": col = Color(0.95, 0.5, 0.6)
		var px: float = ox + k.x * (csz + 2)
		var py: float = oy + k.y * (csz + 2)
		li.draw_rect(Rect2(px, py, csz, csz), col)
		if k == cur:
			li.draw_rect(Rect2(px - 2, py - 2, csz + 4, csz + 4), Color.WHITE, false, 2.0)

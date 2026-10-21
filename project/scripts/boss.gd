extends CharacterBody2D
## Боссы с паттернами атак. kind: boss_monstro / boss_duke / boss_eye.

signal died(enemy: Node2D)

var hp := 200.0
var max_hp := 200.0
var kind := "boss_monstro"
var t := 0.0
var state_t := 0.0
var attack_i := 0
var flash := 0.0
var jump_target := Vector2.ZERO
var jumping := false
var jump_progress := 0.0
var shadow_scale := 1.0
@onready var spr := $Sprite2D


func setup(k: String, at: Vector2):
	kind = k
	global_position = at
	add_to_group("enemy")
	add_to_group("boss")
	match kind:
		"boss_monstro":
			hp = 240; max_hp = 240
			spr.texture = Art.tex("boss_monstro", 96)
		"boss_duke":
			hp = 200; max_hp = 200
			spr.texture = Art.tex("boss_duke", 80)
		"boss_eye":
			hp = 260; max_hp = 260
			spr.texture = Art.tex("boss_eye", 80)
	FX.play("boss_roar")


func _physics_process(delta):
	t += delta
	state_t += delta
	var player := get_tree().get_first_node_in_group("player")
	if not player:
		return
	if flash > 0:
		flash -= delta
		spr.modulate = Color(1, 0.5, 0.5)
	else:
		spr.modulate = Color.WHITE
	match kind:
		"boss_monstro": _monstro(delta, player)
		"boss_duke": _duke(delta, player)
		"boss_eye": _eye(delta, player)


# ---------- Монстро: прыжки на игрока + залпы слёз ----------

func _monstro(delta: float, player):
	if jumping:
		jump_progress += delta * 1.6
		var p := clampf(jump_progress, 0, 1)
		global_position = global_position.lerp(jump_target, delta * 6.0)
		spr.scale = Vector2.ONE * (1.0 + sin(p * PI) * 0.35)
		velocity = Vector2.ZERO
		if p >= 1.0:
			jumping = false
			spr.scale = Vector2.ONE
			FX.shake(9)
			FX.spawn_particles(global_position, Color(0.6, 0.4, 0.3), 14, 200)
			# ударная волна — кольцо слёз
			for i in range(12):
				_shoot_ring(Vector2.from_angle(TAU * i / 12.0), 240)
		return
	if state_t > 2.4:
		state_t = 0
		attack_i += 1
		if attack_i % 3 == 0:
			# прыжок
			jumping = true
			jump_progress = 0
			jump_target = player.global_position
			FX.play("enemy_shoot")
		else:
			# залп веером
			for i in range(7):
				_shoot_ring(Vector2.from_angle(-PI / 2 + (i - 3) * 0.28), 220)
			FX.play("enemy_shoot")


# ---------- Герцог мух: спавнит мух + плюёт роем ----------

func _duke(delta: float, player):
	velocity = (player.global_position - global_position).normalized() * 40
	move_and_slide()
	spr.flip_h = velocity.x < 0
	spr.position.y = sin(t * 3.0) * 3
	if state_t > 3.0:
		state_t = 0
		attack_i += 1
		if attack_i % 2 == 0:
			# рой: 4 мухи-снаряда по кругу
			for i in range(4):
				_shoot_ring(Vector2.from_angle(TAU * i / 4.0 + t), 170)
		else:
			_spawn_minion(player)
		FX.play("enemy_shoot")


func _spawn_minion(player):
	var e: CharacterBody2D = load("res://scenes/enemy.tscn").instantiate()
	e.setup("fly", global_position + Vector2(randf_range(-30, 30), randf_range(-30, 30)))
	e.hp = 5
	get_parent().add_child(e)
	e.died.connect(_on_minion_died)
	minions_alive += 1
	_check_room_state_deferred()


var minions_alive := 0


func _on_minion_died(_e):
	minions_alive -= 1


func _check_room_state_deferred():
	var room := get_parent().get_parent()
	if room and room.has_method("_refresh_enemies"):
		Callable(room, "_refresh_enemies").call_deferred()


# ---------- Гнилой глаз: телепорты, лазер-лучи, самонаводящиеся слёзы ----------

var teleporting := 0.0
var aim_lines := 0.0


func _eye(delta: float, player):
	if teleporting > 0:
		teleporting -= delta
		spr.modulate.a = 0.3 if int(teleporting * 15) % 2 == 0 else 0.8
		if teleporting <= 0:
			global_position = jump_target
			spr.modulate.a = 1.0
	elif aim_lines > 0:
		aim_lines -= delta
		velocity = Vector2.ZERO
		queue_redraw()
		if aim_lines <= 0:
			# выстрел лучами в намеченные направления
			for i in range(8):
				_shoot_ring(Vector2.from_angle(TAU * i / 8.0 + t), 330)
			FX.play("enemy_shoot")
			FX.shake(5)
	else:
		velocity = Vector2.ZERO
		if state_t > 3.2:
			state_t = 0
			attack_i += 1
			if attack_i % 3 == 0:
				teleporting = 0.6
				jump_target = player.global_position + Vector2(randf_range(-140, 140), randf_range(-100, 100))
			else:
				aim_lines = 0.8  # предупреждение-прицел
				FX.play("pill")
		# периодические самонаводящиеся слёзы
		if fmod(state_t, 1.6) < delta:
			var d: Vector2 = (player.global_position - global_position).normalized()
			spawn_enemy_tear(d, 200)


func _draw():
	if kind == "boss_eye" and aim_lines > 0:
		var a := clampf(aim_lines / 0.8, 0, 1)
		for i in range(8):
			var dir := Vector2.from_angle(TAU * i / 8.0 + t)
			draw_line(Vector2.ZERO, dir * 700.0, Color(1, 0.3, 0.3, 0.35 * (1.0 - a)), 3.0)


func _shoot_ring(dir: Vector2, spd: float):
	spawn_enemy_tear(dir, spd)


func spawn_enemy_tear(dir: Vector2, spd := 240.0):
	var tt: Area2D = load("res://scenes/enemy_tear.tscn").instantiate()
	tt.global_position = global_position + dir * 24.0
	tt.setup(dir, spd, 1)
	get_parent().add_child(tt)


func take_damage(amount: float, _from := Vector2.INF):
	hp -= amount
	flash = 0.1
	if hp <= 0:
		die()


func die():
	FX.play("death")
	FX.shake(14)
	FX.spawn_particles(global_position, Color(0.8, 0.2, 0.3), 40, 300, 6)
	died.emit(self)
	queue_free()

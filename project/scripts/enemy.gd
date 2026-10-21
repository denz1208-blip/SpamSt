extends CharacterBody2D
## Базовый враг. Тип задаётся через setup(type_id). Поведения: chase/float/shooter/host/boss.

signal died(enemy: Node2D)

var hp := 10.0
var max_hp := 10.0
var kind := "fly"
var speed := 60.0
var touch_dmg := 1
var shoot_timer := 1.5
var phase := 0.0
var flash := 0.0
var sprite_size := 32
var body_color := Color.WHITE
var is_boss := false

@onready var spr := $Sprite2D


func setup(type_id: String, at: Vector2):
	kind = type_id
	global_position = at
	add_to_group("enemy")
	match kind:
		"fly":
			hp = 7; speed = 85; sprite_size = 24
		"gaper":
			hp = 14; speed = 95; sprite_size = 36
		"pacer":
			hp = 12; speed = 55; sprite_size = 32
		"spitter":
			hp = 12; speed = 30; sprite_size = 32
		"host":
			hp = 10; speed = 0; sprite_size = 32
		"fatty":
			hp = 30; speed = 45; sprite_size = 44
		"boss_monstro":
			hp = 220; speed = 0; sprite_size = 96; is_boss = true; touch_dmg = 1
		"boss_duke":
			hp = 180; speed = 40; sprite_size = 80; is_boss = true
		"boss_eye":
			hp = 240; speed = 110; sprite_size = 80; is_boss = true
	spr.texture = Art.tex(kind, sprite_size)
	phase = randf() * TAU
	if is_boss:
		FX.play("boss_roar")


func _physics_process(delta):
	var player := get_tree().get_first_node_in_group("player")
	if flash > 0:
		flash -= delta
		spr.modulate = Color(1, 0.6, 0.6) if int(flash * 20) % 2 == 0 else Color.WHITE
	else:
		spr.modulate = Color.WHITE
	_behavior(delta, player)


func _behavior(delta: float, player):
	match kind:
		"fly":
			# хаотичный полёт + лёгкое притяжение к игроку
			velocity = (Vector2(sin(phase + Time.get_ticks_msec() / 1000.0 * 3.0), cos(phase * 1.7 + Time.get_ticks_msec() / 1000.0 * 2.2)) * 0.7
				+ ((player.global_position - global_position).normalized() * 0.45 if player else Vector2.ZERO)) * speed
			move_and_slide()
		"gaper", "fatty":
			if player:
				var d: Vector2 = (player.global_position - global_position).normalized()
				velocity = velocity.lerp(d * speed, delta * 3.0)
				spr.flip_h = d.x < 0
			move_and_slide()
		"pacer":
			# мечется между стенами
			if velocity.length_squared() < 100 or _hit_wall():
				velocity = Vector2.from_angle(randf() * TAU) * speed
			move_and_slide()
		"spitter":
			if player:
				var d: Vector2 = player.global_position - global_position
				velocity = d.normalized() * speed * (0.6 if d.length() < 260 else -0.3)
				move_and_slide()
				shoot_timer -= delta
				if shoot_timer <= 0:
					shoot_timer = 1.8 + randf()
					_shoot_at(d.normalized())
		"host":
			if player and global_position.distance_to(player.global_position) < 90:
				_shoot_at((player.global_position - global_position).normalized(), 3)
				shoot_timer -= delta
				if shoot_timer <= 0:
					shoot_timer = 2.2
		_:
			pass


func _hit_wall() -> bool:
	return get_slide_collision_count() > 0


func _shoot_at(dir: Vector2, count := 1):
	for i in range(count):
		var ang := dir.angle() + (i - (count - 1) / 2.0) * 0.25
		spawn_enemy_tear(Vector2.from_angle(ang))
	FX.play("enemy_shoot")


func spawn_enemy_tear(dir: Vector2, spd := 260.0):
	var t: Area2D = load("res://scenes/enemy_tear.tscn").instantiate()
	t.global_position = global_position + dir * 16.0
	t.setup(dir, spd, dmg_for_player())
	get_parent().add_child(t)


func dmg_for_player() -> int:
	return 1


func take_damage(amount: float, _from := Vector2.INF):
	if amount <= 0:
		return
	hp -= amount
	flash = 0.15
	if not is_boss:
		FX.spawn_particles(global_position, Color(0.8, 0.2, 0.25), 4, 100, 3)
	if hp <= 0:
		die()


func die():
	FX.play("death", 0.2)
	FX.spawn_particles(global_position, Color(0.7, 0.2, 0.3), 14, 180, 4)
	died.emit(self)
	queue_free()

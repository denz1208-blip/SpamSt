extends Area2D
## Слёзы игрока: полёт, самонаведение, пронзание, рост урона.

var dir := Vector2.DOWN
var speed := 430.0
var dmg := 3.5
var life := 1.2
var pierce := 0
var homing := false
var growth := false
var shooter: Node2D = null
var hit_list := []


func setup(d: Vector2, owner_node: Node2D):
	dir = d
	shooter = owner_node
	var s = State.stats
	speed = float(s["tear_speed"])
	dmg = float(s["damage"])
	life = float(s["range"]) / maxf(speed, 1.0) * 1.35
	pierce = int(s["piercing"])
	homing = bool(s["homing"])
	growth = bool(s["growth"])
	var sz := 14.0 * (0.8 + float(s["tear_size"]))
	scale = Vector2(sz / 14.0, sz / 14.0)
	$CollisionShape.shape = CircleShape2D.new()
	$CollisionShape.shape.radius = sz * 0.45
	var key := "tear"
	if homing:
		key = "tear_homing"
	elif pierce > 0:
		key = "tear_triple"
	$Sprite2D.texture = Art.tex(key, 16)
	body_entered.connect(_on_hit)
	area_entered.connect(_on_area_hit)


func _physics_process(delta):
	position += dir * speed * delta
	if growth:
		dmg += delta * 2.0
		scale = scale.lerp(scale * 1.01, delta * 2.0)
	if homing:
		var best: Node2D = null
		var bd := 260.0
		for e in get_tree().get_nodes_in_group("enemy"):
			var ed := global_position.distance_to(e.global_position)
			if ed < bd:
				bd = ed
				best = e
		if best:
			var want := (best.global_position - global_position).normalized()
			dir = dir.lerp(want, delta * 7.0).normalized()
	life -= delta
	if life <= 0:
		splat()


func _on_hit(body):
	if body == shooter or not body.is_in_group("enemy"):
		return
	_apply_to(body)


func _on_area_hit(area):
	if area.is_in_group("hurtable_wall") or area.is_in_group("destructible"):
		splat()


func _apply_to(body):
	if body in hit_list:
		return
	hit_list.append(body)
	if body.has_method("take_damage"):
		body.take_damage(dmg, global_position)
	if shooter and shooter.has_method("on_tear_hit"):
		shooter.on_tear_hit(body)
	FX.play("hit", 0.15)
	FX.spawn_particles(global_position, Color(0.7, 0.85, 1.0), 4, 90, 3)
	if pierce > 0:
		pierce -= 1
	else:
		splat()


func splat():
	FX.spawn_particles(global_position, Color(0.6, 0.8, 1.0, 0.8), 3, 60, 3)
	queue_free()

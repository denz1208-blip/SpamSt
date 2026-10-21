extends Area2D
## Снаряд врага.

var dir := Vector2.UP
var speed := 260.0
var dmg := 1
var life := 3.0


func setup(d: Vector2, spd: float, damage: int):
	dir = d.normalized()
	speed = spd
	dmg = damage
	life = 520.0 / maxf(spd, 1.0)
	$Sprite2D.texture = Art.tex("enemy_tear", 14)
	body_entered.connect(_on_body)


func _physics_process(delta):
	position += dir * speed * delta
	life -= delta
	if life <= 0:
		queue_free()


func _on_body(body):
	if body.is_in_group("player"):
		body.take_damage(dmg, global_position)
		FX.spawn_particles(global_position, Color(0.9, 0.3, 0.4), 5, 100)
		queue_free()

extends StaticBody2D
## Камень-препятствие: разрушается бомбой, блокирует слёзы и врагов.

var hp := 1.0


func _ready():
	add_to_group("rock")
	add_to_group("destructible")
	$Sprite2D.texture = Art.tex("rock", 28)


func take_damage(amount: float, _from := Vector2.INF):
	hp -= amount
	if hp <= 0:
		destroy()


func destroy_by_bomb():
	destroy()


func destroy():
	FX.spawn_particles(global_position, Color(0.5, 0.45, 0.4), 10, 140, 4)
	FX.play("hit", 0.3)
	var room := get_parent()
	if room.has_method("rocks"):
		room.rocks.erase(self)
	queue_free()
	# иногда из камня выпадает лут
	if randf() < 0.25:
		var pk := Area2D.new()
		pk.set_script(load("res://scripts/pickup.gd"))
		pk.kind = ["coin", "bomb_pickup", "heart"][randi() % 3]
		pk.position = global_position
		get_parent().add_child.call_deferred(pk)

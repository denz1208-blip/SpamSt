extends StaticBody2D
## Бомба: стоит на месте, детонация по таймеру или от взрыва другой бомбы.

var fuse := 1.6
var radius := 95.0
var dmg := 60.0


func _ready():
	add_to_group("bombs")
	$Sprite2D.texture = Art.tex("bomb_entity", 24)


func _physics_process(delta):
	fuse -= delta
	var t := 1.0 - clampf(fuse / 1.6, 0, 1)
	$Sprite2D.scale = Vector2.ONE * (1.0 + sin(t * PI * (4.0 + t * 10.0)) * 0.12 * t)
	if fuse <= 0:
		explode()


func explode():
	FX.play("explode")
	FX.shake(8)
	FX.spawn_particles(global_position, Color(1, 0.7, 0.2), 20, 260, 5)
	FX.spawn_particles(global_position, Color(0.3, 0.3, 0.3), 12, 150, 6)
	var space := get_world_2d().direct_space_state
	# урон врагам
	for e in get_tree().get_nodes_in_group("enemy"):
		if global_position.distance_to(e.global_position) < radius and e.has_method("take_damage"):
			e.take_damage(dmg, global_position)
	# цепные детонации других бомб
	for b in get_tree().get_nodes_in_group("bombs"):
		if b != self and global_position.distance_to(b.global_position) < radius:
			b.fuse = minf(b.fuse, 0.12)
	# разрушение камней
	for rock in get_tree().get_nodes_in_group("destructible"):
		if global_position.distance_to(rock.global_position) < radius:
			rock.destroy_by_bomb()
	queue_free()

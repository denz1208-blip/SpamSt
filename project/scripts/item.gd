extends Area2D
## Предмет на постаменте (пассивный или активный). В магазине — за монеты.

var id := ""
var price := 0


func _ready():
	add_to_group("pickup")
	var info = State.ITEMS[id]
	var sp := Sprite2D.new()
	sp.texture = Art.tex("item_orb", 26)
	sp.modulate = Color(1, 0.95, 0.7) if info["pool"] == "passive" else Color(0.7, 0.85, 1.0)
	add_child(sp)
	var cs := CollisionShape2D.new()
	var c := CircleShape2D.new()
	c.radius = 14
	cs.shape = c
	add_child(cs)
	body_entered.connect(_on_body)
	# метка цены в магазине
	if price > 0:
		var lb := Label.new()
		lb.text = "%d¢" % price
		lb.position = Vector2(-12, 12)
		lb.add_theme_font_size_override("font_size", 12)
		lb.modulate = Color(1, 0.9, 0.4)
		add_child(lb)
	# парение
	var tw := create_tween().set_loops()
	tw.tween_property(sp, "position:y", -6, 0.9).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	tw.tween_property(sp, "position:y", 0, 0.9).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)


func _process(_delta):
	rotation = 0  # не вращаем, только орб парит


func _on_body(body):
	if not body.is_in_group("player"):
		return
	if price > 0 and int(State.stats["coins"]) < price:
		FX.popup_text(global_position, "НУЖНО %d МОНЕТ" % price, Color(1, 0.8, 0.3), 12)
		return
	if price > 0:
		State.stats["coins"] -= price
	State.apply_item(id)
	var info = State.ITEMS[id]
	FX.play("item")
	FX.popup_text(global_position, info["name"].to_upper(), Color(1, 0.95, 0.6), 16)
	FX.popup_text(global_position + Vector2(0, 20), info["desc"], Color(0.9, 0.9, 0.9), 11)
	FX.spawn_particles(global_position, Color(1, 1, 0.7), 16, 150)
	body.fix_scale()
	queue_free()

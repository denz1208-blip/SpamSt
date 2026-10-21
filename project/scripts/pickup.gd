extends Area2D
## Подбираемые предметы: монета, сердце, душа-сердце, ключ, бомба, пилюля.

var kind := "coin"


func _ready():
	add_to_group("pickup")
	$Sprite2D.texture = Art.tex(kind if kind != "heart_soul" else "heart_soul", 24)
	body_entered.connect(_on_body)
	if kind == "pill":
		$Sprite2D.texture = Art.tex("pill", 24)


func _process(delta):
	$Sprite2D.position.y = sin(Time.get_ticks_msec() / 1000.0 * 3.0 + position.x) * 2.5


func _on_body(body):
	if not body.is_in_group("player"):
		return
	if kind == "pill":
		_use_pill(body)
	else:
		body.on_pickup(kind)
		FX.popup_text(global_position, "+ " + kind.to_upper(), Color(1, 1, 0.8), 11)
	queue_free()


func _use_pill(player):
	var eff = State.PILL_EFFECTS[randi() % State.PILL_EFFECTS.size()]
	FX.play("pill")
	FX.popup_text(global_position, eff["text"], Color(0.8, 1.0, 0.8), 13)
	match eff["key"]:
		"speed":
			State.stats["speed"] += 30
		"overdose":
			player.take_damage(2, Vector2.INF)
		"maxhp":
			State.stats["max_hp"] += 2
			player.heal(2)
		"dmgdown":
			State.stats["damage"] = maxf(1.0, State.stats["damage"] - 0.8)
		"dmgup":
			State.stats["damage"] += 1.5
		"homing":
			State.stats["homing"] = true
		"bombs":
			State.stats["bomb_count"] += 3
		"coins":
			State.stats["coins"] += 5
		"heal":
			player.heal(99)

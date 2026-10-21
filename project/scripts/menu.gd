extends Control
## Главное меню: выбор персонажа, старт, справка.

var sel := 0
var keys := ["isaac", "maggy", "cain"]


func _ready():
	# фон
	var bg := ColorRect.new()
	bg.color = Color(0.07, 0.05, 0.09)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	for i in range(40):
		var r := ColorRect.new()
		r.color = Color(1, 1, 1, randf_range(0.02, 0.06))
		r.size = Vector2(randf_range(2, 6), randf_range(2, 6))
		r.position = Vector2(randf() * 960, randf() * 540)
		add_child(r)

	_build_ui()


var char_btns := {}


func _build_ui():
	var title := Label.new()
	title.text = "СЛЕЗА БЕЗДНЫ"
	title.add_theme_font_size_override("font_size", 64)
	title.add_theme_color_override("font_color", Color(0.95, 0.85, 0.6))
	title.add_theme_color_override("font_outline_color", Color(0.1, 0.05, 0.05))
	title.add_theme_constant_override("outline_size", 12)
	title.position = Vector2(0, 30)
	title.size = Vector2(960, 80)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(title)

	var sub := Label.new()
	sub.text = "рогалик в духе The Binding of Isaac · Godot 4"
	sub.add_theme_font_size_override("font_size", 15)
	sub.modulate = Color(0.7, 0.65, 0.75)
	sub.position = Vector2(0, 100)
	sub.size = Vector2(960, 24)
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(sub)

	# персонажи
	var box := HBoxContainer.new()
	box.position = Vector2(140, 170)
	box.add_theme_constant_override("separation", 30)
	add_child(box)
	for k in keys:
		var c = State.CHARACTERS[k]
		var b := Button.new()
		b.custom_minimum_size = Vector2(200, 190)
		var icon := TextureRect.new()
		icon.texture = Art.tex(c["sprite"], 64)
		icon.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
		icon.custom_minimum_size = Vector2(200, 90)
		var vb := VBoxContainer.new()
		vb.add_child(icon)
		var lbl := Label.new()
		lbl.text = "%s\n%s" % [c["name"].to_upper(), c["desc"]]
		lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		lbl.add_theme_font_size_override("font_size", 12)
		vb.add_child(lbl)
		var st := Label.new()
		st.text = "♥ %d   DMG %.1f   SPD %d" % [c["hp"] / 2, c["damage"], c["speed"]]
		st.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		st.add_theme_font_size_override("font_size", 12)
		st.modulate = Color(1, 0.8, 0.5)
		vb.add_child(st)
		b.add_child(vb)
		b.pressed.connect(_select.bind(k, b))
		box.add_child(b)
		if k == State.character:
			sel_box = b
			b.modulate = Color(1, 0.95, 0.6)

	# кнопки снизу
	var start := Button.new()
	start.text = "▶  НАЧАТЬ ЗАБЕГ  (Enter)"
	start.position = Vector2(330, 400)
	start.custom_minimum_size = Vector2(300, 46)
	start.add_theme_font_size_override("font_size", 18)
	start.pressed.connect(_start)
	add_child(start)

	var help := Button.new()
	help.text = "?  УПРАВЛЕНИЕ"
	help.position = Vector2(330, 455)
	help.custom_minimum_size = Vector2(140, 34)
	help.pressed.connect(_toggle_help)
	add_child(help)

	var info := Label.new()
	info.text = "Рекорд: этаж %d   Побегов завершено: %d" % [State.best_floor, State.wins]
	info.position = Vector2(500, 462)
	info.add_theme_font_size_override("font_size", 13)
	info.modulate = Color(0.7, 0.7, 0.8)
	add_child(info)

	ver_label = Label.new()
	ver_label.position = Vector2(14, 512)
	ver_label.add_theme_font_size_override("font_size", 12)
	ver_label.modulate = Color(0.55, 0.6, 0.55)
	ver_label.text = "v" + Updater.VERSION
	add_child(ver_label)
	Updater.check.call_deferred(_on_update_info)

	help_panel = Panel.new()
	help_panel.visible = false
	help_panel.position = Vector2(230, 130)
	help_panel.size = Vector2(500, 300)
	help_panel.z_index = 10
	var hl := Label.new()
	hl.text = """УПРАВЛЕНИЕ:
  WASD — движение
  ← ↑ → ↓ — стрелять слезами (8 направлений не скомпануем, но 4!)
  E — поставить бомбу
  Q — использовать активный предмет
  M — пауза

ЦЕЛЬ: пробиться через 3 этажа (Подвал → Пещеры → Глубины),
победить боссов и найти выход из Бездны.

В монстр-комнатах двери запираются до зачистки.
Бомбы взрывают камни — там часто лежит лут.
Магазин (синяя комната на карте) продаёт предметы за монеты."""
	hl.position = Vector2(16, 12)
	hl.add_theme_font_size_override("font_size", 13)
	help_panel.add_child(hl)
	add_child(help_panel)


var sel_box: Button
var help_panel: Panel
var ver_label: Label


func _on_update_info(has_update: bool, msg: String):
	if has_update:
		ver_label.text = msg + "  — обнови страницу!"
		ver_label.modulate = Color(0.4, 1, 0.5)


func _select(k: String, b: Button):
	State.character = k
	State.save_meta()
	for c in get_tree().get_nodes_in_group("charbtn"):
		c.modulate = Color.WHITE
	b.modulate = Color(1, 0.95, 0.6)
	FX.play("menu")


func _toggle_help():
	help_panel.visible = not help_panel.visible
	FX.play("menu")


func _start():
	FX.play("door")
	State.run_seed = randi()
	get_tree().change_scene_to_file("res://scenes/room.tscn")


func _unhandled_input(event):
	if event is InputEventKey and event.pressed:
		if event.keycode == KEY_ENTER or event.keycode == KEY_SPACE:
			_start()
		elif event.keycode == KEY_LEFT:
			sel = posmod(sel - 1, keys.size())
			_press_char(keys[sel])
		elif event.keycode == KEY_RIGHT:
			sel = posmod(sel + 1, keys.size())
			_press_char(keys[sel])


func _press_char(k: String):
	State.character = k
	State.save_meta()
	# подсветка нужной кнопки
	var box := get_child(get_child_count() - 6)
	pass

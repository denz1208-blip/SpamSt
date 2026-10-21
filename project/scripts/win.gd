extends Control
## Экран победы.

func _ready():
	var bg := ColorRect.new()
	bg.color = Color(0.05, 0.08, 0.12)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	for i in range(60):
		var r := ColorRect.new()
		r.color = Color(1, 0.95, 0.6, randf_range(0.1, 0.5))
		r.size = Vector2(randf_range(2, 5), randf_range(2, 5))
		r.position = Vector2(randf() * 960, randf() * 540)
		add_child(r)
	var t := Label.new()
	t.text = "ТЫ ВЫБРАЛСЯ ИЗ БЕЗДНЫ!"
	t.add_theme_font_size_override("font_size", 46)
	t.add_theme_color_override("font_color", Color(1, 0.92, 0.5))
	t.position = Vector2(0, 130)
	t.size = Vector2(960, 70)
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(t)
	var s := Label.new()
	s.text = "Все 3 этажа пройдены.\nПредметов собрано за забег: %d\nВсего побед: %d" % [
		State.stats["items_taken"].size(), State.wins]
	s.add_theme_font_size_override("font_size", 18)
	s.modulate = Color(0.85, 0.85, 0.9)
	s.position = Vector2(0, 220)
	s.size = Vector2(960, 90)
	s.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(s)
	var again := Button.new()
	again.text = "НОВЫЙ ЗАБЕГ"
	again.position = Vector2(330, 350)
	again.custom_minimum_size = Vector2(300, 46)
	again.add_theme_font_size_override("font_size", 18)
	again.pressed.connect(func():
		State.run_seed = randi()
		get_tree().change_scene_to_file("res://scenes/room.tscn"))
	add_child(again)
	var menu := Button.new()
	menu.text = "В МЕНЮ"
	menu.position = Vector2(330, 410)
	menu.custom_minimum_size = Vector2(300, 40)
	menu.pressed.connect(func(): get_tree().change_scene_to_file("res://scenes/menu.tscn"))
	add_child(menu)

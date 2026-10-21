extends Control
## Экран смерти (Game Over).

func _ready():
	var bg := ColorRect.new()
	bg.color = Color(0.12, 0.03, 0.04)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	var t := Label.new()
	t.text = "ТЫ ПАЛ В БЕЗДНЕ"
	t.add_theme_font_size_override("font_size", 52)
	t.add_theme_color_override("font_color", Color(0.9, 0.25, 0.3))
	t.position = Vector2(0, 120)
	t.size = Vector2(960, 70)
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(t)
	var s := Label.new()
	s.text = "Этаж: %d    Предметов собрано: %d\nРекорд глубины: %d" % [
		get_parent().floor_num if get_parent() is Node else 1,
		State.stats["items_taken"].size(), State.best_floor]
	s.add_theme_font_size_override("font_size", 18)
	s.modulate = Color(0.8, 0.7, 0.7)
	s.position = Vector2(0, 220)
	s.size = Vector2(960, 70)
	s.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(s)
	var again := Button.new()
	again.text = "ЕЩЁ РАЗ"
	again.position = Vector2(330, 330)
	again.custom_minimum_size = Vector2(300, 46)
	again.add_theme_font_size_override("font_size", 18)
	again.pressed.connect(func():
		State.run_seed = randi()
		get_tree().change_scene_to_file("res://scenes/room.tscn"))
	add_child(again)
	var menu := Button.new()
	menu.text = "В МЕНЮ"
	menu.position = Vector2(330, 390)
	menu.custom_minimum_size = Vector2(300, 40)
	menu.pressed.connect(func(): get_tree().change_scene_to_file("res://scenes/menu.tscn"))
	add_child(menu)

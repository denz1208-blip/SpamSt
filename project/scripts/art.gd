class_name Art
## Процедурная генерация всей пиксельной графики игры.
## Возвращает ImageTexture с linear-фильтрацией (для плавного масштабирования).

const TILE := 32

static var _cache := {}


static func tex(key: String, sz: int) -> ImageTexture:
	if _cache.has(key):
		return _cache[key]
	var img := Image.create(sz, sz, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	_drawers[key].call(img, sz)
	var t := ImageTexture.create_from_image(img)
	# флаг фильтрации задаётся в project.godot (textures/canvas_items/default_filter)
	_cache[key] = t
	return t


# ---------- спрайты ----------

static var _drawers := {
	"rock": func(i, s): _rock(i, s),
	"item_orb": func(i, s): _orb(i, s, Color(1.0, 0.92, 0.6, 0.95), Color(1, 1, 0.9)),
	"player_isaac": func(i, s): _humanoid(i, s, Color(0.96, 0.87, 0.74), Color(0.93, 0.93, 0.95)),
	"player_maggy": func(i, s): _humanoid(i, s, Color(0.93, 0.78, 0.66), Color(0.35, 0.45, 0.75)),
	"player_cain": func(i, s): _humanoid(i, s, Color(0.9, 0.72, 0.6), Color(0.65, 0.16, 0.16)),
	"fly": func(i, s): _fly(i, s),
	"gaper": func(i, s): _gaper(i, s),
	"pacer": func(i, s): _pacer(i, s),
	"spitter": func(i, s): _spitter(i, s),
	"host": func(i, s): _host(i, s),
	"fatty": func(i, s): _fatty(i, s),
	"boss_monstro": func(i, s): _monstro(i, s),
	"boss_duke": func(i, s): _duke(i, s),
	"boss_eye": func(i, s): _bigeye(i, s),
	"tear": func(i, s): _orb(i, s, Color(0.65, 0.8, 1.0, 0.95), Color(0.9, 0.97, 1)),
	"tear_homing": func(i, s): _orb(i, s, Color(1.0, 0.85, 0.4, 0.95), Color(1, 1, 0.85)),
	"tear_triple": func(i, s): _orb(i, s, Color(0.85, 0.6, 1.0, 0.95), Color(0.97, 0.9, 1)),
	"enemy_tear": func(i, s): _orb(i, s, Color(0.85, 0.25, 0.35, 0.95), Color(1, 0.75, 0.8)),
	"coin": func(i, s): _coin(i, s),
	"heart": func(i, s): _heart(i, s),
	"heart_soul": func(i, s): _heart(i, s, Color(0.55, 0.8, 1.0)),
	"key": func(i, s): _key(i, s),
	"bomb_pickup": func(i, s): _bomb_pickup(i, s),
	"pill": func(i, s): _pill(i, s),
	"item_base": func(i, s): _pedestal(i, s),
	"chest": func(i, s): _chest(i, s),
	"shopkeeper": func(i, s): _shopkeeper(i, s),
	"door_closed": func(i, s): _door(i, s, Color(0.35, 0.27, 0.2)),
	"door_open": func(i, s): _door(i, s, Color(0.12, 0.09, 0.08)),
	"trapdoor": func(i, s): _trapdoor(i, s),
	"bomb_entity": func(i, s): _bomb_entity(i, s),
	"button": func(i, s): _button(i, s),
}


static func _px(i: Image, x, y, c: Color):
	if x >= 0 and y >= 0 and x < i.get_width() and y < i.get_height():
		i.set_pixel(x, y, c)


static func _circle(i: Image, cx: float, cy: float, r: float, c: Color):
	for y in range(int(cy - r), int(cy + r) + 1):
		for x in range(int(cx - r), int(cx + r) + 1):
			if Vector2(x - cx, y - cy).length() <= r:
				_px(i, x, y, c)


static func _rect(i: Image, x0: int, y0: int, w: int, h: int, c: Color):
	for y in range(y0, y0 + h):
		for x in range(x0, x0 + w):
			_px(i, x, y, c)


static func _shade(c: Color, f: float) -> Color:
	return Color(clampf(c.r * f, 0, 1), clampf(c.g * f, 0, 1), clampf(c.b * f, 0, 1), c.a)


static func _outline_circle(i: Image, cx: float, cy: float, r: float, col: Color, oc: Color):
	_circle(i, cx, cy, r + 1.0, oc)
	_circle(i, cx, cy, r, col)


static func _eyes(i: Image, cx: float, cy: float, gap: float, er: float, white := Color(1, 1, 1)):
	_circle(i, cx - gap, cy, er, white)
	_circle(i, cx + gap, cy, er, white)
	_circle(i, cx - gap, cy, er * 0.45, Color(0.1, 0.1, 0.15))
	_circle(i, cx + gap, cy, er * 0.45, Color(0.1, 0.1, 0.15))


static func _humanoid(i: Image, s: int, skin: Color, cloth: Color):
	var cx := s * 0.5
	# тело
	_rect(i, int(cx - s * 0.22), int(s * 0.5), int(s * 0.44), int(s * 0.38), cloth)
	_rect(i, int(cx - s * 0.22), int(s * 0.5), int(s * 0.44), 2, _shade(cloth, 1.2))
	# ноги
	_rect(i, int(cx - s * 0.18), int(s * 0.86), int(s * 0.12), int(s * 0.1), _shade(skin, 0.85))
	_rect(i, int(cx + s * 0.06), int(s * 0.86), int(s * 0.12), int(s * 0.1), _shade(skin, 0.85))
	# голова
	_outline_circle(i, cx, s * 0.34, s * 0.27, skin, Color(0.15, 0.1, 0.08))
	_eyes(i, cx, s * 0.33, s * 0.11, s * 0.055)
	# рот-грусть
	for k in range(3):
		_px(i, int(cx - s * 0.07 + k * s * 0.05), int(s * 0.47 + abs(1 - k) * 0.02 * s), _shade(skin, 0.6))


static func _fly(i: Image, s: int):
	var cx := s * 0.5
	# крылья
	_circle(i, cx - s * 0.3, s * 0.38, s * 0.14, Color(0.8, 0.85, 0.9, 0.7))
	_circle(i, cx + s * 0.3, s * 0.38, s * 0.14, Color(0.8, 0.85, 0.9, 0.7))
	_outline_circle(i, cx, s * 0.55, s * 0.28, Color(0.3, 0.28, 0.32), Color(0.1, 0.1, 0.12))
	_eyes(i, cx, s * 0.5, s * 0.1, s * 0.06, Color(0.9, 0.3, 0.3))


static func _gaper(i: Image, s: int):
	var cx := s * 0.5
	# туловище (серое мясо)
	_rect(i, int(cx - s * 0.2), int(s * 0.55), int(s * 0.4), int(s * 0.35), Color(0.72, 0.55, 0.5))
	# голова повёрнута "назад" — лицо на спине:
	_outline_circle(i, cx, s * 0.35, s * 0.26, Color(0.85, 0.66, 0.58), Color(0.2, 0.12, 0.1))
	_eyes(i, cx, s * 0.32, s * 0.1, s * 0.05, Color(0.95, 0.9, 0.85))
	_px(i, int(cx - s * 0.03), int(s * 0.44), Color(0.4, 0.1, 0.1))
	_px(i, int(cx + s * 0.03), int(s * 0.44), Color(0.4, 0.1, 0.1))
	# ноги
	_rect(i, int(cx - s * 0.16), int(s * 0.88), int(s * 0.1), int(s * 0.08), Color(0.55, 0.4, 0.35))
	_rect(i, int(cx + s * 0.06), int(s * 0.88), int(s * 0.1), int(s * 0.08), Color(0.55, 0.4, 0.35))


static func _pacer(i: Image, s: int):
	var cx := s * 0.5
	_outline_circle(i, cx, s * 0.55, s * 0.32, Color(0.55, 0.42, 0.62), Color(0.18, 0.12, 0.2))
	# щупальца снизу
	for k in range(4):
		_rect(i, int(cx - s * 0.25 + k * s * 0.16), int(s * 0.82), 2, int(s * 0.12), Color(0.4, 0.3, 0.5))
	_eyes(i, cx, s * 0.5, s * 0.12, s * 0.06, Color(1, 0.9, 0.4))


static func _spitter(i: Image, s: int):
	var cx := s * 0.5
	_outline_circle(i, cx, s * 0.55, s * 0.3, Color(0.35, 0.6, 0.35), Color(0.12, 0.2, 0.12))
	# рот-воронка
	_circle(i, cx, s * 0.42, s * 0.12, Color(0.15, 0.25, 0.15))
	_circle(i, cx, s * 0.42, s * 0.07, Color(0.05, 0.1, 0.05))
	_eyes(i, cx, s * 0.62, s * 0.11, s * 0.05, Color(0.9, 0.95, 0.8))


static func _host(i: Image, s: int):
	var cx := s * 0.5
	_rect(i, int(cx - s * 0.3), int(s * 0.3), int(s * 0.6), int(s * 0.55), Color(0.75, 0.68, 0.55))
	_rect(i, int(cx - s * 0.3), int(s * 0.3), int(s * 0.6), 2, Color(0.9, 0.85, 0.7))
	# пасть-ловушка
	_rect(i, int(cx - s * 0.2), int(s * 0.5), int(s * 0.4), int(s * 0.18), Color(0.35, 0.1, 0.1))
	for k in range(5):
		_px(i, int(cx - s * 0.18 + k * s * 0.09), int(s * 0.52), Color(0.95, 0.95, 0.9))
		_px(i, int(cx - s * 0.18 + k * s * 0.09), int(s * 0.64), Color(0.95, 0.95, 0.9))


static func _fatty(i: Image, s: int):
	var cx := s * 0.5
	_outline_circle(i, cx, s * 0.55, s * 0.38, Color(0.8, 0.62, 0.55), Color(0.25, 0.15, 0.12))
	# пятна
	_circle(i, cx - s * 0.15, s * 0.65, s * 0.06, Color(0.65, 0.48, 0.42))
	_circle(i, cx + s * 0.18, s * 0.45, s * 0.05, Color(0.65, 0.48, 0.42))
	_eyes(i, cx, s * 0.45, s * 0.12, s * 0.06, Color(1, 0.95, 0.9))
	# злой рот
	for k in range(4):
		_px(i, int(cx - s * 0.1 + k * s * 0.06), int(s * 0.6), Color(0.3, 0.1, 0.1))


static func _monstro(i: Image, s: int):
	var cx := s * 0.5
	# щупальца
	for ang in range(0, 360, 40):
		var v := Vector2.from_angle(deg_to_rad(ang)) * s * 0.38
		_circle(i, cx + v.x, s * 0.55 + v.y * 0.7, s * 0.09, Color(0.85, 0.45, 0.55))
	_outline_circle(i, cx, s * 0.52, s * 0.4, Color(0.95, 0.55, 0.65), Color(0.3, 0.1, 0.15))
	# один большой глаз
	_circle(i, cx, s * 0.45, s * 0.16, Color(1, 1, 1))
	_circle(i, cx, s * 0.45, s * 0.08, Color(0.1, 0.1, 0.15))
	# зубастая улыбка
	for k in range(7):
		_px(i, int(cx - s * 0.22 + k * s * 0.07), int(s * 0.66), Color(1, 1, 1))
		_px(i, int(cx - s * 0.22 + k * s * 0.07), int(s * 0.7), Color(0.35, 0.1, 0.15))


static func _duke(i: Image, s: int):
	var cx := s * 0.5
	_outline_circle(i, cx, s * 0.55, s * 0.42, Color(0.55, 0.7, 0.4), Color(0.15, 0.2, 0.1))
	# мухи вокруг
	for pos in [[0.15, 0.2], [0.85, 0.25], [0.2, 0.8], [0.8, 0.75]]:
		_circle(i, s * pos[0], s * pos[1], s * 0.035, Color(0.2, 0.2, 0.22))
	# глаза (три)
	_eyes(i, cx - s * 0.08, s * 0.45, s * 0.12, s * 0.06, Color(1, 0.9, 0.3))
	_circle(i, cx + s * 0.14, s * 0.6, s * 0.05, Color(1, 0.9, 0.3))
	# гниющая пасть
	_rect(i, int(cx - s * 0.15), int(s * 0.62), int(s * 0.3), int(s * 0.08), Color(0.25, 0.35, 0.2))


static func _bigeye(i: Image, s: int):
	var cx := s * 0.5
	# перья/ободок
	for ang in range(0, 360, 24):
		var v := Vector2.from_angle(deg_to_rad(ang)) * s * 0.42
		_circle(i, cx + v.x, s * 0.5 + v.y, s * 0.06, Color(0.45, 0.35, 0.55))
	_outline_circle(i, cx, s * 0.5, s * 0.34, Color(0.9, 0.9, 0.95), Color(0.2, 0.15, 0.25))
	_circle(i, cx, s * 0.5, s * 0.2, Color(0.2, 0.5, 0.9))
	_circle(i, cx, s * 0.5, s * 0.1, Color(0.05, 0.05, 0.1))
	_circle(i, cx - s * 0.05, s * 0.45, s * 0.03, Color(1, 1, 1, 0.9))


static func _orb(i: Image, s: int, c: Color, hl: Color):
	var cx := s * 0.5
	_circle(i, cx, cx, s * 0.42, c)
	_circle(i, cx - s * 0.12, cx - s * 0.12, s * 0.12, hl)


static func _coin(i: Image, s: int):
	var cx := s * 0.5
	_circle(i, cx, cx, s * 0.4, Color(0.85, 0.68, 0.2))
	_circle(i, cx, cx, s * 0.32, Color(0.98, 0.84, 0.35))
	_rect(i, int(cx - s * 0.05), int(s * 0.3), int(s * 0.1), int(s * 0.4), Color(0.75, 0.58, 0.15))


static func _heart(i: Image, s: int, c := Color(0.85, 0.2, 0.25)):
	var cx := s * 0.5
	_circle(i, cx - s * 0.16, s * 0.4, s * 0.18, c)
	_circle(i, cx + s * 0.16, s * 0.4, s * 0.18, c)
	for y in range(int(s * 0.45), int(s * 0.75)):
		var half := int((s * 0.75 - y) * 0.55)
		_rect(i, int(cx - half), y, half * 2, 1, c)
	_circle(i, cx - s * 0.2, s * 0.33, s * 0.06, _shade(c, 1.3))


static func _key(i: Image, s: int):
	var cx := s * 0.5
	_circle(i, cx, s * 0.3, s * 0.16, Color(0.85, 0.85, 0.4))
	_circle(i, cx, s * 0.3, s * 0.07, Color(0.2, 0.2, 0.15))
	_rect(i, int(cx - s * 0.04), int(s * 0.42), int(s * 0.08), int(s * 0.4), Color(0.85, 0.85, 0.4))
	_rect(i, int(cx), int(s * 0.65), int(s * 0.14), int(s * 0.06), Color(0.85, 0.85, 0.4))
	_rect(i, int(cx), int(s * 0.76), int(s * 0.1), int(s * 0.06), Color(0.85, 0.85, 0.4))


static func _bomb_pickup(i: Image, s: int):
	var cx := s * 0.5
	_circle(i, cx, s * 0.6, s * 0.3, Color(0.2, 0.2, 0.25))
	_circle(i, cx - s * 0.1, s * 0.5, s * 0.08, Color(0.5, 0.5, 0.55))
	_rect(i, int(cx - s * 0.03), int(s * 0.25), int(s * 0.06), int(s * 0.12), Color(0.5, 0.35, 0.2))
	_circle(i, cx + s * 0.08, s * 0.22, s * 0.05, Color(1, 0.7, 0.2))


static func _pill(i: Image, s: int):
	var cx := s * 0.5
	_rect(i, int(cx - s * 0.3), int(s * 0.38), int(s * 0.3), int(s * 0.24), Color(0.9, 0.9, 0.95))
	_rect(i, int(cx), int(s * 0.38), int(s * 0.3), int(s * 0.24), Color(0.9, 0.4, 0.5))
	_rect(i, int(cx - s * 0.3), int(s * 0.38), int(s * 0.6), 2, Color(1, 1, 1, 0.6))


static func _pedestal(i: Image, s: int):
	_rect(i, int(s * 0.2), int(s * 0.7), int(s * 0.6), int(s * 0.15), Color(0.6, 0.6, 0.68))
	_rect(i, int(s * 0.2), int(s * 0.7), int(s * 0.6), 2, Color(0.8, 0.8, 0.88))
	# свечение
	_circle(i, s * 0.5, s * 0.45, s * 0.28, Color(1, 0.95, 0.6, 0.15))


static func _chest(i: Image, s: int):
	_rect(i, int(s * 0.15), int(s * 0.4), int(s * 0.7), int(s * 0.4), Color(0.55, 0.35, 0.15))
	_rect(i, int(s * 0.15), int(s * 0.3), int(s * 0.7), int(s * 0.2), Color(0.65, 0.45, 0.2))
	_rect(i, int(s * 0.45), int(s * 0.4), int(s * 0.1), int(s * 0.4), Color(0.85, 0.75, 0.3))
	_rect(i, int(s * 0.15), int(s * 0.55), int(s * 0.7), 2, Color(0.85, 0.75, 0.3))


static func _shopkeeper(i: Image, s: int):
	var cx := s * 0.5
	_outline_circle(i, cx, s * 0.5, s * 0.35, Color(0.3, 0.3, 0.35), Color(0.12, 0.12, 0.15))
	_eyes(i, cx, s * 0.42, s * 0.12, s * 0.06, Color(1, 1, 0.5))
	# прилавок
	_rect(i, int(s * 0.1), int(s * 0.75), int(s * 0.8), int(s * 0.2), Color(0.5, 0.35, 0.2))
	_rect(i, int(s * 0.1), int(s * 0.75), int(s * 0.8), 2, Color(0.7, 0.5, 0.3))


static func _door(i: Image, s: int, c: Color):
	_rect(i, 0, 0, s, s, Color(0.1, 0.08, 0.07))
	_rect(i, int(s * 0.1), int(s * 0.05), int(s * 0.8), int(s * 0.9), c)
	# заклёпки
	for k in range(3):
		_px(i, int(s * 0.2 + k * s * 0.3), int(s * 0.2), Color(0.8, 0.75, 0.6))
		_px(i, int(s * 0.2 + k * s * 0.3), int(s * 0.8), Color(0.8, 0.75, 0.6))


static func _trapdoor(i: Image, s: int):
	_circle(i, s * 0.5, s * 0.5, s * 0.45, Color(0.05, 0.04, 0.05))
	_circle(i, s * 0.5, s * 0.5, s * 0.35, Color(0.0, 0.0, 0.0))
	# ступеньки
	_rect(i, int(s * 0.4), int(s * 0.55), int(s * 0.2), 2, Color(0.4, 0.35, 0.3))
	_rect(i, int(s * 0.42), int(s * 0.7), int(s * 0.16), 2, Color(0.4, 0.35, 0.3))


static func _bomb_entity(i: Image, s: int):
	var cx := s * 0.5
	_circle(i, cx, s * 0.6, s * 0.35, Color(0.15, 0.15, 0.18))
	_circle(i, cx - s * 0.12, s * 0.48, s * 0.09, Color(0.45, 0.45, 0.5))
	_rect(i, int(cx - 1), int(s * 0.15), 2, int(s * 0.18), Color(0.5, 0.35, 0.2))


static func _button(i: Image, s: int):
	_rect(i, int(s * 0.2), int(s * 0.5), int(s * 0.6), int(s * 0.25), Color(0.4, 0.4, 0.45))
	_circle(i, s * 0.5, s * 0.45, s * 0.18, Color(0.85, 0.2, 0.2))
	_circle(i, s * 0.45, s * 0.4, s * 0.06, Color(1, 0.6, 0.6))


static func _rock(i: Image, s: int):
	var cx := s * 0.5
	# глыба с гранями
	_circle(i, cx, s * 0.58, s * 0.38, Color(0.42, 0.4, 0.42))
	_circle(i, cx - s * 0.08, s * 0.5, s * 0.26, Color(0.52, 0.5, 0.52))
	_circle(i, cx - s * 0.14, s * 0.44, s * 0.1, Color(0.62, 0.6, 0.62))
	# трещины
	for k in range(4):
		_px(i, int(cx - s * 0.1 + k * s * 0.07), int(s * 0.62 + (k % 2) * s * 0.06), Color(0.25, 0.24, 0.25))
	# мох
	_px(i, int(cx + s * 0.15), int(s * 0.4), Color(0.35, 0.5, 0.3))

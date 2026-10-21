extends Node2D
## Автоoload "FX": звуки (синтез), частицы, тряска экрана, всплывающий текст.

var _player: AudioStreamPlayer
var _streams := {}
var _rng := RandomNumberGenerator.new()
var _camera: Camera2D = null
var _shake_amt := 0.0
var _layer: CanvasLayer = null


func _ready():
	_player = AudioStreamPlayer.new()
	_player.bus = "Master"
	add_child(_player)
	_gen_sounds()
	var l := CanvasLayer.new()
	l.layer = 50
	add_child(l)
	_layer = l


# ---------- ЗВУКИ (процедурный WAV-синтез) ----------

static func _gen_tone(dur: float, freq_fn, vol := 0.3, noise := 0.0, decay := 6.0) -> AudioStreamWAV:
	var rate := 22050
	var n := int(dur * rate)
	var bytes := PackedByteArray()
	bytes.resize(n * 2)
	for i in range(n):
		var t := float(i) / rate
		var env := exp(-t * decay) * (1.0 - t / dur * 0.2)
		var f: float = freq_fn.call(t)
		var s := sin(TAU * f * t) * (1.0 - noise) + (_rnd() * 2.0 - 1.0) * noise
		s *= clampf(env, 0, 1) * vol
		var v := int(clampf(s, -1, 1) * 32767.0)
		bytes.encode_s16(i * 2, v)
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate = rate
	wav.data = bytes
	return wav


static var _seed := 12345.0


static func _rnd() -> float:
	_seed = fmod(_seed * 9301.0 + 49297.0, 233280.0)
	return _seed / 233280.0


func _gen_sounds():
	_streams["shoot"] = _gen_tone(0.09, func(t): return 700.0 - t * 3500.0, 0.10, 0.3, 14.0)
	_streams["hit"] = _gen_tone(0.12, func(t): return 220.0 - t * 900.0, 0.22, 0.6, 12.0)
	_streams["hurt"] = _gen_tone(0.28, func(t): return 320.0 - t * 700.0, 0.35, 0.4, 7.0)
	_streams["pickup"] = _gen_tone(0.16, func(t): return 500.0 + t * 2600.0, 0.2, 0.0, 5.0)
	_streams["coin"] = _gen_tone(0.12, func(t): return 900.0 + t * 1800.0, 0.18, 0.0, 9.0)
	_streams["explode"] = _gen_tone(0.5, func(t): return 90.0 - t * 120.0, 0.5, 1.0, 6.0)
	_streams["bomb_place"] = _gen_tone(0.06, func(t): return 300.0, 0.15, 0.5, 20.0)
	_streams["door"] = _gen_tone(0.3, func(t): return 140.0 + t * 60.0, 0.3, 0.7, 5.0)
	_streams["item"] = _gen_tone(0.5, func(t): return 400.0 + sin(t * 30.0) * 150.0 + t * 500.0, 0.25, 0.1, 3.0)
	_streams["enemy_shoot"] = _gen_tone(0.12, func(t): return 400.0 - t * 1800.0, 0.12, 0.4, 12.0)
	_streams["death"] = _gen_tone(0.7, func(t): return 200.0 - t * 250.0, 0.4, 0.5, 4.0)
	_streams["boss_roar"] = _gen_tone(0.8, func(t): return 120.0 + sin(t * 40.0) * 60.0 - t * 40.0, 0.5, 0.6, 2.5)
	_streams["button"] = _gen_tone(0.2, func(t): return 600.0 + t * 400.0, 0.2, 0.0, 8.0)
	_streams["menu"] = _gen_tone(0.08, func(t): return 800.0, 0.12, 0.0, 20.0)
	_streams["pill"] = _gen_tone(0.25, func(t): return 300.0 + t * 1200.0, 0.2, 0.3, 6.0)


func play(name: String, pitch_var := 0.08):
	if not _streams.has(name) or _player.playing:
		return
	_player.stream = _streams[name]
	_player.pitch_scale = 1.0 + _rng.randf_range(-pitch_var, pitch_var)
	_player.volume_db = -8.0
	_player.play()


# ---------- ТРЯСКА ----------

func set_camera(c: Camera2D):
	_camera = c


func shake(amount: float):
	_shake_amt = maxf(_shake_amt, amount)


func _process(delta):
	if _shake_amt > 0.5 and _camera:
		_camera.offset = Vector2(_rng.randf_range(-_shake_amt, _shake_amt), _rng.randf_range(-_shake_amt, _shake_amt))
		_shake_amt *= pow(0.02, delta)
	elif _camera:
		_camera.offset = Vector2.ZERO
		_shake_amt = 0.0


# ---------- ЧАСТИЦЫ ----------

func spawn_particles(pos: Vector2, color: Color, count := 10, speed := 160.0, size := 4.0, parent: Node = null):
	var nodes: Node = parent if parent != null else get_tree().current_scene
	for i in range(count):
		var p := ColorRect.new()
		p.color = color
		p.size = Vector2(size, size)
		p.position = pos - p.size / 2.0
		nodes.add_child(p)
		var tw := p.create_tween()
		var dir := Vector2.from_angle(_rng.randf_range(0, TAU)) * speed * _rng.randf_range(0.3, 1.0)
		tw.set_parallel(true)
		tw.tween_property(p, "position", p.position + dir, 0.45).set_ease(Tween.EASE_OUT)
		tw.tween_property(p, "modulate:a", 0.0, 0.45)
		tw.chain().tween_callback(p.queue_free)


func popup_text(pos: Vector2, text: String, color := Color.WHITE, sz := 16):
	var lb := Label.new()
	lb.text = text
	lb.add_theme_font_size_override("font_size", sz)
	lb.add_theme_color_override("font_color", color)
	lb.add_theme_color_override("font_outline_color", Color.BLACK)
	lb.add_theme_constant_override("outline_size", 4)
	lb.position = pos - Vector2(40, 0)
	_layer.add_child(lb)
	var tw := lb.create_tween()
	tw.set_parallel(true)
	tw.tween_property(lb, "position:y", lb.position.y - 40.0, 0.8).set_ease(Tween.EASE_OUT)
	tw.tween_property(lb, "modulate:a", 0.0, 0.8).set_delay(0.3)
	tw.chain().tween_callback(lb.queue_free)

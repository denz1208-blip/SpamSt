extends CharacterBody2D
## Игрок: движение WASD, стрельба стрелками (8 направлений), бомбы E, активный предмет Q.

signal died
signal hp_changed
signal pickup(pos: Vector2, kind: String)   # автоподбор при касании
signal killed_enemy(enemy: Node2D)

const TEAR_SCENE_PATH := "res://scenes/tear.tscn"

var hp := 6
var sprite_key := "player_isaac"
var invuln := 0.0
var shoot_cd := 0.0
var bomb_cd := 0.0
var item_cd := 0.0
var dead := false
var walk_t := 0.0
var facing := Vector2.DOWN

@onready var spr := $Sprite2D
@onready var hurt_box := $HurtBox


func setup():
add_to_group("player")
hurt_box.body_entered.connect(_on_body_entered)
var c = State.CHARACTERS[State.character]
sprite_key = c["sprite"]
spr.texture = Art.tex(sprite_key, 48)
hp = int(State.stats["max_hp"])
fix_scale()
FX.set_camera($Camera2D)


func fix_scale():
# визуальный рост от предметов
var sc: float = 1.0 + (State.stats["tear_size"] - 1.0) * 0.25
spr.scale = Vector2(sc, sc)


func _physics_process(delta):
if dead:
return
invuln = maxf(0, invuln - delta)
shoot_cd = maxf(0, shoot_cd - delta)
bomb_cd = maxf(0, bomb_cd - delta)
State.active_cooldown = maxf(0, State.active_cooldown - delta)

var mv: Vector2 = Input.get_vector("move_left", "move_right", "move_up", "move_down")
if mv != Vector2.ZERO:
walk_t += delta * 10.0
facing = mv.normalized()
var speed := float(State.stats["speed"])
velocity = mv * speed
move_and_slide()
# лёгкое покачивание при ходьбе
spr.position.y = -6.0 + sin(walk_t) * (2.0 if mv != Vector2.ZERO else 0.0)
spr.flip_h = facing.x < 0 if facing.x != 0 else spr.flip_h
spr.modulate.a = 0.45 if invuln > 0 and fmod(invuln * 12.0, 2.0) > 1.0 else 1.0

var dir := _shoot_dir()
if dir != Vector2.ZERO and shoot_cd <= 0.0:
_fire(dir)

if Input.is_action_just_pressed("bomb") and bomb_cd <= 0.0 and int(State.stats["bomb_count"]) > 0:
bomb_cd = 0.4
State.stats["bomb_count"] = int(State.stats["bomb_count"]) - 1
spawn_bomb()

if Input.is_action_just_pressed("active_item"):
_use_active()


func _shoot_dir() -> Vector2:
var x := (1.0 if Input.is_action_pressed("shoot_right") else 0.0) - (1.0 if Input.is_action_pressed("shoot_left") else 0.0)
var y := (1.0 if Input.is_action_pressed("shoot_down") else 0.0) - (1.0 if Input.is_action_pressed("shoot_up") else 0.0)
if x == 0 and y == 0:
return Vector2.ZERO
return Vector2(x, y).normalized()


func _fire(dir: Vector2):
var shots := int(State.stats["shots"])
var base_ang := dir.angle()
var spread := float(State.stats["multi_shot_spread"])
var cd := float(State.stats["cooldown"]) * float(State.stats["fire_rate_mult"])
shoot_cd = cd
for i in range(shots):
var ang := base_ang + (i - (shots - 1) / 2.0) * spread
_spawn_tear(Vector2.from_angle(ang))
FX.play("shoot")


func _spawn_tear(dir: Vector2):
var t: Area2D = load(TEAR_SCENE_PATH).instantiate()
t.global_position = global_position + dir * 14.0
t.setup(dir, self)
get_parent().add_child(t)


func spawn_bomb():
var b: RigidBody2D = load("res://scenes/bomb.tscn").instantiate()
b.global_position = global_position + facing * 18.0
get_parent().add_child(b)
FX.play("bomb_place")


func _use_active():
if State.active_item == "":
return
if State.active_cooldown > 0.0:
FX.play("error")
return
if State.active_item == "the_noise":
State.active_cooldown = State.active_max
for i in range(40):
_spawn_tear(Vector2.from_angle(TAU * i / 40.0))
FX.shake(6.0)
FX.play("explode")
elif State.active_item == "blood_bank":
State.active_cooldown = State.active_max
heal(4)
elif State.active_item == "guppys_brain":
State.active_cooldown = State.active_max
for e in get_tree().get_nodes_in_group("enemy"):
if e is Node2D:
e.take_damage(6.0, global_position)
else:
FX.play("error")


func take_damage(amount: int, from_pos := Vector2.INF):
if invuln > 0 or dead:
return
invuln = 1.0
hp -= amount
hp_changed.emit()
FX.play("hurt")
FX.shake(5)
FX.spawn_particles(global_position, Color(0.9, 0.2, 0.2), 10, 160)
if from_pos != Vector2.INF:
var kb := (global_position - from_pos).normalized() * 90.0
velocity += kb
if hp <= 0:
die()


func heal(halves: int):
hp = mini(hp + halves, int(State.stats["max_hp"]))
hp_changed.emit()


func _on_body_entered(body):
if body.is_in_group("pickup"):
var kind: String = body.kind
body.queue_free()
match kind:
"heart":
if State.stats.get("hearts_full_only", false):
heal(2)
else:
heal(1)
FX.play("pickup")
"heart_soul":
State.stats["soul_hearts"] = int(State.stats["soul_hearts"]) + 1
FX.play("pickup")
"coin":
State.stats["coins"] = int(State.stats["coins"]) + 1
FX.play("pickup")
"key":
State.stats["keys"] = int(State.stats["keys"]) + 1
FX.play("pickup")
"bomb_pickup":
State.stats["bomb_count"] = int(State.stats["bomb_count"]) + 1
FX.play("pickup")
"pill":
State.apply_pill()
FX.play("swallow")
hp_changed.emit()
elif body.is_in_group("enemy") and not dead:
take_damage(1, body.global_position)


func die():
dead = true
FX.play("death")
FX.spawn_particles(global_position, Color(0.9, 0.85, 0.7), 24, 220)
FX.shake(10)
spr.visible = false
hurt_box.set_deferred("monitoring", false)
died.emit()

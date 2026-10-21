extends Node2D
## Слой рисования фона комнаты.

var cb: Callable


func _draw():
	if cb.is_valid():
		cb.call(self)

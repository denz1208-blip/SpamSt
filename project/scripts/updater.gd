extends Node
## Автоoload "Updater": проверка обновлённой версии игры на GitHub Pages.

const REPO_RAW := "https://denz1208-blip.github.io/SpamSt/version.json"
const GAME_URL := "https://denz1208-blip.github.io/SpamSt/"
const VERSION := "1.0.0"

var latest := ""
var has_update := false


func check(callback: Callable = Callable()):
	var http := HTTPRequest.new()
	add_child(http)
	http.timeout = 6.0
	var done := func(result, _code, _headers, body):
		if not is_instance_valid(callback) or not callback.is_valid():
			http.queue_free()
			return
		var msg := ""
		if result == HTTPRequest.RESULT_SUCCESS:
			var d = JSON.parse_string(body.get_string_from_utf8())
			if typeof(d) == TYPE_DICTIONARY:
				latest = str(d.get("version", ""))
				has_update = _ver_gt(latest, VERSION)
				msg = ("ДОСТУПНО ОБНОВЛЕНИЕ v" + latest) if has_update else ("Актуальная версия v" + VERSION)
			else:
				msg = "Сервер версий недоступен"
		else:
			msg = "Нет связи с сервером обновлений"
		callback.call(has_update, msg)
		http.queue_free()
	http.request_completed.connect(done)
	http.request(REPO_RAW + "?t=" + str(Time.get_unix_time_from_system()))


static func _ver_gt(a: String, b: String) -> bool:
	var pa := a.split(".")
	var pb := b.split(".")
	for i in range(3):
		var va := int(pa[i]) if i < pa.size() else 0
		var vb := int(pb[i]) if i < pb.size() else 0
		if va != vb:
			return va > vb
	return false


func open_game_page():
	OS.shell_open(GAME_URL)

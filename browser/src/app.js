
Polymer({
	is: "my-app",

	properties: {
		status: {
			type: Object,
			value: {
				state: 'Unknown'
			}
		},

		serverVersion: {
			type: String,
			value: null
		},

		clientVersion: {
			type: String,
			value: null
		},

		grblVersion: {
			type: String,
			value: null
		},


		config : {
			type: Object,
			value: null
		},

		isConnected: {
			type: Boolean,
			value: false
		},

		selectedMenu: {
			type: Number,
			value: 0
		},

		selectedSubMenu: {
			type: Number,
			value: 0
		},

		commandTab: {
			type: Number,
			value: 0
		},

		settingsTab: {
			type: Number,
			value: 0
		},

		settings : {
			type: Object
		},

		jogStep : {
			type: Number,
			value: 1
		},

		jogStepList : {
			type: Array,
			value: [
				0.01,
				0.1,
				1,
				5,
				10
			]
		},

		jogFeedRate : {
			type: Number,
			value: 500
		},

		jogFeedRateList : {
			type: Array,
			value: [
				100,
				200,
				500,
				800,
				1000
			]
		},

		commandHistory: {
			type: Array,
			value: []
		},

		commandHistoryIndex: {
			type: Number,
			value: 0
		},

		error: {
			type: String,
			value: ''
		},

		lastAlarm: {
			type: String,
			value: ''
		},

		gcode: {
			type: Object,
			value: null
		},

		upload: {
			type: Object,
			value: {}
		},

		progress : {
			type: Object,
			computed: 'computeProgress(gcode.sent.length, gcode.remain.length, gcode.*)'
		},

		isBatchMode: {
			type: Boolean,
			computed: 'computeBatchMode(gcode.startedTime, gcode.finishedTime, gcode)'
		}
	},

	observers: [
		'_gcodeChanged(gcode.*)',
		'_settingsChanged(settings.*)',
		'_configChanged(config)',
		'_submenuChanged(selectedSubMenu)'
	],

	_id : 0,
	_callbacks : {},

	ready : function () {
		var self = this;
		console.log('ready');

		self.alarmDialog = document.getElementById('alarm');
		self.alarmResetDialog = document.getElementById('alarm-reset');
		self.uploadDialog = document.getElementById('upload');

		self.async(function () {
			var uploadFile = document.getElementById('upload-file');
			var inputFile = uploadFile.querySelector('input[type=file]');

			uploadFile.onclick = function () {
				inputFile.click();
			};


//			self.uploadDialog.refit();
//			self.uploadDialog.open();
//			self.set('upload.name', 'foobar.txt');
//			self.set('upload.size', 1000);
//			self.set('upload.status', 'Loading...');
//			self.set('upload.progress', 0);
//			setInterval(function () {
//				self.set('upload.progress', self.upload.progress+1);
//			}, 100);

			inputFile.onchange = function () {
				var files = inputFile.files;
				self.uploadFile(files[0]);
				inputFile.value = "";
			};

			document.body.addEventListener("drop", function (e) {
				e.preventDefault();
				var files = e.dataTransfer.files;
				self.uploadFile(files[0]);
			}, false);
			document.body.addEventListener("dragenter", function (e) {
				e.preventDefault();
			}, false);
			document.body.addEventListener("dragover", function (e) {
				e.preventDefault();
			}, false);

			var touch = false, moving = false;
			self.$.jog.addEventListener('start', function (e) {
				// ignore multiple taps while moving
				var onerror = function () {
					moving = false;
				};
				if (!moving) {
					e.preventDefault();

					var axis = e.detail.axis;
					var direction = e.detail.direction;

					touch = true;
					moving = true;
					var step = self.jogStep * direction;
					return Promise.all([
						// move
						self.request('command', { command: 'G21 G91 G0 ' + axis + step }),
						// sync
						self.request('command', { command: 'G4 P0.5' })
					]).then(function () {
						if (touch) {
							// stop within interval sec
							var interval = 0.25;
							var maxFeed = Number(self.config[{
								X: '$110',
								Y: '$111',
								Z: '$112'
							}[axis]]);
							console.log('maxFeed', maxFeed);
							var maxStep = maxFeed * interval / 60;
							if (self.jogStep > maxStep) {
								step = maxStep * direction;
							}
							var feed = Math.abs(60 * step / interval);
							self.request('command', { command: 'G21 G91 G1 F' + feed + ' ' + axis + step }).catch(onerror);
							self.request('command', { command: 'G21 G91 G1 F' + feed + ' ' + axis + step }).catch(onerror);

							var next = 0, time = new Date().getTime();
							(function repeat () {
								var now = new Date().getTime();
								var diff = next - (now - time);
								next = interval * 1000 + diff;
								console.log('append queue', now - time, diff, next);
								if (touch) {
									self.request('command', { command: 'G21 G91 G1 F' + feed + ' ' + axis + step }).catch(onerror);
									time = now;
									setTimeout(repeat, next);
								} else {
									moving = false;
								}
							})();
						} else {
							moving = false;
						}
					}).catch(onerror);
				}
			});

			self.$.jog.addEventListener('end', function (e) {
				touch = false;
			});

			/*
			var touch  = false;
			Array.prototype.forEach.call(document.querySelectorAll(".jog paper-button"), function (button) {
				var axis = button.getAttribute('data-axis');
				var direction = +button.getAttribute('data-direction');
				if (!axis) return;
				axis = axis.toUpperCase();

				var moving = false;


				var touchstart = function (e) {
				};

				if (typeof ontouchstart !== "undefined") {
					button.addEventListener("touchstart", touchstart);
				} else {
					button.addEventListener("mousedown", touchstart);
				}
			});

			var touchend = function (e) {
				e.preventDefault();
				touch = false;
			};

			if (typeof ontouchstart !== "undefined") {
				window.addEventListener("touchend", touchend);
			} else {
				window.addEventListener("mouseup", touchend);
			}
			*/
		});

		self.async(function () {
			self.openWebSocket();
		});

		var xhr = new XMLHttpRequest();
		xhr.open("GET", "./rev.txt", true);
		xhr.onload = function () {
			self.set('clientVersion', xhr.responseText);
		};
		xhr.send();
	},

	openWebSocket : function () {
		var self = this;

		console.log(self.settings);
		var address = self.settings.grblServer.address;
		if (self.settings.grblServer.addressAuto) {
			address = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host;
		}

		console.log('open websocket with address: ' + address);
		self.connection = new WebSocket(address);
		self.connection.onopen = function (e) {
			// opened but wait initialize message
			// so do nothing for this event
		};
		self.connection.onerror = function (e) {
			console.log('onerror', e);
			self.set('status.state', 'Unknown');
			self.set('error', e);
		};
		self.connection.onclose = function  (e) {
			console.log('onclose', e);
			self.set('status.state', 'Unknown');
			self.set('error', 'Disconnected');
			self.isConnected = false;

			setTimeout(function () {
				self.openWebSocket();
			}, 1000);
		};
		self.connection.onmessage = function (e) {
			var res = JSON.parse(e.data);
			if (res.id !== null) {
				var callback = self._callbacks[res.id];
				if (!callback) {
					console.log('unknwon callback id:', res.id, self._callbacks);
				}
				if (res.hasOwnProperty('error')) {
					callback.reject(res.error);
				} else {
					callback.resolve(res.result);
				}
				delete self._callbacks[res.id];
			} else {
				if (res.error) {
					self.set('error', [res.error.code, res.error.message, res.error.data].join(' : '));
				} else {
					self.processNotification(res.result);
				}
			}
		};
	},

	initialize : function () {
		var self = this;
		self.set('error', self.properties.error.value);
		self.set('status', self.properties.status.value);
		for (var key in self._callbacks) if (self._callbacks.hasOwnProperty(key)) {
			var val = self._callbacks[key];
			console.log('reject _callbacks');
			val.reject('resetted');
		}
		self._callbacks = {};
	},

	processNotification : function (res) {
		// console.log('processNotification', res);
		var self = this;
		if (res.type === 'init') {
			console.log('init');
			self.set('error', res.lastAlarm);
			self.set('status.state', res.status.state || 'Unknown');
			self.set('status.workingPosition', res.status.workingPosition);
			self.set('status.machinePosition', res.status.machinePosition);
			self.set('grblVersion', String(res.grblVersion.major) + res.grblVersion.minor);
			self.set('serverVersion', res.serverRev);
			self.set('lastAlarm', res.lastAlarm);
			if (res.lastAlarm) {
				if (self.status.state == 'Alarm') {
				//	self.openDialog(self.alarmDialog);
				}
			}

			if (res.lastFeedback) {
				var feeback = document.getElementById('feedback');
				feedback.text = res.lastFeedback;
				feedback.show();
			}

			self.isConnected = true;
		} else
		if (res.type === 'startup') {
			self.initialize();
			self.addCommandHistory('<<', res.raw);
			self.set('grblVersion', String(res.version.major) + res.version.minor);
		} else
		if (res.type === 'config') {
			console.log('update config', res.config);
			self.set('config', res.config);
		} else
		if (res.type === 'status') {
			self.set('status.state', res.status.state || 'Unknown');
			self.set('status.workingPosition', res.status.workingPosition);
			self.set('status.machinePosition', res.status.machinePosition);
		} else
		if (res.type === 'alarm') {
			self.set('error', res.message);
			self.addCommandHistory('<<', res.raw);

			self.set('lastAlarm', res.message);
			self.openDialog(self.alarmDialog);
		} else
		if (res.type === 'feedback') {
			var feeback = document.getElementById('feedback'); // no warnings
			feedback.text = res.message;
			feedback.show();
			self.addCommandHistory('<<', res.raw);
		} else
		if (res.type === 'gcode') {
			if (res.gcode) {
				self.set('gcode', {});
				for (var key in res.gcode) if (res.gcode.hasOwnProperty(key)) {
					self.set('gcode.' + key, res.gcode[key]);
				}
			} else {
				for (var key in self.gcode) if (self.gcode.hasOwnProperty(key)) {
					self.set('gcode.' + key, null);
				}
				self.set('gcode', null);
			}
			self.async(function () {
				var viewer = document.getElementById('viewer');
				viewer.rapidFeedRate = 800; // self.config['$110'];
				if (res.gcode) {
					viewer.initContext();

					var total = 0;
					var durations = [];
					var lines = res.gcode.sent.concat(res.gcode.remain);

					Promise.resolve().
						then( () => {
							function _loop() {
								var time = new Date().valueOf();
								var line;
								while ( (line = lines.shift()) !== undefined ) {
									var duration = viewer.executeBlock(line);
									total += duration;
									durations.push(duration);
									if (new Date().valueOf() - time > 24) break;
								}

								if (lines.length) {
									return Promise.resolve().then(_loop);
								}
							}
							return _loop();
						}).
						then( () => {
							self.set('gcode.total', total);
							self.set('gcode.durations', durations);
							console.log('loaded gcode', 'total', total, 'durations', durations);

							viewer.constructPathObject();

							for (var i = 0, len = res.gcode.sent.length; i < len; i++) {
								viewer.overridePathColor(i+1, "#000000");
							}
							viewer.render();
						});

				} else {
					viewer.clear();
				}
			});
		} else
		if (res.type === 'gcode.start') {
			self.set('gcode.startedTime', res.time);
		} else
		if (res.type === 'gcode.progress') {
			self.push('gcode.sent', self.shift('gcode.remain'));
			/*
			viewer.overridePathColor(self.gcode.sent.length, "#000000");
			viewer.render();
			*/
			self.async(function () {
				var container = this.$.gcodeList.parentNode;
				var target = container.querySelector('.remain');
				if (target) {
					container.scrollTop = target.offsetTop - 100;
				}
			});
		} else
		if (res.type === 'gcode.done') {
			self.set('gcode.finishedTime', res.time);
			document.getElementById('gcodeDone').show();
		}

		if (self.error == "'$H'|'$X' to unlock") {
			self.set('error', '');
		}

		if (self.status.state == 'Alarm') {
			self.openDialog(self.alarmResetDialog);
		} else {
			self.alarmResetDialog.close();
		}
	},

	request : function (method, params) {
		var self = this;

		return new Promise(function (resolve, reject) {
			var id = self._id++;
			self._callbacks[id] = {
				resolve: resolve,
				reject: reject
			};
			self.connection.send(JSON.stringify({
				id: id,
				method: method,
				params: params
			}));
		});
	},

	command : function (command) {
		var self = this;
		self.addCommandHistory('>>', command);
		return self.request('command', { command: command }).
			then(function (r) {
				if (r) {
					for (var i = 0, it; (it = r[i]); i++) {
						self.addCommandHistory('<<', it.raw);
					}
				}
				self.addCommandHistory('<<', 'ok');
				return Promise.resolve('ok');
			}, function (e) {
				self.addCommandHistory('<<', 'error:' + e.message);
				return Promise.reject(e.message);
			});
	},

	addCommandHistory : function (prefix, value) {
		var self = this;
		self.push('commandHistory', {
			prefix: prefix,
			value: value
		});
		while (self.commandHistory.length > 100) self.shift('commandHistory');
		self.async(function () {
			var history = document.getElementById('command-history');
			history.scrollTop = history.scrollHeight;
		});
	},

	resetToZero : function (e) {
		var target = Polymer.dom(e).path.filter(function (i) {
			return i.getAttribute && i.getAttribute('data-axis');
		})[0];
		var axis = target.getAttribute('data-axis');

		var command = axis.toUpperCase().split(/\s+/).map(function (a) {
			return a + '0';
		});

		this.command('G10 P0 L20 ' + command);
	},


	commandReturn : function () {
		this.command('G90 G0 X0 Y0');
		this.command('G90 G0 Z0');
	},

	commandMove : function (e) {
		var target = Polymer.dom(e).path.filter(function (i) {
			return i.getAttribute && i.getAttribute('data-axis');
		})[0];
		var axis = target.getAttribute('data-axis');
		var direction = +target.getAttribute('data-direction');

		var step = this.jogStep * direction;
		this.command('G21 G91 G0 ' + axis.toUpperCase() + step);
	},

	commandResume : function (e) {
		this.request('resume', {});
	},

	commandPause : function (e) {
		this.request('pause', {});
	},

	commandReset : function (e) {
		this.request('reset', {});
	},

	commandHoming : function (e) {
		this.command('$H');
	},

	commandUnlock : function (e) {
		this.command('$X');
	},

	commandRunGCode : function (e) {
		this.request('gcode', { execute: true });
	},

	commandClearUploadedFile : function (e) {
		this.request('gcode', { clear: true });
	},

	commandAny : function (e) {
		var self = this;
		if (e.key === 'Enter') {
			var value = e.target.value;
			e.target.value = "";
			self.commandHistoryIndex = 0;
			self.command(value);
		} else
		if (e.key === 'ArrowUp') {
			var history = self.commandHistory.filter(function (x) { return x.prefix === '>>' }).reverse();
			self.commandHistoryIndex++;
			if (self.commandHistoryIndex > history.length) {
				self.commandHistoryIndex = history.length;
			}
			try {
				e.target.value = history[self.commandHistoryIndex-1].value;
			} catch (e) { }
		} else
		if (e.key === 'ArrowDown') {
			var history = self.commandHistory.filter(function (x) { return x.prefix === '>>' }).reverse(); // no warnings
			if (self.commandHistoryIndex > 0) self.commandHistoryIndex--;
			try {
				e.target.value = history[self.commandHistoryIndex-1].value;
			} catch (e) { }
		}
	},

	formatCoords : function (number) {
		if (!number) number = 0;
		return sprintf('%s%03.3f', number < 0 ? '' : '+', number);
	},

	uploadFile : function (file) {
		var self = this;

		console.log('uploadFile');
		console.log(file.name, file.size);

		self.uploadDialog.refit();
		self.uploadDialog.open();
		self.set('upload.name', file.name);
		self.set('upload.size', file.size);
		self.set('upload.status', 'Loading...');
		self.set('upload.progress', 0);

		var reader = new FileReader();
		reader.onload = function (e) {
			self.set('upload.status', 'Uploading...');
			self.set('upload.progress', 0);

			var interval;

			self.request("upload", {
				name: file.name,
				size: file.size,
				gcode: reader.result 
			}).
				then(function () {
				}, function (e) {
					alert(e);
				}).
				then(function () {
					self.uploadDialog.close();
					clearInterval(interval);
				});

			var total = self.connection.bufferedAmount;
			interval = setInterval(function () {
				var remain = self.connection.bufferedAmount;
				var uploaded = total - remain;
				var percent = Math.round(upload / total) * 100;
				self.set('upload.progress', percent);
			}, 100);
		};
		reader.onerror = function (e) {
			console.log(e);
			alert(e);
			self.uploadDialog.close();
		};
		reader.onabort = function (e) {
			console.log(e);
			alert(e);
			self.uploadDialog.close();
		};
		reader.onloadstart = function (e) {
			console.log('onloadstart');
		};
		reader.onprogress = function (e) {
			console.log('onprogress');
			var percent = Math.round((e.loaded / e.total) * 100);
			self.set('upload.progress', percent);
		};
		reader.onloadend = function (e) {
			console.log('onloadend');
		};
		reader.readAsText(file, 'UTF-8');
	},

	changeStep : function (e) {
		var value = Polymer.dom(e).path.filter(function (i) {
			return i.getAttribute && i.getAttribute('data-value');
		})[0].getAttribute('data-value');

		this.set('jogStep', value);
	},

	computeBatchMode : function (started, finished, gcode) {
		var ret = false;
		if (started) {
			ret = true;
			if (finished) {
				ret = false;
			}
		}
		return ret;
	},

	openDialog : function (dialog) {
		var self = this;
		dialog.open();
		dialog.style.visibility = 'hidden';
		self.async(function() {
			dialog.refit();
			dialog.style.visibility = 'visible';
		}, 10);
	},

	initializeDefaultSettings : function () {
		this.settings = {
			macros : [
				{
					id: '1',
					label: "G28",
					gcode: "G28"
				}
			],
			grblServer : {
				address: "",
				addressAuto: true
			}
		};
	},

	settingsAddMacro : function () {
		this.set('currentEdittingMacro', {
			label: '',
			gcode: ''
		});
	},

	settingsEditMacro : function (e) {
		var target = Polymer.dom(e).path.filter(function (i) {
			return i.getAttribute && i.getAttribute('data-item');
		})[0];
		var itemId = target.getAttribute('data-item');
		var item = this.settings.macros.filter(function (i) { return i.id == itemId })[0];
		this.set('currentEdittingMacro', item);
	},


	settingsDoMacro : function (e) {
		var target = Polymer.dom(e).path.filter(function (i) {
			return i.getAttribute && i.getAttribute('data-item');
		})[0];
		var itemId = target.getAttribute('data-item');
		var item = this.settings.macros.filter(function (i) { return i.id == itemId })[0];
		var lines = item.gcode.split(/\n/);
		for (var i = 0, len = lines.length; i < len; i++) {
			this.command(lines[i]);
		}
	},

	settingsSaveMacro : function () {
		var item = this.currentEdittingMacro;
		if (item.id) {
			for (var i = 0, it; (it = this.settings.macros[i]); i++) {
				if (it.id === item.id) {
					this.splice('settings.macros', i, 1, item);
					break;
				}
			}
		} else {
			item.id = Math.random().toString(32).substring(2);
			this.push('settings.macros', item);
		}
		this.set('currentEdittingMacro', null);
	},

	settingsRemoveMacro : function () {
		if (confirm('Sure to remove?')) {
			var item = this.currentEdittingMacro;
			for (var i = 0, it; (it = this.settings.macros[i]); i++) {
				if (it.id === item.id) {
					this.splice('settings.macros', i, 1);
					break;
				}
			}
			this.set('currentEdittingMacro', null);
		}
	},

	_configChanged : function (config) {
		console.log('configChanged', config);
		this.set('settings.grbl', {});
		for (var key in config) if (config.hasOwnProperty(key)) {
			var value;
			if (key === '$20') {
				value = !!+config[key];
			} else
			if (key === '$21') {
				value = !!+config[key];
			} else {
				value = +config[key];
			}
			this.set('settings.grbl.' + key, value);
		}
	},

	settingsSaveGrblConfig : function () {
		var self = this;
		var config = self.config;
		var newConfig = self.settings.grbl;
		var changes = [];
		for (var key in config) if (config.hasOwnProperty(key)) {
			if (config[key] != newConfig[key]) {
				changes.push(key + '=' + Number(newConfig[key]));
			}
		}

		console.log(changes);

		Promise.all(
			changes.map(function (i) { return self.command(i).catch(function (e) { return e }) })
		).then(function (results) {
			console.log(results);
			return self.request('command', { command: '$$' });
		});
	},

	computeProgress : function () {
		if (!this.gcode) return 0;
		var progress = {
		};
		try {
			progress.sentTime = this.gcode.durations.slice(0, this.gcode.sent.length).reduce(function (i, r) {
				return i + r;
			});
			progress.remainTime = this.gcode.total - progress.sentTime;
			progress.percentRaw = progress.sentTime / this.gcode.total * 100;
			// console.log('progress','total', this.gcode.total, '=', progress);
		} catch (e) {
			console.log(e);
			progress.percentRaw = (this.gcode.sent.length / (this.gcode.total) * 100);
		}
		progress.percent = Math.round(progress.percentRaw);
		progress.elapsed = (new Date().getTime() - this.gcode.startedTime) / 1000;
		return progress;
	},

	_settingsChanged : function (change) {
		var self = this;
		// console.log('_settingsChanged', change);
		if (change.path.indexOf('settings.grblServer') === 0) {
			console.log('settings.grblServer is changed. close and reconnect');
			self.connection.close();
		}
	},

	_submenuChanged : function (change) {
		var targets = [
			[ 'coords', 'jogging', 'macros', 'command-upload', 'preview' ],
			[ 'coords', 'jogging', 'macros' ],
			[ 'command-upload' ],
			[ 'preview' ]
		];

		var all = targets[0];

		if (change === 0) {
			for (var i = 0, it; (it = all[i]); i++) {
				document.getElementById(it).style.display = '';
			}
		} else {
			for (var i = 0, it; (it = all[i]); i++) {
				document.getElementById(it).style.display = 'none';
			}

			var target = targets[change];
			for (var i = 0, it; (it = target[i]); i++) {
				document.getElementById(it).style.display = 'flex';
			}
		}

		var viewer = document.getElementById('viewer');
		if (viewer) {
			viewer.refit();
		}
	},

	_gcodeChanged : function () {
		this.debounce('gcode-changed', () => {
			var container = this.$.gcodeList;
			container.innerHTML = '';

			console.log('gcode changed', this.gcode);
			if (!this.gcode || !this.gcode.sent) return;

			var html = '';
			for (var i = 0, len = this.gcode.sent.length; i < len; i++) {
				html += '<div class="my-app line sent">' + escape(this.gcode.sent[i]) + '</div>'
			}
			for (var i = 0, len = this.gcode.remain.length; i < len; i++) {
				html += '<div class="my-app line remain">' + escape(this.gcode.remain[i]) + '</div>'
			}
			container.innerHTML = html;
			
			function escape (str) {
				return str.replace(/[&<>]/g, function (e) {
					return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[e];
				});
			}
		}, 100);
	},

	bind: function (id) { return id },
	equals: function (a, b) { return a == b },
	conditional: function (bool, a, b) { return bool ? a : b; },
	sprintf: sprintf,
	strftime: function (format, epoch) {
		if (!epoch) return "";
		var date = new Date(epoch);
		return strftime(format, date);
	},
	duration: function (number) {
		return Math.round(number / 60) + "min";
	}
});

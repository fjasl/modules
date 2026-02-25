imports.gi.versions.Gtk = '3.0';
imports.gi.versions.Astal = '3.0';
imports.gi.versions.Gdk = '3.0';
imports.gi.versions.AstalTray = '0.1';
imports.gi.versions.AstalMpris = '0.1';

const { Gtk, Astal, GLib, Gdk } = imports.gi;
const Battery = imports.gi.AstalBattery;
const Network = imports.gi.AstalNetwork;
const Wp = imports.gi.AstalWp;
const Tray = imports.gi.AstalTray;
const Mpris = imports.gi.AstalMpris;

const app = new Astal.Application({
    instance_name: "my-bar"
});

// 通用执行命令函数
function execAsync(cmd) {
    try {
        GLib.spawn_command_line_async(cmd);
    } catch (e) {
        print("Exec error: " + e);
    }
}

// 辅助函数：创建带点击和提示音的模块（使用 Gtk.Button）
function createWidget(className) {
    const btn = new Gtk.Button();
    const label = new Gtk.Label();
    btn.add(label);

    // 应用样式
    btn.get_style_context().add_class("module");
    btn.get_style_context().add_class(className);

    return { btn, label };
}

// ==========================================
// 1. 时钟模块 (Clock)
// ==========================================
function ClockWidget() {
    const { btn, label } = createWidget("clock");

    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
        const date = new Date();
        const format = `${date.getMonth() + 1}-${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        label.set_label(` ${format}`);

        // 悬浮显示完整日期
        btn.set_tooltip_text(date.toLocaleDateString() + " " + date.toLocaleTimeString());

        return true;
    });

    return btn;
}

// ==========================================
// 2. 音量模块 (Volume/Wireplumber)
// ==========================================
function VolumeWidget() {
    const { btn, label } = createWidget("volume");
    label.set_label("  ...%");

    btn.connect("clicked", () => {
        execAsync("pavucontrol");
    });

    const wp = Wp.get_default();
    if (wp) {
        const setupAudio = () => {
            if (wp.audio) {
                const updateVol = () => {
                    const speaker = wp.audio.default_speaker;
                    if (!speaker) return;
                    // 使用真正的底层真实音量值，乘以 100 并去除小数
                    const trueVol = Math.floor(speaker.volume * 100);
                    if (speaker.mute) {
                        label.set_label(`  Muted`);
                        btn.set_tooltip_text(`Audio Muted`);
                    } else {
                        label.set_label(`  ${trueVol}%`);
                        btn.set_tooltip_text(`Volume: ${trueVol}%`);
                    }
                };

                // 监听默认音频的变化
                wp.audio.connect("notify::default-speaker", () => {
                    if (wp.audio.default_speaker) {
                        wp.audio.default_speaker.connect("notify::volume", updateVol);
                        wp.audio.default_speaker.connect("notify::mute", updateVol);
                        updateVol();
                    }
                });

                if (wp.audio.default_speaker) {
                    wp.audio.default_speaker.connect("notify::volume", updateVol);
                    wp.audio.default_speaker.connect("notify::mute", updateVol);
                    updateVol();
                }
            }
        };

        wp.connect("notify::audio", setupAudio);
        setupAudio(); // 立即执行一次以防已经初始化完成
    }

    return btn;
}

// ==========================================
// 3. 电池模块 (Battery)
// ==========================================
function BatteryWidget() {
    const { btn, label } = createWidget("battery");
    label.set_label("  ...%");

    const bat = Battery.get_default();
    if (bat) {
        const updateBat = () => {
            // 如果是台式机（没有电池），由于接通电源，强制显示 100%
            if (bat.is_present === false) {
                label.set_label("  100%"); //  是插头图标
                btn.set_tooltip_text("Desktop (AC Power)");
                return;
            }

            const perc = Math.floor(bat.percentage * 100);
            const icon = bat.charging ? "" : "";
            label.set_label(`${icon}  ${perc}%`);

            // 悬浮显示电池状态
            let stateStr = bat.charging ? "Charging" : "Discharging";
            if (bat.percentage === 1) stateStr = "Fully Charged";
            btn.set_tooltip_text(`${stateStr} (${perc}%)`);
        };

        if (typeof bat.is_present !== 'undefined') {
            bat.connect("notify::is-present", updateBat);
        }
        bat.connect("notify::percentage", updateBat);
        bat.connect("notify::charging", updateBat);
        updateBat();
    }

    return btn;
}

// ==========================================
// 4. 网络模块 (Network)
// ==========================================
function NetworkWidget() {
    const { btn, label } = createWidget("network");
    label.set_label("󰈀  ...");

    // 点击打开网络控制面板 (可以后续配置成 nm-connection-editor 等)
    btn.connect("clicked", () => {
        execAsync("nm-connection-editor");
    });

    const net = Network.get_default();
    if (net) {
        const updateNet = () => {
            if (net.wifi && net.wifi.ssid) {
                label.set_label(`  ${net.wifi.ssid}`);
                let str = `WiFi: ${net.wifi.ssid}`;
                if (net.wifi.internet === Network.Internet.CONNECTED) str += " (Connected)";
                btn.set_tooltip_text(str);
            } else if (net.wired && net.wired.state === Network.DeviceState.ACTIVATED) {
                // 修复图标为 󰈀 (有线网络通用图标)
                label.set_label(`󰈀  Wired`);
                btn.set_tooltip_text(`Ethernet Connected`);
            } else {
                label.set_label(`⚠ 离线`);
                btn.set_tooltip_text(`No Connection`);
            }
        };

        net.connect("notify::wifi", () => {
            if (net.wifi) {
                net.wifi.connect("notify::ssid", updateNet);
                updateNet();
            }
        });

        net.connect("notify::wired", () => {
            if (net.wired) {
                net.wired.connect("notify::state", updateNet);
                updateNet();
            }
        });
        updateNet();
    }

    return btn;
}

// ==========================================
// 5. 内存使用率模块 (RAM Widget)
// ==========================================
function MemoryWidget() {
    const { btn, label } = createWidget("memory");
    label.set_label("  ...%");

    // 每 2 秒读取一次 /proc/meminfo
    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
        try {
            const [, contents] = GLib.file_get_contents('/proc/meminfo');
            const lines = (new TextDecoder('utf-8')).decode(contents).split('\n');
            let memTotal = 0, memAvailable = 0;

            for (const line of lines) {
                if (line.startsWith('MemTotal:')) {
                    memTotal = parseInt(line.replace(/[^0-9]/g, ''));
                } else if (line.startsWith('MemAvailable:')) {
                    memAvailable = parseInt(line.replace(/[^0-9]/g, ''));
                }
            }

            if (memTotal > 0) {
                const used = memTotal - memAvailable;
                const perc = Math.round((used / memTotal) * 100);
                label.set_label(`  ${perc}%`);

                // 悬浮显示具体数值(GB)
                const usedGb = (used / 1024 / 1024).toFixed(1);
                const totalGb = (memTotal / 1024 / 1024).toFixed(1);
                btn.set_tooltip_text(`RAM: ${usedGb} / ${totalGb} GB`);
            }
        } catch (e) {
            print("Memory read error: " + e);
        }
        return true;
    });

    return btn;
}

// ==========================================
// 6. CPU 使用率模块 (CPU Widget)
// ==========================================
function CpuWidget() {
    const { btn, label } = createWidget("cpu");
    label.set_label("  ...%");

    let prevIdle = 0, prevTotal = 0;

    // 每 2 秒读取一次 /proc/stat
    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
        try {
            const [, contents] = GLib.file_get_contents('/proc/stat');
            const lines = (new TextDecoder('utf-8')).decode(contents).split('\n');
            const cpuLine = lines[0].split(/\s+/);

            // stat 行格式: cpu user nice system idle iowait irq softirq steal guest guest_nice
            if (cpuLine[0] === 'cpu') {
                const user = parseInt(cpuLine[1]);
                const nice = parseInt(cpuLine[2]);
                const system = parseInt(cpuLine[3]);
                const idle = parseInt(cpuLine[4]);
                const iowait = parseInt(cpuLine[5]);
                const irq = parseInt(cpuLine[6]);
                const softirq = parseInt(cpuLine[7]);
                const steal = parseInt(cpuLine[8]);

                const totalIdle = idle + iowait;
                const totalNonIdle = user + nice + system + irq + softirq + steal;
                const total = totalIdle + totalNonIdle;

                const totalDiff = total - prevTotal;
                const idleDiff = totalIdle - prevIdle;

                if (prevTotal !== 0) {
                    const cpuPerc = Math.round((1000 * (totalDiff - idleDiff) / totalDiff) / 10);
                    label.set_label(`  ${cpuPerc}%`);
                    btn.set_tooltip_text(`CPU Usage: ${cpuPerc}%`);
                }

                prevTotal = total;
                prevIdle = totalIdle;
            }
        } catch (e) {
            print("CPU read error: " + e);
        }
        return true;
    });

    return btn;
}

// ==========================================
// 7. 电源控制模块 (Power Menu)
// ==========================================
function PowerWidget() {
    const { btn, label } = createWidget("power");
    label.set_label("");

    // 点击弹出选择或者直接由于演示我们执行注销/关机
    // 这里采用直接执行电源菜单的方式, 如果您配置了 wlogout, 此处可以 execAsync("wlogout")
    btn.connect("clicked", () => {
        // 构建一个简单的 GTK 原生托盘菜单，以符合 AGS 特色
        const menu = new Gtk.Menu();

        const itemShutdown = new Gtk.MenuItem({ label: "  关机 (Shutdown)" });
        itemShutdown.connect("activate", () => execAsync("systemctl poweroff"));

        const itemReboot = new Gtk.MenuItem({ label: "󰜉  重启 (Reboot)" });
        itemReboot.connect("activate", () => execAsync("systemctl reboot"));

        const itemLogout = new Gtk.MenuItem({ label: "󰍃  注销 (Logout)" });
        // Hyprland 退出指令
        itemLogout.connect("activate", () => execAsync("hyprctl dispatch exit"));

        menu.append(itemShutdown);
        menu.append(itemReboot);
        menu.append(itemLogout);
        menu.show_all();

        // 弹出菜单，将其定位在按钮下方
        menu.popup_at_widget(btn, Gdk.Gravity.SOUTH, Gdk.Gravity.NORTH, null);
    });

    btn.set_tooltip_text("电源控制");
    return btn;
}

// ==========================================
// 8. 系统托盘模块 (System Tray)
// ==========================================
function TrayWidget() {
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 4
    });
    box.get_style_context().add_class("tray");

    const tray = Tray.get_default();

    if (tray) {
        // 保存当前所有的可显示 item 的引用
        let itemWidgets = new Map();

        const updateTray = () => {
            const items = tray.get_items();

            // 移除已经不存在的图标
            for (const [id, widget] of itemWidgets.entries()) {
                if (!items.find(i => i.item_id === id)) {
                    box.remove(widget);
                    widget.destroy();
                    itemWidgets.delete(id);
                }
            }

            // 添加新出现的图标
            for (const item of items) {
                if (!itemWidgets.has(item.item_id)) {
                    const btn = new Gtk.Button();
                    const icon = new Gtk.Image();

                    // 双向绑定图标名称（响应式更新）
                    const updateIcon = () => icon.set_from_icon_name(item.icon_name, Gtk.IconSize.MENU);
                    item.connect("notify::icon-name", updateIcon);
                    updateIcon();

                    btn.add(icon);
                    btn.get_style_context().add_class("tray-item");

                    // 绑定托盘的标题或者提示
                    if (item.title) btn.set_tooltip_text(item.title);
                    else if (item.id) btn.set_tooltip_text(item.id);

                    // 绑定点击事件，呼出托盘菜单或动作
                    btn.connect("clicked", () => {
                        item.activate(0, 0); // 触发应用的主要逻辑
                    });

                    // 此处暂时省略了右键触发 context_menu 的逻辑，以保持简单

                    itemWidgets.set(item.item_id, btn);
                    box.add(btn);
                }
            }

            // 如果托盘是空的，就隐藏整个盒子，否则显示
            if (items.length === 0) {
                box.hide();
            } else {
                box.show_all();
            }
        };

        tray.connect("notify::items", updateTray);
        updateTray();
    }

    return box;
}

// ==========================================
// 8.5 媒体播放控制 (MPRIS)
// ==========================================
function MprisWidget() {
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 4
    });
    box.get_style_context().add_class("mpris-box");

    const mpris = Mpris.get_default();
    if (!mpris) return box;

    let currentPlayerWidget = null;
    let fallbackLabel = null; // 用于存放没有播放器时的提示语或者直接隐藏

    const updateMpris = () => {
        const players = mpris.get_players();

        let player = null;
        if (players.length > 0) {
            // 优先查找名为 agplayer 的自定义播放器 (内部 identity 是 'AG Audio')
            const agplayer = players.find(p => p.identity && p.identity.toLowerCase().includes("ag audio"));
            player = agplayer ? agplayer : players[0];
        }

        // 如果之前有播放器控件，先清空盒子
        if (currentPlayerWidget) {
            box.remove(currentPlayerWidget);
            currentPlayerWidget.destroy();
            currentPlayerWidget = null;
        }
        if (fallbackLabel) {
            box.remove(fallbackLabel);
            fallbackLabel.destroy();
            fallbackLabel = null;
        }

        if (player) {
            const btn = new Gtk.Button();
            btn.get_style_context().add_class("mpris-item");

            const label = new Gtk.Label();
            // 响应特定播放器的元数据或状态变化
            const syncPlayer = () => {
                const title = player.title || "Unknown";
                const artist = player.artist ? player.artist : "";
                const playing = player.playback_status === Mpris.PlaybackStatus.PLAYING;

                const icon = playing ? "󰎆" : "▶️"; // 播放音乐图标 / 暂停图标
                let text = `${icon}  ${title}`;
                if (artist) text += ` · ${artist}`;

                // 限制最长显示字符防止把顶栏撑开太大
                if (text.length > 10) text = text.substring(0, 7) + "...";

                label.set_label(text);
                btn.set_tooltip_text(`Source: ${player.identity}\nStatus: ${playing ? 'Playing' : 'Paused'}\n${title} by ${artist}`);
            };

            // 监听这个播放器内部的数据变动
            player.connect("notify::title", syncPlayer);
            player.connect("notify::artist", syncPlayer);
            player.connect("notify::playback-status", syncPlayer);
            syncPlayer();

            // 点击播放/暂停
            // btn.connect("clicked", () => {
            //     player.play_pause();
            // });
            btn.connect("button-press-event", (widget, event) => {
                const [, button] = event.get_button(); // 获取按下的鼠标按键编号

                if (button === 3) {
                    // 3 代表鼠标右键
                    player.next();
                    return true; // 返回 true 阻止事件继续传播
                }
                else if (button === 2) {
                    // 2 代表鼠标中键（滚轮按下），你可以顺便加个中键上一首
                    player.previous();
                    return true;
                }
                else if (button === 1) {
                    player.play_pause();
                    return true;
                }

                return false; // 左键(1)等其他按键返回 false，放行给默认的 clicked 信号处理
            });

            btn.add(label);
            box.add(btn);
            currentPlayerWidget = btn;
            box.show_all();
        } else {
            // 没有播放器的时候隐藏组件或者显示占位
            // box.hide(); 也可以这样完全隐藏
            fallbackLabel = new Gtk.Label({ label: "󰝚  No Media" });
            fallbackLabel.get_style_context().add_class("mpris-empty");
            // box.add(fallbackLabel);
            // box.show_all();

            // 为了美观，没播放的时候彻底隐藏左边
            box.hide();
        }
    };

    mpris.connect("notify::players", updateMpris);
    updateMpris();

    return box;
}

// ==========================================
// 8.6 首先定义监听 agplayer 歌词的组件
// ==========================================
function LyricsWidget() {
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 4
    });
    box.get_style_context().add_class("lyrics-box");

    const btn = new Gtk.Button();
    const label = new Gtk.Label({ label: "󰝚  ..." });
    btn.add(label);
    btn.get_style_context().add_class("lyrics-item");
    box.add(btn);

    // 持续监听 socat UNIX SOCKET 数据获取歌词
    const socketPath = "/tmp/agplayer-waybar.sock";

    // 添加 0.5 秒 sleep 避免服务端频繁断开导致的超级轮询消耗 CPU
    const cmd = `bash -c "while true; do if [ -S ${socketPath} ]; then stdbuf -oL socat -u UNIX-CONNECT:${socketPath} STDOUT 2>/dev/null; else sleep 2; fi; done"`;

    try {
        const [, pid, stdin, stdout, stderr] = GLib.spawn_async_with_pipes(
            null,
            ["bash", "-c", cmd],
            null,
            GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
            null
        );

        const ioChannel = GLib.IOChannel.unix_new(stdout);

        // 创建一个动态 CSS 注入器来实现进度条底边框
        const cssProvider = new Gtk.CssProvider();
        btn.get_style_context().add_provider(cssProvider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

        GLib.io_add_watch(ioChannel, GLib.PRIORITY_DEFAULT, GLib.IOCondition.IN | GLib.IOCondition.HUP, (source, condition) => {
            if (condition & GLib.IOCondition.HUP) return false;

            try {
                const [status, outLine] = ioChannel.read_line();
                if (status === GLib.IOStatus.NORMAL && outLine) {
                    const lineStr = outLine.toString().trim();
                    if (lineStr.startsWith("{")) {
                        const data = JSON.parse(lineStr);
                        if (data && data.text && data.text !== "Offline") {
                            label.set_label(`󰎆  ${data.text}`);
                            if (data.tooltip) btn.set_tooltip_text(data.tooltip);

                            // 读取进度 (以 percentage: 0~100 或者 progress: 0~1 为准)
                            let prog = 0;
                            if (typeof data.percentage === 'number') {
                                prog = data.percentage;
                            } else if (typeof data.progress === 'number') {
                                prog = data.progress * 100;
                            }

                            // 动态注入底边框 CSS (利用背景渐变充当实线，#f9e2af 为亮黄色)
                            // 注意：需要在这里覆盖 style.css 里的 background-color 以保持悬浮效果不受干扰，但为了简单我们直接覆盖背景
                            const css = `
                                button.lyrics-item {
                                    background-image: linear-gradient(to right, #f9e2af ${prog}%, transparent ${prog}%);
                                    background-size: 100% 1px;
                                    background-position: bottom;
                                    background-repeat: no-repeat;
                                    border-bottom: none; /* 移除固定的静态边框，改用背景充当动态边框 */
                                }
                            `;
                            cssProvider.load_from_data(css);

                            box.show_all();
                        } else {
                            box.hide(); // Offline 时隐藏歌词
                        }
                    } else if (lineStr && lineStr !== "Offline") {
                        label.set_label(`󰎆  ${lineStr}`);
                        box.show_all();
                    }
                }
            } catch (e) { }
            return true;
        });

    } catch (e) {
        print("Failed to spawn lyrics listener: " + e);
    }

    // 初始先隐藏
    box.hide();
    return box;
}

// ==========================================
// 8.7 左侧栏 (Left Side)
// ==========================================
function LeftModules() {
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 12,
        halign: Gtk.Align.START // 靠左对齐
    });

    box.get_style_context().add_class("modules-left");

    // 将歌词挂载到左边 (之前 MPRIS 已经被挪到右边了)
    const _lyrics = LyricsWidget();
    box.add(_lyrics);

    return box;
}

// ==========================================
// 9. 将所有组件装进一个水平的栏 (Right Side)
// ==========================================
function RightModules() {
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 4, // <-- 这里是我们调整各个小组件之间空隙的地方，原来是 12，改小为 4
        halign: Gtk.Align.END
    });
    const _mpris = MprisWidget();
    const _tray = TrayWidget();
    const _cpu = CpuWidget();
    const _mem = MemoryWidget();
    const _net = NetworkWidget();
    const _vol = VolumeWidget();
    const _bat = BatteryWidget();
    const _clk = ClockWidget();
    const _power = PowerWidget();

    box.get_style_context().add_class("modules-right");

    box.add(_mpris);
    box.add(_cpu);
    box.add(_mem);
    box.add(_net);
    box.add(_vol);
    box.add(_bat);
    box.add(_clk);
    box.add(_tray);
    box.add(_power);

    return box;
}

// ==========================================
// 9. 主窗口设置
// ==========================================
app.connect("activate", () => {
    // 载入 CSS 样式表 
    const provider = new Gtk.CssProvider();
    provider.load_from_path(GLib.get_current_dir() + "/style.css");
    Gtk.StyleContext.add_provider_for_screen(
        Gdk.Screen.get_default(),
        provider,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
    );

    const window = new Astal.Window({
        application: app,
        anchor: Astal.WindowAnchor.TOP | Astal.WindowAnchor.LEFT | Astal.WindowAnchor.RIGHT,
        name: "bar",
        app_paintable: true,

        // --- 下面这行用来选择显示器 ---
        // 比如想只显示在副屏，可以解开这行注释并获取特定的显示器 (例如0是主屏，1是副屏)
        gdkmonitor: Gdk.Display.get_default().get_monitor(1),

        // *** 申请独占空间，也就是您提到的占用顶栏空间不被遮挡 ***
        exclusivity: Astal.Exclusivity.EXCLUSIVE
    });

    // 我们用一个整体的对齐盒子来装内层容器，以实现边距
    const alignBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL
    });

    // 主容器：带背景、药丸形状、内外边距
    const barContainer = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
    });
    barContainer.get_style_context().add_class("bar-container");

    const spacer = new Gtk.Label({ hexpand: true });

    barContainer.add(LeftModules()); // 引入左侧栏
    barContainer.add(spacer);
    barContainer.add(RightModules());

    alignBox.add(barContainer);

    window.add(alignBox);
    window.show_all();
});



app.run(null);

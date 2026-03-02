imports.gi.versions.Gtk = '3.0';
imports.gi.versions.Astal = '3.0';
imports.gi.versions.Gdk = '3.0';
imports.gi.versions.AstalTray = '0.1';
imports.gi.versions.AstalMpris = '0.1';

const { Gtk, Astal, GLib, Gdk, Gio } = imports.gi;
const GioUnix = imports.gi.GioUnix;
const System = imports.system; // 用于调试垃圾回收
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
    let playerSignals = []; // Store signal IDs for cleanup
    let lastPlayerRef = null; // 存放上一次绑定的 player 引用

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
            // Disconnect old signals from the OLD player reference
            if (playerSignals.length > 0 && lastPlayerRef) {
                playerSignals.forEach(sigId => {
                    try { lastPlayerRef.disconnect(sigId); } catch (e) { }
                });
                playerSignals = [];
            }
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
            lastPlayerRef = player;
            playerSignals = [
                player.connect("notify::title", syncPlayer),
                player.connect("notify::artist", syncPlayer),
                player.connect("notify::playback-status", syncPlayer)
            ];
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
    const socketPath = "/tmp/agplayer-waybar-lyrics.sock";

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

        const ioStream = new GioUnix.InputStream({ fd: stdout, close_fd: true });
        const dataStream = new Gio.DataInputStream({ base_stream: ioStream, close_base_stream: true });

        let currentProg = 0; // 当前需要的绘制百分底

        // 【用原生重绘代替 CSS 防止内存泄漏】
        // 覆盖掉原本 style.css 里的动态 background-image，以及把底边框设为透明或 none
        // 这样避免因为我们去除了定时器中的 CSS，导致以前的旧 CSS 被错误地挂载
        const cssProvider = new Gtk.CssProvider();
        cssProvider.load_from_data("button.lyrics-item { border-bottom: none; background-image: none; }");
        btn.get_style_context().add_provider(cssProvider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

        // 直接用 Gtk.Button 的自绘钩子实现底边框进度条。这样不会破坏按钮原有的 box 模型和 padding！
        btn.connect_after("draw", (widget, cr) => {
            const width = widget.get_allocated_width();
            const height = widget.get_allocated_height();

            const progWidth = width * (currentProg / 100);

            if (progWidth > 0 && currentProg > 0) {
                cr.setSourceRGBA(249 / 255, 226 / 255, 175 / 255, 1.0);
                cr.rectangle(0, height - 2, progWidth, 2); // 这里用 2px 是因为你的原版 CSS 里用的也是 border-bottom: 2px 
                cr.fill();
            }

            return false;
        });

        // 用于节流更新的状态变量
        let pendingProg = null;
        let pendingLabel = null;
        let pendingTooltip = null;
        let needUpdate = false;
        // 记录上一次渲染的值，用于去重
        let lastProg = null;
        let lastLabel = null;
        let lastTooltip = null;

        // 10Hz 定时器批量更新 UI（每 100 ms）
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            if (needUpdate) {
                const prog = pendingProg !== null ? pendingProg : 0;
                // 只在值真正变化时才更新 UI，避免重复渲染
                if (prog !== lastProg || pendingLabel !== lastLabel || pendingTooltip !== lastTooltip) {
                    // 通知组件重绘进度条，不再拼接 CSS
                    currentProg = prog;
                    btn.queue_draw();

                    if (pendingLabel !== null) {
                        label.set_label(pendingLabel);
                    } else {
                        label.set_label("");
                    }
                    if (pendingTooltip) {
                        btn.set_tooltip_text(pendingTooltip);
                    }

                    // 根据是否有内容决定显示/隐藏
                    if (prog > 0 || pendingLabel) {
                        box.show_all();
                    } else {
                        box.hide();
                    }

                    // 记录本次渲染的状态用于下次去重
                    lastProg = prog;
                    lastLabel = pendingLabel;
                    lastTooltip = pendingTooltip;
                }
                needUpdate = false;
            }
            return true; // 持续运行
        });

        const handleRead = (stream, res) => {
            try {
                const [lineStrOrg, length] = stream.read_line_finish_utf8(res);
                if (lineStrOrg !== null) {
                    const lineStr = lineStrOrg.trim();
                    if (lineStr.startsWith("{")) {
                        const data = JSON.parse(lineStr);
                        if (data && data.type !== "spectrum" && data.text && data.text !== "Offline") {
                            pendingLabel = `󰎆  ${data.text}`;
                            pendingTooltip = data.tooltip || null;
                            let prog = 0;
                            if (typeof data.percentage === 'number') {
                                prog = data.percentage;
                            } else if (typeof data.progress === 'number') {
                                prog = data.progress * 100;
                            }
                            pendingProg = prog;
                            needUpdate = true;
                        } else if (data && data.text === "Offline") {
                            pendingLabel = "";
                            pendingProg = 0;
                            pendingTooltip = null;
                            needUpdate = true;
                        }
                    } else if (lineStr && lineStr !== "Offline") {
                        pendingLabel = `󰎆  ${lineStr}`;
                        pendingProg = 0;
                        pendingTooltip = null;
                        needUpdate = true;
                    }

                    // 继续读取下一行，传递当前具名函数指针，防止产生无限的新闭包导致跨界内存泄漏
                    stream.read_line_async(GLib.PRIORITY_DEFAULT, null, handleRead);
                }
            } catch (e) {
                // 出错或 EOF 忽略
            }
        };
        dataStream.read_line_async(GLib.PRIORITY_DEFAULT, null, handleRead);

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
// 8.7.5 中间栏 (Center Side)
// ==========================================
function CenterModules() {
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        halign: Gtk.Align.CENTER
    });

    box.get_style_context().add_class("modules-center");

    // 将频谱图挂载到中间


    box.show_all();
    return box;
}

// ==========================================
// 8.8 频谱可视化 (Spectrum)
// ==========================================
function SpectrumWidget() {
    // 创建一个外层容器来挂载和其它按钮一样的背景样式
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
    });
    box.get_style_context().add_class("spectrum-box");

    // 使用 Gtk.DrawingArea 绘制频谱
    const drawingArea = new Gtk.DrawingArea();
    drawingArea.set_size_request(100, 16); // 宽度150px，高度16px适配按钮内部
    drawingArea.valign = Gtk.Align.CENTER; // 垂直居中
    drawingArea.get_style_context().add_class("spectrum-area");

    box.add(drawingArea);

    let targetSpectrum = new Array(10).fill(0);
    let renderedSpectrum = new Array(10).fill(0);

    // Cairo 绘图回调
    drawingArea.connect("draw", (widget, cr) => {
        const width = widget.get_allocated_width();
        const height = widget.get_allocated_height();

        // 背景透明，不需要清空

        const numBars = targetSpectrum.length;
        if (numBars === 0) return false;

        const barWidth = width / numBars;
        const spacing = 1;

        // 设置柱子颜色 (类似亮黄色 #f9e2af)
        cr.setSourceRGBA(249 / 255, 226 / 255, 175 / 255, 0.9);

        for (let i = 0; i < numBars; i++) {
            // 平滑插值 (动画过渡)，数字 0.3 是插值速度（缓动系数）
            renderedSpectrum[i] += (targetSpectrum[i] - renderedSpectrum[i]) * 0.3;

            // 振幅值，防止越界
            const val = Math.max(0, Math.min(1.0, renderedSpectrum[i]));
            // 将 0~1 映射到像素高度
            const barHeight = height * val;

            // 左下角起绘制矩形
            const x = i * barWidth + spacing / 2;
            const y = height - barHeight;
            const w = barWidth - spacing;
            const h = barHeight;

            // 只有有高度的高度才绘制
            if (h > 0) {
                // 圆角或者平角矩形，这里用最简单的平角
                cr.rectangle(Math.floor(x), Math.floor(y), Math.floor(w), Math.ceil(h));
                cr.fill();
            }
        }

        return false;
    });

    // 60FPS 动画循环驱动
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
        let needDraw = false;
        for (let i = 0; i < 10; i++) {
            // 如果显示的数组与目标数组差异仍然＞0.01，则继续要求重绘
            if (Math.abs(targetSpectrum[i] - renderedSpectrum[i]) > 0.01) {
                needDraw = true;
                break;
            }
        }
        if (needDraw) {
            drawingArea.queue_draw();
        }
        return true;
    });

    // 同样开启一个后台 socat 监听，但专门过滤 type: "spectrum" 的包
    const socketPath = "/tmp/agplayer-waybar-spectrum.sock";
    const cmd = `bash -c "while true; do if [ -S ${socketPath} ]; then stdbuf -oL socat -u UNIX-CONNECT:${socketPath} STDOUT 2>/dev/null; else sleep 2; fi; done"`;

    try {
        const [, pid, stdin, stdout, stderr] = GLib.spawn_async_with_pipes(
            null, ["bash", "-c", cmd], null,
            GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
            null
        );

        const ioStream = new GioUnix.InputStream({ fd: stdout, close_fd: true });
        const dataStream = new Gio.DataInputStream({ base_stream: ioStream, close_base_stream: true });

        // 提取命名的回调函数供后续循环利用，杜绝 60Hz 匿名闭包的巨大跨界内存泄漏
        const handleRead = (stream, res) => {
            try {
                const [lineStrOrg, length] = stream.read_line_finish_utf8(res);
                if (lineStrOrg !== null) {
                    const lineStr = lineStrOrg.trim();
                    if (lineStr.startsWith("{")) {
                        const data = JSON.parse(lineStr);
                        if (data && data.type === "spectrum" && Array.isArray(data.data)) {
                            targetSpectrum = data.data;
                            // 唤醒动画循环
                            drawingArea.queue_draw();
                        }
                    }
                    // 以当前引用的回调发起下一次轮询
                    stream.read_line_async(GLib.PRIORITY_DEFAULT, null, handleRead);
                }
            } catch (e) { }
        };
        dataStream.read_line_async(GLib.PRIORITY_DEFAULT, null, handleRead);

    } catch (e) {
        print("Failed to spawn spectrum listener: " + e);
    }

    box.show_all();
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
    const _spectrum = SpectrumWidget();


    box.get_style_context().add_class("modules-right");
    box.add(_spectrum);
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

    const leftSpacer = new Gtk.Label({ hexpand: true });
    const rightSpacer = new Gtk.Label({ hexpand: true });

    barContainer.add(LeftModules()); // 引入左侧栏
    barContainer.add(leftSpacer);
    barContainer.add(CenterModules()); // 引入中间栏
    barContainer.add(rightSpacer);
    barContainer.add(RightModules());

    alignBox.add(barContainer);

    window.add(alignBox);
    window.show_all();
});


// 获取当前 AGS 进程的实际物理驻留内存占用 (MB)
const getMemoryUsageMB = () => {
    try {
        const file = Gio.File.new_for_path('/proc/self/status');
        const [, contents] = file.load_contents(null);
        const status = new TextDecoder().decode(contents);
        const match = status.match(/VmRSS:\s+(\d+)\s+kB/);
        if (match && match[1]) {
            return parseInt(match[1], 10) / 1024;
        }
    } catch (e) {
        return 0;
    }
    return 0;
};

// 【系统级垃圾回收探针】用于检测缓慢泄漏还是引擎的懒回收
GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 120, () => {
    const memBefore = getMemoryUsageMB();
    print(`\n======= [GJS System GC] =======`);
    print(`[${new Date().toLocaleTimeString()}] 触发了 120s 周期性全面垃圾回收!`);
    System.gc();

    // 给系统一点微小的时间落地回收
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
        const memAfter = getMemoryUsageMB();
        const freed = memBefore - memAfter;
        print(`[${new Date().toLocaleTimeString()}] GC 执行完毕。回收前: ${memBefore.toFixed(2)} MB, 回收后: ${memAfter.toFixed(2)} MB => 净释放: ${freed.toFixed(2)} MB`);
        print(`===============================\n`);
        return false;
    });

    return true;
});

app.run(null);

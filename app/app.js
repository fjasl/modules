const { Engine } = require('./build/Release/ag_backend.node');
const mediaManager = require('./units/mediaManager.js');
const MprisManager = require('./units/mprisManager.js');
const readline = require('readline');
const net = require('net');
const AudioMonitor = require('./units/audio_monitor.js');
const SocketManager = require('./units/socketManager.js');
const PlaylistManager = require('./units/playlistManager.js');
const dbManager = require('./units/dbManager.js');

const SOCKET_PATH = '/tmp/agplayer-waybar.sock';

class AudioApp {
    constructor() {
        // 1. 初始化核心引擎
        this.engine = new Engine();

        // 2. 初始化共享内存视图
        const sharedBuffer = this.engine.getSharedStatusBuffer();
        this.view = new DataView(sharedBuffer.buffer, sharedBuffer.byteOffset, sharedBuffer.byteLength);

        // 2.1 启动音频提取监听服务 (从操作系统的 Pipewire 抓取)
        this.audioMonitor = new AudioMonitor();
        // 设置可视化回调
        this.audioMonitor.onAudioDataReady = (audioData) => {
            // 简单测试：计算当前这一帧的平均音量振幅 (2048 个 samples)
            let sum = 0;
            for (let i = 0; i < audioData.length; i++) {
                sum += Math.abs(audioData[i]);
            }
            const avg = sum / audioData.length;

            // 为了避免日志刷屏，我们只在平均音量较大，或者每隔一定次数打印一下
            // if (Math.random() < 0.05) { // 大约 5% 的概率打印，防止刷死终端
            //     console.log(`[Audio 🎵] System Monitor ready | Avg Amplitude: ${avg.toFixed(4)}`);
            // }
        };
        // 开启监听系统混音流
        this.audioMonitor.start();

        // 3. 播放列表协调器
        this.playlist = new PlaylistManager();

        // 4. 初始化 MPRIS 管理器
        this.mpris = new MprisManager({
            onPlay: () => this.engine.play(),
            onPause: () => this.engine.pause(),
            onPlayPause: () => {
                const state = this.view.getInt32(0, true);
                if (state === 3) this.engine.pause();
                else this.engine.play();
            },
            onNext: () => this.playNext(),
            onPrevious: () => this.playPrevious()
        });

        // 5. 初始化 Socket 管理器
        this.socket = new SocketManager(SOCKET_PATH);
        this.socket.init(
            () => this.broadcastWaybarUpdate(),
            (cmd) => this.handleIncomingCommand(cmd)
        );

        // 6. 注册引擎回调
        this.lastBroadcastTime = 0;

        this.engine.setOnStateChange(() => {
            const state = this.view.getInt32(0, true);
            console.log(`📡 [AudioApp] setOnStateChange: state=${state}`);
            this.syncMprisStatus();
            this.broadcastWaybarUpdate();

            if (state === 3 && this.pendingSeek > 0) {
                console.log(`🚀 [AudioApp] mpv 引擎进入状态 3，在此刻执行延迟恢复 Seek 到: ${this.pendingSeek}s`);
                this.engine.seek(this.pendingSeek);

                // 【核心逻辑】执行完立刻归零清空这个标志，保证以后正常的切歌和暂停绝对不会再触发它
                this.pendingSeek = 0;
            }
            else if (state === 3) {
                const timePos = this.view.getFloat64(4, true);
                dbManager.setState('last_played_position', timePos);
                console.log(`💾 [AudioApp] 已保存播放进度: ${timePos}s`);
            }
            // EOF → 自动切歌（异步，避免重入）
            if (state === 5) {
                console.log('🏁 [AudioApp] EOF 检测到，准备切歌...');
                setTimeout(() => this.playNext(), 50);
            }
        });

        this.engine.setOnLineChange(() => this.broadcastWaybarUpdate());

        this.engine.setOnStatusUpdate(() => {
            const now = Date.now();
            if (now - this.lastBroadcastTime > 100) {
                this.broadcastWaybarUpdate();
            }
        });
        this.pendingSeek = 0;
    }

    handleIncomingCommand(cmd) {
        console.log("📥 [Socket] 收到指令:", cmd);
        switch (cmd.command) {
            case 'play': this.engine.play(); break;
            case 'pause': this.engine.pause(); break;
            case 'playpause': this.mpris.onPlayPause(); break; // 复用逻辑
            case 'next': this.playNext(); break;
            case 'previous': this.playPrevious(); break;
            case 'set_mode': this.playlist.setMode(cmd.mode); break;
            case 'add': this.playlist.add(cmd.path).then(() => this.broadcastWaybarUpdate()); break;
            case 'rescan': this.playlist.manualRescan(); break; // 手动触发重新扫描
            case 'seek':
                if (cmd.position !== undefined) this.engine.seek(cmd.position);
                break;
            default:
                console.warn("⚠️ [Socket] 未知指令:", cmd.command);
        }
    }

    async playNext() {
        const track = this.playlist.next();
        // 传入可选参数：true(自动播放)，0(起点为0)
        if (track) await this.startTrack(track, true, 0);
    }

    async playPrevious() {
        const track = this.playlist.previous();
        // 传入可选参数：true(自动播放)，0(起点为0)
        if (track) await this.startTrack(track, true, 0);
    }


    async startTrack(resource) {
        console.log(`\n🎵 [AudioApp] 切换至: ${resource.metadata?.title || 'Unknown'}`);
        try {
            // [新增]：哪怕刚切歌，先记录下文件名，以防刚放就关掉
            dbManager.setState('last_played_file', resource.audioPath);
            // dbManager.setState('last_played_position', 0); // 将进度重置为 0

            // 更新 MPRIS 元数据
            this.mpris.metadata = {
                title: resource.metadata?.title,
                artist: resource.metadata?.artist,
                album: resource.metadata?.album,
                cover: resource.coverPath
            };

            const lrcPath = resource.audioPath.replace(/\.[^/.]+$/, "") + ".lrc";
            // 获取歌词文档
            this.currentLyricDoc = this.engine.load(resource.audioPath, lrcPath);
            if (this.currentLyricDoc && this.currentLyricDoc.lines) {
                console.log(`📜 [AudioApp] 歌词加载成功: ${this.currentLyricDoc.lines.length} 行`);
            } else {
                console.warn("⚠️ [AudioApp] 歌词加载返回为空或无效");
            }
            this.engine.play();

            this.broadcastWaybarUpdate();

        } catch (err) {
            console.error("❌ [AudioApp] 播放失败:", err);
        }
    }


    async init() {
        await this.playlist.scanDirectory();

        // [新增] 尝试恢复之前的播放状态
        const lastFile = dbManager.getState('last_played_file');
        const lastPosition = parseFloat(dbManager.getState('last_played_position') || '0');

        let targetTrack = null;

        if (lastFile) {
            // 尝试在播放列表中找回刚才那一首
            targetTrack = this.playlist.findAndSetCurrentByPath(lastFile);
            if (targetTrack) {
                console.log(`🔄 [AudioApp] 发现历史播放记录: ${lastFile}, 进度: ${lastPosition}s`);
            }
        }

        // 如果没有历史记录，或者文件被删了没找到，退回到默认的第一首
        if (!targetTrack) {
            targetTrack = this.playlist.getCurrent();
        }

        if (targetTrack) {

            const isRestore = !!lastFile && targetTrack.audioPath === lastFile;

            await this.startTrack(targetTrack, !isRestore, isRestore ? lastPosition : 0);
        }
    }


    syncMprisStatus() {
        // [修复] 偏移修正
        const state = this.view.getInt32(0, true);
        const isPaused = this.view.getInt8(28, true) === 1;
        if (isPaused) this.mpris.playbackStatus = 'Paused';
        else if (state === 3) this.mpris.playbackStatus = 'Playing';
        else if (state === 5) this.mpris.playbackStatus = 'Stopped';
    }

    broadcastWaybarUpdate() {
        this.lastBroadcastTime = Date.now();

        const state = this.view.getInt32(0, true);
        const timePos = this.view.getFloat64(4, true);
        const duration = this.view.getFloat64(12, true);
        const isPaused = this.view.getInt8(28, true) === 1;
        const lineIndex = this.view.getInt32(30, true);

        // 获取元数据
        const artist = this.currentLyricDoc?.artist || "Unknown Artist";
        const title = this.currentLyricDoc?.title || "Unknown Track";

        // 获取当前歌词
        let currentText = "Enjoy the music";
        let lineProgress = 0;
        if (this.currentLyricDoc && this.currentLyricDoc.lines && lineIndex >= 0 && lineIndex < this.currentLyricDoc.lines.length) {
            const line = this.currentLyricDoc.lines[lineIndex];
            // [修复] 歌词清洗：仅去除换行符 \r 和 \n，保留由于排版需要的空格和缩进
            currentText = line.text.replace(/[\r\n]+/g, '');
            // 如果清洗后为空文本（比如纯换行），使用占位符保持平稳
            if (!currentText) currentText = "…";
            lineProgress = Math.min(1, Math.max(0, (timePos - line.start) / (line.duration || 1)));
        }

        const songProgress = duration > 0 ? (timePos / duration) : 0;

        // 组装输出：仅显示歌词
        const fullText = currentText;

        this.socket.broadcast({
            text: fullText,
            percentage: songProgress * 100,
            tooltip: `${title} - ${artist}`,
            class: isPaused ? "custom-paused" : "custom-playing"
        });

        this.mpris.getPosition(timePos);
    }

    async init() {
        await this.playlist.scanDirectory();

        // [新增] 尝试恢复之前的播放状态
        const lastFile = dbManager.getState('last_played_file');
        const lastPosition = parseFloat(dbManager.getState('last_played_position') || '0');

        let targetTrack = null;

        if (lastFile) {
            // 尝试在播放列表中找回刚才那一首
            targetTrack = this.playlist.findAndSetCurrentByPath(lastFile);
            if (targetTrack) {
                console.log(`🔄 [AudioApp] 发现历史播放记录: ${lastFile}, 进度: ${lastPosition}s`);
            }
        }

        // 如果没有历史记录，或者文件被删了没找到，退回到默认的第一首
        if (!targetTrack) {
            targetTrack = this.playlist.getCurrent();
        }

        if (targetTrack) {
            this.pendingSeek = lastPosition;
            await this.startTrack(targetTrack);
        }
    }


}

const app = new AudioApp();




if (require.main === module) {
    app.init().catch(err => console.error("Initialization failed:", err));
    setInterval(() => { }, 1000);
}

module.exports = app;

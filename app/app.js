const { Engine } = require('./build/Release/ag_backend.node');
const mediaManager = require('./units/mediaManager.js');
const MprisManager = require('./units/mprisManager.js');
const SocketManager = require('./units/socketManager.js');
const PlaylistManager = require('./units/playlistManager.js');

const SOCKET_PATH = '/tmp/agplayer-waybar.sock';

class AudioApp {
    constructor() {
        // 1. 初始化核心引擎
        this.engine = new Engine();

        // 2. 初始化共享内存视图
        const sharedBuffer = this.engine.getSharedStatusBuffer();
        this.view = new DataView(sharedBuffer.buffer, sharedBuffer.byteOffset, sharedBuffer.byteLength);

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
            if (state === 3) {

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
        if (track) await this.startTrack(track);
    }

    async playPrevious() {
        const track = this.playlist.previous();
        if (track) await this.startTrack(track);
    }

    async startTrack(resource) {
        console.log(`\n🎵 [AudioApp] 切换至: ${resource.metadata?.title || 'Unknown'}`);
        try {
            // 更新 MPRIS 元数据
            this.mpris.metadata = {
                title: resource.metadata?.title,
                artist: resource.metadata?.artist,
                album: resource.metadata?.album,
                cover: resource.coverPath
            };

            const lrcPath = resource.audioPath.replace(/\.[^/.]+$/, "") + ".lrc";
            // [修复] 捕获返回的歌词文档，用于渲染
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
        const first = this.playlist.getCurrent();
        if (first) {
            await this.startTrack(first);
        }
    }
}

const app = new AudioApp();

if (require.main === module) {
    app.init().catch(err => console.error("Initialization failed:", err));
    setInterval(() => { }, 1000);
}

module.exports = app;

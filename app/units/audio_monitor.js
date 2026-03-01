const { spawn } = require('child_process');

class AudioMonitor {
    constructor() {
        this.recordProcess = null;
        this.loopbackProcess = null;
        // 使用 2048 个 float32 (8192 bytes) 作为一次可视化更新的缓冲池
        this.bufferSize = 2048;
        this.audioData = new Float32Array(this.bufferSize);
        this.byteBuffer = Buffer.alloc(0);
        this.onAudioDataReady = null; // 用户可绑定的回调

        // 虚拟设备名称
        this.virtualSinkName = 'agplayer_loopback';
    }

    /**
     * 初始化虚拟音频管道并启动监听
     */
    start() {
        this.setupVirtualSink();
        this.startRecording();
        this.startLoopback();
    }

    /**
     * 停止监听并拆除虚拟音频管道
     */
    stop() {
        if (this.recordProcess) {
            this.recordProcess.kill();
            this.recordProcess = null;
        }
        // 清理所有我们创建的管线
        this.teardownVirtualSink();
    }

    /**
     * 在系统中创建一个专门用于隔离 agplayer 声音的虚拟扬声器 
     */
    setupVirtualSink() {
        console.log('[AudioMonitor] 正在创建虚拟音频通道...');
        try {
            // 使用 pactl 加载一个 null-sink，作为纯净的提取源
            const { execSync } = require('child_process');
            // 先尝试卸载之前可能残留的
            this.teardownVirtualSink();

            execSync(`pactl load-module module-null-sink sink_name=${this.virtualSinkName} sink_properties=device.description="AGPlayer_Engine"`);
            console.log(`[AudioMonitor] 虚拟通道 ${this.virtualSinkName} 创建成功.`);
        } catch (e) {
            console.error('[AudioMonitor] 创建虚拟通道失败:', e.message);
        }
    }

    teardownVirtualSink() {
        try {
            const { execSync } = require('child_process');
            // 卸载 loopback 模块
            const modules = execSync("pactl list short modules").toString();
            const lines = modules.split('\n');
            for (const line of lines) {
                if (!line.trim()) continue;
                // 清理我们创建的 agplayer_loopback 虚拟节点
                if (line.includes('module-null-sink') && line.includes(this.virtualSinkName)) {
                    const moduleId = line.split('\t')[0];
                    execSync(`pactl unload-module ${moduleId}`);
                }
            }
            this.teardownLoopback();
        } catch (e) {
            // 忽略找不到模块的错误
        }
    }

    /**
     * 将虚拟扬声器的声音同时路由到真实的物理耳机里，否则用户听不到歌
     * 采用最底层的 PipeWire 节点直连 (pw-link)，避免 PulseAudio 兼容层的麦克风串音 Bug
     */
    startLoopback() {
        console.log('[AudioMonitor] 正在连接物理输出...');
        try {
            const { execSync } = require('child_process');

            // 找到当前正在工作的主物理扬声器
            // 使用 pw-cli 或 pactl 获取当前的 Default Sink
            let defaultSink = "";
            try {
                const info = execSync("pactl info").toString();
                const match = info.match(/Default Sink: (.+)/);
                if (match && match[1]) {
                    defaultSink = match[1].trim();
                }
            } catch (e) {
                console.error('[AudioMonitor] 获取默认输出设备失败.');
                return;
            }

            console.log(`[AudioMonitor] 目标物理声卡: ${defaultSink}`);

            // 断开之前可能遗留的链接
            this.teardownLoopback();

            // Pipewire 下，我们虚拟设备的 left/right 输出接口分别为:
            // agplayer_loopback:monitor_FL 和 agplayer_loopback:monitor_FR
            // 物理声卡的常用接收接口为 defaultSink:playback_FL ...
            // pw-link 会帮你聪明地连接这两端的端口

            // 左声道映射
            execSync(`pw-link agplayer_loopback:monitor_FL ${defaultSink}:playback_FL`);
            // 右声道映射
            execSync(`pw-link agplayer_loopback:monitor_FR ${defaultSink}:playback_FR`);

            console.log('[AudioMonitor] Pipewire 音频物理硬回环已建立！麦克风串音已被隔离。');
        } catch (err) {
            console.error('[AudioMonitor] loopback 建立失败，你可能听不到声音。可以用 pw-link 自行接线:', err.message);
        }
    }

    teardownLoopback() {
        try {
            const { execSync } = require('child_process');
            // 断开特定左右声道的线
            execSync(`pw-link -d agplayer_loopback:monitor_FL`);
            execSync(`pw-link -d agplayer_loopback:monitor_FR`);
        } catch (e) {
            // 忽略未连接的报错
        }
    }

    /**
     * 启动 parecord 监听虚拟通道，将 PCM 数据送入 NodeJS
     */
    startRecording() {
        console.log('[AudioMonitor] 启动 Parecord 进行可视化流提取...');
        // 从 ${virtualSinkName}.monitor (虚拟声卡的监听端) 抓取原始音频
        // 参数: float32 小端, 44100Hz, 双声道, --raw 指示输出为无头部的原生二进制流到 stdout
        this.recordProcess = spawn('parecord', [
            '--raw',
            '--format=float32le',
            '--rate=44100',
            '--channels=2',
            `--device=${this.virtualSinkName}.monitor`
        ]);

        this.recordProcess.stdout.on('data', (chunk) => {
            this.processPcmChunk(chunk);
        });

        this.recordProcess.stderr.on('data', (data) => {
            // Parecord 可能会输出一些警告，开发时可以打开看看
            // console.log(`[parecord]: ${data}`);
        });

        this.recordProcess.on('close', (code) => {
            console.log(`[AudioMonitor] parecord 进程退出 (code ${code})`);
        });
    }

    /**
     * 接收 stdout 的字节流并拼接为 Float32Array 暴露给前端
     */
    processPcmChunk(chunk) {
        // 将新来的数据拼接到缓存中
        this.byteBuffer = Buffer.concat([this.byteBuffer, chunk]);

        // float32 占 4 个字节。我们需要 2048 个 samples，那就是 2048 * 4 = 8192 bytes。
        const requiredBytes = this.bufferSize * 4;

        // 如果攒够了一帧
        while (this.byteBuffer.length >= requiredBytes) {
            const frameBuffer = this.byteBuffer.subarray(0, requiredBytes);
            // 剩下的保留到下一次
            this.byteBuffer = this.byteBuffer.subarray(requiredBytes);

            // 转换 Bufffer -> Float32Array (零拷贝视图视角，极快)
            // 注意：NodeJS 的 Buffer 底层自带 buffer 属性，它就是 ArrayBuffer
            this.audioData = new Float32Array(
                frameBuffer.buffer,
                frameBuffer.byteOffset,
                this.bufferSize
            );

            // 触发测试用的回调
            if (this.onAudioDataReady) {
                this.onAudioDataReady(this.audioData);
            }
        }
    }
}

module.exports = AudioMonitor;

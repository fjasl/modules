const { Engine } = require('./build/Release/ag_backend.node');

let engine;

async function runTest() {
    console.log("=== 正在启动高性能 Engine 综合测试 ===");

    engine = new Engine();

    const songPath = "/home/yun/music/风错过雨.mp3";
    const lrcPath = "/home/yun/music/风错过雨-小蓝背心.lrc";

    console.log(`\n[1/3] 正在加载歌曲和歌词...\n - 音频: ${songPath}\n - 歌词: ${lrcPath}`);
    const lyricDoc = engine.load(songPath, lrcPath);

    if (!lyricDoc) {
        console.error("加载失败！请检查文件路径是否存在。");
        process.exit(1);
    }

    console.log(`成功加载！歌手: ${lyricDoc.artist || '未知'}, 歌曲: ${lyricDoc.title || '未知'}, 共计 ${lyricDoc.lines.length} 行歌词。`);

    // 2. 映射共享内存
    const sharedBuffer = engine.getSharedStatusBuffer();
    const view = new DataView(sharedBuffer.buffer, sharedBuffer.byteOffset, sharedBuffer.byteLength);

    console.log("\n[启动播放] 观察下方动态更新...");
    engine.play();
    setTimeout(() => {
        const duration = view.getFloat64(12, true);
        if (duration > 5) engine.seek(duration - 2);
    }, 1000);

    // 3. 订阅多维信号 (彻底解耦)

    // [低频] 换行通知：仅作为信号触发，数据从共享内存拿
    engine.setOnLineChange(() => {
        const lineIndex = view.getInt32(30, true);
        if (lineIndex >= 0 && lineIndex < lyricDoc.lines.length) {
            const line = lyricDoc.lines[lineIndex];
            console.log(`\n[信号: 换行] >> ${line.text}`);
        }
    });

    // [低频] 状态切换：仅作为信号触发，数据从共享内存拿
    engine.setOnStateChange(() => {
        const state = view.getInt32(0, true);
        console.log(`\n[信号: 状态变更] NEW STATE: ${state}`);
        if (state === 4) { // Stopped
            console.log("\n[检测到播放结束] 测试任务完成。");
            process.exit(0);
        }
    });

    // [高频] 进度监测：默认随 mpv 步进，仅用来简单跟踪进度
    let lastSecond = -1;
    engine.setOnStatusUpdate(() => {
        const timePos = view.getFloat64(4, true);
        const sec = Math.floor(timePos);
        // 每秒更新一次进度显示，避免日志爆炸
        if (sec !== lastSecond) {
            lastSecond = sec;
            const duration = view.getFloat64(12, true);
            const progress = duration > 0 ? ((timePos / duration) * 100).toFixed(1) : "0.0";
            process.stdout.write(`\r[进度监测] ${timePos.toFixed(1)}s / ${progress}% ... `);
        }
    });

    console.log("\n(测试运行中，按 Ctrl+C 退出)");
    setInterval(() => { }, 1000);
}

runTest().catch(console.error);

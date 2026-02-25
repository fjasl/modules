const fs = require('fs').promises;
const path = require('path');
const mediaManager = require('./mediaManager');

class PlaylistManager {
    constructor() {
        this.queue = []; // 存储格式: [{ audioPath, lyricPath, coverPath, metadata }]
        this.currentIndex = -1;
        this.mode = 'Shuffle'; // 仅支持: 'Shuffle', 'LoopOne'
        this.musicDir = '/home/yun/music';
        this.history = [];      // 播放历史 (索引列表)
        this.maxHistory = 100;  // 最大历史长度
    }

    /**
     * 自动扫描指定目录下的音频文件
     */
    async scanDirectory(dir = this.musicDir) {
        console.log(`🔍 [Playlist] 正在扫描目录: ${dir}`);
        try {
            const files = await fs.readdir(dir);
            const mp3Files = files.filter(f => f.toLowerCase().endsWith('.mp3'));

            const tasks = mp3Files.map(async (file) => {
                const fullPath = path.join(dir, file);
                return await mediaManager.discover(fullPath);
            });

            this.queue = await Promise.all(tasks);
            if (this.queue.length > 0) {
                this.currentIndex = 0;
            }
            console.log(`✅ [Playlist] 扫描完成，共发现 ${this.queue.length} 首歌曲`);
            return this.queue;
        } catch (err) {
            console.error(`❌ [Playlist] 扫描失败:`, err);
            return [];
        }
    }

    getCurrent() {
        if (this.currentIndex >= 0 && this.currentIndex < this.queue.length) {
            return this.queue[this.currentIndex];
        }
        return null;
    }

    next() {
        if (this.queue.length === 0) return null;

        // 存入播放历史
        if (this.currentIndex !== -1) {
            this.history.push(this.currentIndex);
            if (this.history.length > this.maxHistory) this.history.shift();
        }

        if (this.mode === 'LoopOne') {
            // 单曲循环: Index 不变
        } else {
            // Shuffle: 随机播放 (默认)
            if (this.queue.length > 1) {
                let nextIndex;
                do {
                    nextIndex = Math.floor(Math.random() * this.queue.length);
                } while (nextIndex === this.currentIndex);
                this.currentIndex = nextIndex;
            } else {
                // 如果播放列表里只有 1 首歌或者为空，其实无路可选，currentIndex 保持原样 (0 或者是 undefined)
            }
        }
        return this.getCurrent();
    }

    previous() {
        if (this.queue.length === 0) return null;

        if (this.history.length > 0) {
            // 从历史中回溯
            this.currentIndex = this.history.pop();
        } else {
            // 无历史，则只能再次随机
            if (this.queue.length > 1) {
                let prevIndex;
                do {
                    prevIndex = Math.floor(Math.random() * this.queue.length);
                } while (prevIndex === this.currentIndex);
                this.currentIndex = prevIndex;
            }
        }
        return this.getCurrent();
    }

    setMode(mode) {
        if (['LoopOne', 'Shuffle'].includes(mode)) {
            this.mode = mode;
            console.log(`🎵 [Playlist] 播放模式切换为: ${mode}`);
        }
    }

    // --- 队列管理接口 ---

    async add(audioPath) {
        const resource = await mediaManager.discover(audioPath);
        this.queue.push(resource);
        return resource;
    }

    remove(index) {
        if (index >= 0 && index < this.queue.length) {
            const removed = this.queue.splice(index, 1);
            // 调整 currentIndex
            if (this.currentIndex >= index) {
                this.currentIndex = Math.max(0, this.currentIndex - 1);
            }
            return removed[0];
        }
        return null;
    }

    async replace(index, audioPath) {
        if (index >= 0 && index < this.queue.length) {
            const resource = await mediaManager.discover(audioPath);
            this.queue[index] = resource;
            return resource;
        }
        return null;
    }
}

module.exports = PlaylistManager;

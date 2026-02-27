const fs = require('fs').promises;
const path = require('path');
const mediaManager = require('./mediaManager');
const chokidar = require('chokidar');
const dbManager = require('./dbManager');
const EventEmitter = require('events');

class PlaylistManager extends EventEmitter {
    constructor() {
        super();
        this.queue = []; // 存储格式: [{ audioPath, lyricPath, coverPath, metadata }]
        this.currentIndex = -1;
        this.mode = 'Shuffle'; // 仅支持: 'Shuffle', 'LoopOne'
        this.musicDir = '/home/yun/music';
        this.history = [];      // 播放历史 (索引列表)
        this.maxHistory = 100;  // 最大历史长度

        // 监控相关
        this.watcher = null;
        this.rescanTimeout = null;
        this.debounceDelay = 500;
        this.startWatching();
    }

    /**
     * 自动扫描指定目录下的音频文件
     */
    /**
  * 增量扫描指定目录下的音频文件
  */
    async scanDirectory(dir = this.musicDir) {
        console.log(`🔍 [Playlist] 开始扫描目录: ${dir}`);
        try {
            // 1. 从数据库极速加载所有已缓存的歌曲数据
            const cachedTracks = dbManager.getAllTracks();
            // 用一个 Set 存储所有已知的物理文件路径，用来做超快对比
            const knownPaths = new Set(cachedTracks.map(t => t.audioPath));

            // 当前的播放队列先等于缓存的数据
            this.queue = cachedTracks;

            // 2. 读取物理目录里的所有实际文件
            const files = await fs.readdir(dir);
            const mp3Files = files.filter(f => f.toLowerCase().endsWith('.mp3'));

            // 3. 找出真正在本地有，但是数据库里没有的“新”文件
            const newFiles = mp3Files.filter(file => {
                const fullPath = path.join(dir, file);
                return !knownPaths.has(fullPath);
            });

            if (newFiles.length > 0) {
                console.log(`✨ [Playlist] 发现 ${newFiles.length} 首未入库的新歌，正在解析元数据...`);

                // 4. 只对新文件进行耗时的 discover 解析
                const tasks = newFiles.map(async (file) => {
                    const fullPath = path.join(dir, file);
                    const resource = await mediaManager.discover(fullPath);

                    // 将新解析出来的歌曲写进数据库！下次就不会再扫它了
                    if (resource) {
                        dbManager.addTrack(resource);
                    }
                    return resource;
                });

                // 等待新歌解析完毕，并追加到现有播放列表中
                const newlyDiscovered = await Promise.all(tasks);
                this.queue.push(...newlyDiscovered.filter(r => r !== null));
            } else {
                console.log(`⚡ [Playlist] 没有发现新歌，直接使用本地数据库缓存`);
            }

            if (this.queue.length > 0 && this.currentIndex === -1) {
                this.currentIndex = 0;
            }

            console.log(`✅ [Playlist] 列表准备就绪，共计 ${this.queue.length} 首歌曲`);
            return this.queue;

        } catch (err) {
            console.error(`❌ [Playlist] 扫描/读取数据库失败:`, err);
            return [];
        }
    }

    /**
 * 根据音频文件路径定位到播放列表中的指定歌曲
 * @param {string} audioPath 
 * @returns {Object|null} 如果找到了，返回歌曲资源对象；没找到返回 null
 */
    findAndSetCurrentByPath(audioPath) {
        if (!audioPath) return null;
        const index = this.queue.findIndex(item => item.audioPath === audioPath);
        if (index !== -1) {
            this.currentIndex = index;
            return this.queue[index];
        }
        return null;
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

    // --- 监控与重扫逻辑 ---

    // 启动自动监控
    startWatching() {
        if (this.watcher) {
            console.log('[Playlist] 监控已经在运行中。');
            return;
        }
        // 初始化 chokidar
        this.watcher = chokidar.watch(this.musicDir, {
            ignored: /(^|[\/\\])\../, // 忽略隐藏文件 (.git, .DS_Store 等)
            persistent: true,
            ignoreInitial: true // 重要：忽略程序刚启动时遍历已有文件触发的 add 事件
        });
        // 统一处理增加、删除、修改事件
        const onChange = (action, filePath) => {
            console.log(`[Playlist] 自动检测到文件 ${action}: ${filePath}`);
            this.triggerAutoRescan();
        };
        this.watcher
            .on('add', path => onChange('增加', path))
            .on('unlink', path => onChange('删除', path))
            // 注意：如果你不需要在文件内容修改时（如修改ID3标签）重扫，可以把 'change' 注释掉
            .on('change', path => onChange('修改', path));

        console.log(`[Playlist] 开始监控文件夹: ${this.musicDir}`);
    }

    // 停止监控
    stopWatching() {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
            console.log('[Playlist] 已停止监控。');
        }
    }

    // 自动变动时的带防抖扫描
    triggerAutoRescan() {
        if (this.rescanTimeout) {
            clearTimeout(this.rescanTimeout); // 取消上一次的计时
        }

        // 当文件停止变动 500ms 后，再去执行真正的 rescan
        this.rescanTimeout = setTimeout(() => {
            console.log('[Playlist] 自动变动防抖结束... 执行扫描');
            this.scanDirectory(this.musicDir).then(() => {
                this.emit('playlist_updated', this.queue);
            });
        }, this.debounceDelay);
    }

    // 面向外部暴露的【手动触发】接口
    manualRescan() {
        console.log('[Playlist] 收到手动重新扫描指令。');
        // 手动触发通常不需要防抖，直接执行
        this.scanDirectory(this.musicDir).then(() => {
            this.emit('playlist_updated', this.queue);
        });
    }
}


module.exports = PlaylistManager;

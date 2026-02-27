// 文件路径: /home/yun/workspace/modules/app/units/dbManager.js
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class DBManager {
    constructor() {
        // 将数据库文件存放在用户本地数据目录 (推荐符合 XDG 规范)
        const dbDir = path.join(process.env.HOME || process.env.USERPROFILE, '.local/share/agplayer');

        // 确保目录存在
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        const dbPath = path.join(dbDir, 'library.db');

        // 初始化数据库连接
        // verbose 参数可以在开发时打印 SQL 语句，不需要时可设为 null
        this.db = new Database(dbPath, { verbose: null });

        // 启用 WAL 模式，大幅提升读写性能
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = 1'); // [新增] 1 代表 NORMAL，在 WAL 模式下既保证安全又保证性能


        this.initTables();
    }

    initTables() {
        // 创建表：tracks 用于存储歌曲信息，file_path 设置为 UNIQUE (唯一索引)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT UNIQUE NOT NULL,
                title TEXT,
                artist TEXT,
                album TEXT,
                duration REAL,
                cover_path TEXT,
                lrc_path TEXT
            );
        `);

        // 创建表：app_state 用于保存应用的状态（如最后播放的歌曲、进度）
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS app_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);
    }
    // ==========================================
    // Tracks (歌曲) 相关操作
    // ==========================================

    /**
     * 插入或更新一首歌曲
     * 使用 INSERT OR IGNORE，如果 file_path 已存在，则什么都不做
     * @param {Object} resource - 从 mediaManager.discover() 返回的资源对象
     */
    addTrack(resource) {
        if (!resource || !resource.audioPath) return;
        const lrcPath = resource.audioPath.replace(/\.[^/.]+$/, "") + ".lrc";
        const stmt = this.db.prepare(`
            INSERT OR IGNORE INTO tracks 
            (file_path, title, artist, album, duration, cover_path, lrc_path)
            VALUES (@file_path, @title, @artist, @album, @duration, @cover_path, @lrc_path)
        `);

        stmt.run({
            file_path: resource.audioPath,
            title: resource.metadata?.title || null,
            artist: resource.metadata?.artist || null,
            album: resource.metadata?.album || null,
            duration: resource.metadata?.duration || 0,
            cover_path: resource.coverPath || null,
            lrc_path: lrcPath
        });
    }

    /**
     * 获取所有缓存的歌曲
     * 用于程序启动时快速构建播放列表
     * @returns {Array} 还原为类似 discover 返回的资源对象格式
     */
    getAllTracks() {
        const rows = this.db.prepare('SELECT * FROM tracks').all();

        // 将数据库的扁平结构还原为程序可以使用的嵌套对象结构
        return rows.map(row => ({
            audioPath: row.file_path,
            coverPath: row.cover_path,
            lrcPath: row.lrc_path,
            metadata: {
                title: row.title,
                artist: row.artist,
                album: row.album,
                duration: row.duration
            }
        }));
    }

    // ==========================================
    // App State (应用记忆状态) 相关操作
    // ==========================================

    /**
     * 保存状态 (比如: setState('last_played_file', '/xxx.mp3'))
     * @param {string} key 
     * @param {string} value 
     */
    setState(key, value) {
        if (!key || value === undefined) return;

        // INSERT OR REPLACE 如果 key 存在就覆盖更新
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO app_state (key, value)
            VALUES (?, ?)
        `);
        // 数据库强制存字符串，所以如果是数字这里顺手转换一下
        stmt.run(key, String(value));
    }

    /**
     * 读取状态
     * @param {string} key 
     * @returns {string|null}
     */
    getState(key) {
        if (!key) return null;

        const stmt = this.db.prepare('SELECT value FROM app_state WHERE key = ?');
        const row = stmt.get(key);
        return row ? row.value : null;
    }

}

// 导出单例，确保全局只连一个数据库
module.exports = new DBManager();

const fs = require('fs').promises;
const path = require('path');
const musicMetadata = require('music-metadata');

// ==========================================
// 基础解析器类 (Base Resolver Classes)
// ------------------------------------------
// 采用“策略模式 (Strategy Pattern)”的基类。
// 这样设计的目的是为了以后如果增加新的查找源（比如从网盘找、从API找）
// 只需要继承这些基类并实现 resolve 方法，而不需要修改核心查找逻辑，符合开闭原则。
// ==========================================

class LyricResolver {
    // 解析并返回歌词的绝对路径，找不到则返回 null
    async resolve(audioPath, basePath) { throw new Error("Not implemented"); }
}

class CoverResolver {
    // 解析并返回封面的绝对路径，找不到则返回 null
    async resolve(audioPath, basePath) { throw new Error("Not implemented"); }
}

class MetadataResolver {
    // 解析并返回音乐的元数据（包含内嵌封面），找不到则返回默认数据
    async resolve(audioPath) { throw new Error("Not implemented"); }
}

// ==========================================
// 具体的解析器实现 (Concrete Resolvers)
// ==========================================

/**
 * 本地文本歌词解析器
 * 策略：在音频文件同级目录下寻找同名的 .lrc 文件
 */
class LocalTextLyricResolver extends LyricResolver {
    async resolve(audioPath, basePath) {
        // 猜测歌词文件的绝对路径
        const candidateLrc = `${basePath}.lrc`;
        try {
            // fs.stat 是非阻塞异步操作，如果文件不存在会直接抛出进入 catch
            await fs.stat(candidateLrc);
            return candidateLrc; // 文件存在，返回路径
        } catch (err) {
            return null; // 文件不存在
        }
    }
}

/**
 * 本地图片封面解析器
 * 策略：在音频文件同级目录下寻找同名的 .jpg, .png 或 .jpeg 文件
 */
class LocalImageCoverResolver extends CoverResolver {
    async resolve(audioPath, basePath) {
        // 定义我们要依次寻找的图片格式优先级
        const candidates = [`${basePath}.jpg`, `${basePath}.png`, `${basePath}.jpeg`];

        for (const candidate of candidates) {
            try {
                // 逐个检查，找到任何一个就立刻返回
                await fs.stat(candidate);
                return candidate;
            } catch (err) {
                continue; // 这个后缀没找到，继续找下一个
            }
        }
        return null;
    }
}

/**
 * ID3 标签及内嵌封面解析器
 * 策略：调用外部的 music-metadata 库，直接解析音频文件的二进制头部
 * 提取出歌曲标题、艺术家、时长以及封存在 MP3 内部自带的封面图（Buffer）
 */
class ID3TagResolver extends MetadataResolver {
    async resolve(audioPath) {
        try {
            const metadata = await musicMetadata.parseFile(audioPath);
            let embeddedCover = null;

            // Extract the first available picture buffer if present
            if (metadata.common.picture && metadata.common.picture.length > 0) {
                const picture = metadata.common.picture[0];
                embeddedCover = {
                    format: picture.format,
                    data: picture.data
                };
            }

            return {
                title: metadata.common.title || path.basename(audioPath),
                artist: metadata.common.artist || "Unknown Artist",
                album: metadata.common.album || "Unknown Album",
                duration: metadata.format.duration || 0,
                embeddedCover: embeddedCover
            };
        } catch (err) {
            console.warn(`Failed to parse ID3 tags for ${audioPath}:`, err.message);
            return {
                title: path.basename(audioPath),
                artist: "Unknown Artist",
                album: "Unknown Album",
                duration: 0,
                embeddedCover: null
            };
        }
    }
}

// ==========================================
// 资源管理器核心 (Media Manager Core)
// ------------------------------------------
// 负责统筹所有的 Resolver，对外提供统一的 discover 接口
// ==========================================

class MediaManager {
    constructor() {
        // 在这里“组装”我们需要生效的解析器。
        // 如果你以后写了网易云的解析器，只需要 new NetEaseLyricResolver() 往这个数组里 push 即可。
        // Manager 会自动依次调用它们。
        this.lyricResolvers = [new LocalTextLyricResolver()];
        this.coverResolvers = [new LocalImageCoverResolver()];
        this.metadataResolvers = [new ID3TagResolver()];
    }

    /**
     * 发现给定音频文件的所有关联资源（异步操作）
     * @param {string} identifier - 音频文件的绝对路径
     * @returns {Promise<Object>} - 返回组装好的 MediaResource 对象
     */
    async discover(identifier) {
        // 利用 path 模块拆解路径，方便后续拼凑同名文件
        // 例如: /home/music/cold.mp3 -> dir: /home/music, name: cold
        const parsedPath = path.parse(identifier);

        // basePath 就是去掉了扩展名的绝对前缀路径：/home/music/cold
        const basePath = path.join(parsedPath.dir, parsedPath.name);

        // 初始化要返回的资源对象结构
        const resource = {
            audioPath: identifier, // 音乐绝对路径
            lyricPath: null,       // 本地歌词绝对路径
            coverPath: null,       // 本地图片绝对路径
            metadata: null,        // 歌曲元信息 (标题, 歌手, 专辑, 时长)
            embeddedCover: null    // 歌曲内嵌封面的二进制数据 (Buffer) 和 格式类型
        };

        // ----------------------------------------------------
        // 阶段 1. 利用所有已挂载的 MetadataResolver 解析歌曲内嵌信息
        // ----------------------------------------------------
        for (const resolver of this.metadataResolvers) {
            const result = await resolver.resolve(identifier);
            if (result) {
                resource.metadata = {
                    title: result.title,
                    artist: result.artist,
                    album: result.album,
                    duration: result.duration
                };
                if (result.embeddedCover) {
                    resource.embeddedCover = result.embeddedCover;
                }
                break; // 如果某个解析器成功拿到了数据，就不让后续的解析器越俎代庖了 (短路逻辑)
            }
        }

        // ----------------------------------------------------
        // 阶段 2. 利用所有已挂载的 LyricResolver 寻找外置独立歌词
        // ----------------------------------------------------
        for (const resolver of this.lyricResolvers) {
            const result = await resolver.resolve(identifier, basePath);
            if (result) {
                resource.lyricPath = result;
                break; // 同样是短路逻辑，比如找到了本地的 .lrc 就不需要再发 API 寻找了
            }
        }

        // ----------------------------------------------------
        // 阶段 3. 利用所有已挂载的 CoverResolver 寻找外置独立封面
        // ----------------------------------------------------
        for (const resolver of this.coverResolvers) {
            const result = await resolver.resolve(identifier, basePath);
            if (result) {
                resource.coverPath = result;
                break;
            }
        }

        // 把拼装好的结果扔回去给 app.js 用
        return resource;
    }
}

// 导出 MediaManager 的一个全局唯一实例 (单例模式)
module.exports = new MediaManager();

const net = require('net');
const fs = require('fs');

class SocketManager {
    constructor(socketPath) {
        this.socketPath = socketPath;
        this.clients = new Set();
        this.server = null;
    }

    init(onNewClient = null, onCommand = null) {
        if (fs.existsSync(this.socketPath)) {
            fs.unlinkSync(this.socketPath);
        }

        this.server = net.createServer((socket) => {
            console.log("👉 [Socket] 客户端已连接");
            this.clients.add(socket);

            if (onNewClient) onNewClient(socket);

            // [新增] 监听来自客户端（如 Waybar 指令）的数据
            socket.on('data', (data) => {
                if (onCommand) {
                    try {
                        const cmdString = data.toString().trim();
                        if (cmdString) {
                            const cmd = JSON.parse(cmdString);
                            onCommand(cmd, socket);
                        }
                    } catch (e) {
                        console.error("👉 [Socket] 无法解析入站指令:", data.toString());
                    }
                }
            });

            socket.on('end', () => {
                this.clients.delete(socket);
                console.log("👉 [Socket] 客户端已断开");
            });

            socket.on('error', (err) => {
                this.clients.delete(socket);
                console.log("👉 [Socket] 客户端错误:", err.message);
            });
        });

        this.server.listen(this.socketPath, () => {
            console.log(`[Socket] 监听已启动: ${this.socketPath}`);
        });

        // 确保清理
        process.on('exit', () => this.cleanup());
        process.on('SIGINT', () => { this.cleanup(); process.exit(); });
        process.on('SIGTERM', () => { this.cleanup(); process.exit(); });
    }

    broadcast(data) {
        const jsonString = JSON.stringify(data) + '\n';
        for (const socket of this.clients) {
            try {
                socket.write(jsonString);
            } catch (err) {
                this.clients.delete(socket);
            }
        }
    }

    cleanup() {
        if (fs.existsSync(this.socketPath)) {
            try {
                fs.unlinkSync(this.socketPath);
            } catch (e) { }
        }
    }
}

module.exports = SocketManager;

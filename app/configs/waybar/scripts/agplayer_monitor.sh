#!/bin/bash

LOG="/tmp/agplayer_monitor.log"
SOCKET="/tmp/agplayer-waybar.sock"

echo "[$(date)] Monitor started" >> "$LOG"

while true; do
    if [ -S "$SOCKET" ]; then
        echo "[$(date)] Attempting to connect to $SOCKET" >> "$LOG"
        # 使用 stdbuf 确保输出不被缓存
        stdbuf -oL socat -u UNIX-CONNECT:"$SOCKET" STDOUT 2>/dev/null
    fi
    
    # 打印离线状态，减少重连延迟
    echo '{"text": "Offline", "tooltip": "Disconnected", "class": "disconnected"}' 
    sleep 0.2
done

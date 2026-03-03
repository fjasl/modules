# 1. 杀死当前正在运行的 gjs 面板（顶栏）
killall gjs

# 2. 杀掉刚才可能残留的 socat 僵尸监听进程
pkill -f "socat -u UNIX-CONNECT:/tmp/agplayer-waybar.sock"

# 3. 重新启动你的面板后台（假设你刚才是在 ~/.config/ags 下运行）
cd ~/.config/ags && gjs app.js &

pkill -f "socat -u UNIX-CONNECT:/tmp/agplayer-spectrum.sock"
pkill -f "socat -u UNIX-CONNECT:/tmp/agplayer-lyrics.sock" 
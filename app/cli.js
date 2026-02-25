const { PlayerCore } = require('./build/Release/ag_backend.node');
const readline = require('readline');

const player = new PlayerCore();
let currentProps = null;
let lastCmd = "";

player.onPropertiesChanged((props) => {
    currentProps = props;
    render();
});

player.onStateChanged((state) => { });

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> '
});

const tl = process.argv[2];
let trackUrl = "file:///home/yun/music/Cold Winter.mp3";
if (tl) {
    if (tl.startsWith('http://') || tl.startsWith('https://')) {
        trackUrl = tl;
    } else if (tl.startsWith('file://')) {
        trackUrl = tl;
    } else {
        const absolutePath = require('path').resolve(tl.startsWith('/') ? tl : `/${tl}`);
        trackUrl = `file://${absolutePath}`;
    }
}
player.load(trackUrl);
player.play();

// Give the screen some space so our ANSI up-movements don't hit the ceiling
console.log('\n\n\n\n\n\n\n\n');

function render() {
    const stateStr = currentProps ? (["Idle", "Loading", "Buffering", "Playing", "Paused", "Stopped", "Error"][currentProps.state] || "Unknown") : "Initializing...";
    const media = currentProps ? (currentProps.currentMedia || trackUrl) : trackUrl;
    const vol = currentProps ? currentProps.volume : 100;
    const muted = currentProps ? currentProps.isMuted : false;
    const tpos = currentProps ? currentProps.timePos.toFixed(2) : "0.00";
    const tlen = currentProps ? currentProps.duration.toFixed(2) : "0.00";

    // Move cursor up 8 lines
    process.stdout.write('\x1b[8A');

    // Draw lines, clearing each line first
    console.log(`\x1b[2K\r=== Terminal Audio Player ===`);
    console.log(`\x1b[2K\rState: ${stateStr}`);
    console.log(`\x1b[2K\rMedia: ${media}`);
    console.log(`\x1b[2K\rVolume: ${vol}%  Muted: ${muted}`);
    console.log(`\x1b[2K\rProgress: ${tpos}s / ${tlen}s`);
    console.log(`\x1b[2K\r-----------------------------`);
    console.log(`\x1b[2K\rCommands: load <file>, play, pause, toggle, vol <0-100>, seek <time>, exit`);
    console.log(`\x1b[2K\rLast Executed: ${lastCmd}`);

    // Restore prompt
    process.stdout.write(`\x1b[2K\r> ${rl.line}`);
}

rl.on('line', (line) => {
    // Clear user's visual input line instantly
    process.stdout.write('\x1b[1A\x1b[2K');

    const input = line.trim();
    if (!input) {
        render();
        return;
    }

    lastCmd = input;
    const parts = input.split(' ');
    const cmd = parts[0];

    switch (cmd) {
        case 'play': player.play(); break;
        case 'pause': player.pause(); break;
        case 'toggle': currentProps && currentProps.isPaused ? player.play() : player.pause(); break;
        case 'vol':
            if (parts[1]) player.setVolume(parseFloat(parts[1]));
            break;
        case 'seek':
            if (parts[1]) player.seek(parseFloat(parts[1]), false);
            break;
        case 'load':
            if (parts.length > 1) {
                const tlArg = parts.slice(1).join(' ');
                let nextUrl = tlArg;
                if (!nextUrl.startsWith('http://') && !nextUrl.startsWith('https://') && !nextUrl.startsWith('file://')) {
                    const absolutePath = require('path').resolve(nextUrl.startsWith('/') ? nextUrl : `/${nextUrl}`);
                    nextUrl = `file://${absolutePath}`;
                }
                player.load(nextUrl);
                player.play();
            }
            break;
        case 'stop': player.stop(); break;
        case 'exit':
        case 'quit':
            player.stop();
            process.exit(0);
        default: break;
    }
    render();
});

setInterval(() => { }, 1000);
setInterval(render, 500);

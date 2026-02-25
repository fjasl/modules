const { Engine } = require('./build/Release/ag_backend.node');

let engine = new Engine();

// Listen for state changes
engine.setOnStateChange(() => {
    const sharedBuffer = engine.getSharedStatusBuffer();
    const view = new DataView(sharedBuffer.buffer);
    const state = view.getInt32(0, true);
    console.log("State changed to:", state);
});

console.log("Loading file...");
engine.load("/home/yun/music/风错过雨.mp3", "/home/yun/music/风错过雨-小蓝背心.lrc");

setTimeout(() => {
    console. // intentionally incomplete

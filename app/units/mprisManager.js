const Mpris = require('mpris-service');

class MprisManager {
    constructor(callbacks = {}) {
        this.player = Mpris({
            name: 'agplayer',
            identity: 'AG Audio',
            supportedUriSchemes: ['file'],
            supportedMimeTypes: ['audio/mpeg', 'audio/flac', 'audio/wav'],
            supportedInterfaces: ['player']
        });

        // 绑定外部控制回调
        if (callbacks.onPlay) this.player.on('play', callbacks.onPlay);
        if (callbacks.onPause) this.player.on('pause', callbacks.onPause);
        if (callbacks.onPlayPause) this.player.on('playpause', callbacks.onPlayPause);
        if (callbacks.onNext) this.player.on('next', callbacks.onNext);
        if (callbacks.onPrevious) this.player.on('previous', callbacks.onPrevious);
    }

    set metadata(data) {
        this.player.metadata = {
            'mpris:trackid': this.player.objectPath('track/0'),
            'mpris:artUrl': data.cover ? `file://${data.cover}` : '',
            'xesam:title': data.title || 'Unknown Title',
            'xesam:artist': [data.artist || 'Unknown Artist'],
            'xesam:album': data.album || 'Unknown Album'
        };
    }

    set playbackStatus(status) {
        // status: 'Playing', 'Paused', 'Stopped'
        this.player.playbackStatus = status;
    }

    getPosition(timePosSeconds) {
        // MPRIS expects position in microseconds
        this.player.getPosition = () => timePosSeconds * 1000 * 1000;
    }
}

module.exports = MprisManager;

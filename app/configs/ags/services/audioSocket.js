const { Gio, GLib } = imports.gi;

class PlaybackSocketService {
    constructor(socketPath) {
        this.socketPath = socketPath;
        this.client = new Gio.SocketClient();
        this.connection = null;
        this.outputStream = null;
        this.dataStream = null;

        // Callback exposed to external UI components to listen for data
        this.onMessageReceived = (msg) => { };

        this.connect();
    }

    connect() {
        const address = new Gio.UnixSocketAddress({ path: this.socketPath });

        this.client.connect_async(address, null, (client, res) => {
            try {
                this.connection = client.connect_finish(res);
                this.outputStream = this.connection.get_output_stream();
                this.dataStream = new Gio.DataInputStream({
                    base_stream: this.connection.get_input_stream(),
                    close_base_stream: true
                });

                print("✅ [AGS Socket] Connected to backend: " + this.socketPath);
                this.readLoop();
            } catch (e) {
                // Connection failed (backend might not be up yet), retry after 2 seconds
                GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
                    this.connect();
                    return false; // return false means the timeout runs only once
                });
            }
        });
    }

    readLoop() {
        if (!this.dataStream) return;

        this.dataStream.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, res) => {
            try {
                const [lineStrOrg, length] = stream.read_line_finish_utf8(res);
                if (lineStrOrg !== null) {
                    const lineStr = lineStrOrg.trim();
                    // Push received data to the frontend components
                    this.onMessageReceived(lineStr);
                    // Recursively call to listen for the next line
                    this.readLoop();
                } else {
                    // Null means backend disconnected (EOF)
                    this.handleDisconnect();
                }
            } catch (e) {
                this.handleDisconnect();
            }
        });
    }

    sendCommand(commandObj) {
        if (!this.outputStream) {
            print("⚠️ [AGS Socket] Not connected, cannot send command.");
            return;
        }
        try {
            // Convert to JSON and append newline since the backend reads line by line
            const cmdStr = JSON.stringify(commandObj) + "\n";
            const bytes = new GLib.Bytes(cmdStr);

            // Send asynchronously
            this.outputStream.write_bytes_async(bytes, GLib.PRIORITY_DEFAULT, null, (stream, res) => {
                try {
                    stream.write_bytes_finish(res);
                } catch (e) {
                    print("❌ [AGS Socket] Failed to send command: " + e);
                }
            });
        } catch (e) {
            print("❌ [AGS Socket] Failed to build command: " + e);
        }
    }

    handleDisconnect() {
        print("⚠️ [AGS Socket] Connection lost, trying to reconnect...");
        if (this.connection) {
            try { this.connection.close(null); } catch (e) { }
        }
        this.connection = null;
        this.dataStream = null;
        this.outputStream = null;

        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            this.connect();
            return false;
        });
    }
}

// Export the class
// In AGS/GJS, we can export it by simply not using `var`/`let`/`const` at the top level,
// but returning it or assigning it to a global/exported object.
// A common pattern in AGS is to just expose the class directly.
var Service = PlaybackSocketService;

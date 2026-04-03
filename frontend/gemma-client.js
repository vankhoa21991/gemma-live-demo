/**
 * gemma-client.js
 * WebSocket client for communicating with the Gemma Live backend.
 */

class GemmaClient {
  constructor(url = `ws://${window.location.host}/ws`) {
    this.url = url;
    this.ws = null;
    this.connected = false;
    this._eventHandlers = {};
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.connected = true;
        this._emit("connected");
        resolve();
      };

      this.ws.onclose = () => {
        this.connected = false;
        this._emit("disconnected");
      };

      this.ws.onerror = (e) => {
        this.connected = false;
        this._emit("error", e);
        reject(e);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this._emit("message", data);
        } catch (e) {
          console.warn("Failed to parse message:", event.data);
        }
      };
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(data) {
    if (this.ws && this.connected) {
      if (typeof data === "string") {
        this.ws.send(data);
      } else {
        this.ws.send(JSON.stringify(data));
      }
    }
  }

  sendText(content) {
    this.send(JSON.stringify({ type: "text", content }));
  }

  sendImage(base64Data) {
    this.send(JSON.stringify({ type: "image", data: base64Data }));
  }

  sendAudioTranscript(transcript) {
    console.log("WS: sending audio_transcript:", transcript);
    this.send(JSON.stringify({ type: "audio_transcript", transcript }));
  }

  sendRawAudio(bytes) {
    if (this.ws && this.connected) {
      this.ws.send(bytes);
    }
  }

  ping() {
    this.send(JSON.stringify({ type: "ping" }));
  }

  on(event, handler) {
    if (!this._eventHandlers[event]) {
      this._eventHandlers[event] = [];
    }
    this._eventHandlers[event].push(handler);
  }

  off(event, handler) {
    if (this._eventHandlers[event]) {
      this._eventHandlers[event] = this._eventHandlers[event].filter(h => h !== handler);
    }
  }

  _emit(event, data) {
    const handlers = this._eventHandlers[event] || [];
    handlers.forEach(h => h(data));
  }
}

window.GemmaClient = GemmaClient;

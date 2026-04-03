/**
 * media-handler.js
 * Handles camera and microphone access, audio level visualization.
 */

class MediaHandler {
  constructor() {
    this.cameraStream = null;
    this.audioContext = null;
    this.analyser = null;
    this.audioTrack = null;
    this.isRecording = false;
  }

  async initCamera(videoElement) {
    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });
      videoElement.srcObject = this.cameraStream;
      await videoElement.play();
      return true;
    } catch (e) {
      console.warn("Camera not available:", e);
      return false;
    }
  }

  toggleCamera(videoElement) {
    if (this.cameraStream) {
      const track = this.cameraStream.getVideoTracks()[0];
      track.enabled = !track.enabled;
      return track.enabled;
    }
    return false;
  }

  stopCamera() {
    if (this.cameraStream) {
      this.cameraStream.getVideoTracks().forEach(t => t.stop());
      this.cameraStream = null;
    }
  }

  captureFrame(videoElement, canvas) {
    if (!this.cameraStream) return null;
    const ctx = canvas.getContext("2d");
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    // Mirror
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(videoElement, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.7).split(",")[1]; // base64 without prefix
  }

  async initAudio() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.audioTrack = stream.getAudioTracks()[0];

      this.audioContext = new AudioContext({ sampleRate: 16000 });
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);

      return stream;
    } catch (e) {
      console.error("Microphone error:", e);
      return null;
    }
  }

  getAudioLevel() {
    if (!this.analyser) return 0;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    return Math.min(avg / 128, 1);
  }

  stopAudio() {
    if (this.audioTrack) {
      this.audioTrack.stop();
      this.audioTrack = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  stop() {
    this.stopCamera();
    this.stopAudio();
  }
}

window.MediaHandler = MediaHandler;

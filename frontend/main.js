/**
 * main.js
 * Application entry point for the Gemma Live Demo.
 */

(async () => {
  console.log("main.js loaded");
  const WS_URL = `ws://${window.location.host}/ws`;

  // DOM elements
  const connectionStatus = document.getElementById("connection-status");
  const modelName = document.getElementById("model-name");
  const chatHistory = document.getElementById("chat-history");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  const micBtn = document.getElementById("mic-btn");
  const micIcon = document.getElementById("mic-icon");
  const micOffIcon = document.getElementById("mic-off-icon");
  const audioLevelBar = document.getElementById("audio-level-bar");
  const audioLabel = document.getElementById("audio-label");
  const transcriptionDisplay = document.getElementById("transcription-display");
  const thinkingIndicator = document.getElementById("thinking-indicator");
  const videoElement = document.getElementById("camera-feed");
  const videoCanvas = document.getElementById("video-canvas");
  const toggleCameraBtn = document.getElementById("toggle-camera");
  const avatarPlaceholder = document.getElementById("avatar-placeholder");
  const latencyDisplay = document.getElementById("latency-display");
  const suggestionsContainer = document.getElementById("suggestions");

  // State
  const client = new GemmaClient(WS_URL);
  const media = new MediaHandler();
  const pcm = new PCMProcessor(16000);
  let speechRec = null;
  let isRecording = false;
  let frameCaptureInterval = null;
  let cameraOn = false;
  let lastSendTime = 0;
  let suggestionsUsed = false;

  // Check Ollama health on load
  async function checkHealth() {
    try {
      const resp = await fetch("/health");
      const data = await resp.json();
      if (data.status === "ok") {
        modelName.textContent = `Model: ${data.models.join(", ") || "none loaded"}`;
        connectionStatus.textContent = "Ollama OK";
      } else {
        modelName.textContent = "Ollama unreachable";
        connectionStatus.textContent = "Ollama Error";
        connectionStatus.className = "status error";
      }
    } catch (e) {
      connectionStatus.textContent = "Server Error";
      connectionStatus.className = "status error";
    }
  }

  // Append a message to chat
  function appendMessage(role, text, type = "message") {
    const div = document.createElement("div");
    div.className = `message ${role}`;
    if (type === "error") div.className = "message error";
    div.textContent = text;
    chatHistory.appendChild(div);
    chatHistory.scrollTop = chatHistory.scrollHeight;
    return div;
  }

  // Send a text message
  function sendText(text) {
    if (!text.trim()) return;
    appendMessage("user", text);
    lastSendTime = Date.now();
    latencyDisplay.textContent = "";

    // Hide suggestions after first real message
    if (!suggestionsUsed) {
      suggestionsUsed = true;
      suggestionsContainer.style.display = "none";
    }

    // Send current video frame with text
    const frame = media.captureFrame(videoElement, videoCanvas);
    if (frame) {
      client.sendImage(frame);
    }

    client.sendText(text);
    chatInput.value = "";
  }

  // Event: chat form submit
  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    sendText(chatInput.value);
  });

  // Event: space bar to talk
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && document.activeElement !== chatInput && !isRecording) {
      e.preventDefault();
      startRecording();
    }
  });

  document.addEventListener("keyup", (e) => {
    if (e.code === "Space" && isRecording) {
      e.preventDefault();
      stopRecording();
    }
  });

  // Toggle recording
  async function startRecording() {
    if (isRecording) return;
    console.log("startRecording called");

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert("Speech recognition not supported. Try Chrome or Edge.");
      return;
    }

    // Init audio for level visualization
    if (!media.audioContext) {
      const stream = await media.initAudio();
      if (stream) {
        await pcm.start(stream);
      }
    }

    // Start speech recognition
    speechRec = pcm.startSpeechRecognition(
      (interim) => {
        transcriptionDisplay.textContent = interim;
        transcriptionDisplay.classList.remove("hidden");
      },
      (final) => {
        if (final.trim()) {
          console.log("Final transcript:", final);
          client.sendAudioTranscript(final);
          appendMessage("user", `[Audio] ${final}`);
        }
        transcriptionDisplay.classList.add("hidden");
      }
    );

    isRecording = true;
    micBtn.classList.add("recording");
    micIcon.style.display = "none";
    micOffIcon.style.display = "block";
    audioLabel.textContent = "Recording... release to send";
    connectionStatus.textContent = "Recording";
    connectionStatus.className = "status connected";

    // Visualize audio level
    const levelInterval = setInterval(() => {
      const level = media.getAudioLevel();
      audioLevelBar.style.width = `${level * 100}%`;
      if (!isRecording) {
        clearInterval(levelInterval);
        audioLevelBar.style.width = "0%";
      }
    }, 50);
  }

  function stopRecording() {
    if (!isRecording) return;
    isRecording = false;
    micBtn.classList.remove("recording");
    micIcon.style.display = "block";
    micOffIcon.style.display = "none";
    audioLabel.textContent = "Click mic or press Space to talk";
    connectionStatus.textContent = "Connected";
    connectionStatus.className = "status connected";

    if (speechRec) {
      speechRec.stop();
      speechRec = null;
    }
    transcriptionDisplay.classList.add("hidden");
  }

  // Mic button click
  micBtn.addEventListener("click", () => {
    console.log("MIC BUTTON CLICKED, isRecording=", isRecording);
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });

  // Suggestion chips
  suggestionsContainer.addEventListener("click", (e) => {
    const chip = e.target.closest(".suggestion-chip");
    if (!chip) return;
    const prompt = chip.dataset.prompt;
    sendText(prompt);
  });

  // Toggle camera
  toggleCameraBtn.addEventListener("click", async () => {
    if (!media.cameraStream) {
      cameraOn = await media.initCamera(videoElement);
    } else {
      cameraOn = media.toggleCamera(videoElement);
    }
    toggleCameraBtn.textContent = cameraOn ? "Stop Camera" : "Start Camera";
    if (avatarPlaceholder) {
      avatarPlaceholder.classList.toggle("hidden", cameraOn);
    }
  });

  // Capture frames periodically while connected
  let lastFrameTime = 0;
  function startFrameCapture(intervalMs = 2000) {
    frameCaptureInterval = setInterval(() => {
      if (!client.connected || !cameraOn) return;
      const now = Date.now();
      if (now - lastFrameTime < intervalMs) return;
      lastFrameTime = now;

      const frame = media.captureFrame(videoElement, videoCanvas);
      if (frame) {
        client.sendImage(frame);
      }
    }, intervalMs);
  }

  // WebSocket events
  client.on("connected", () => {
    connectionStatus.textContent = "Connected";
    connectionStatus.className = "status connected";
    startFrameCapture(3000); // Send frame every 3s
  });

  client.on("disconnected", () => {
    connectionStatus.textContent = "Disconnected";
    connectionStatus.className = "status disconnected";
    if (frameCaptureInterval) {
      clearInterval(frameCaptureInterval);
      frameCaptureInterval = null;
    }
  });

  client.on("error", (e) => {
    console.error("WebSocket error:", e);
    connectionStatus.textContent = "Error";
    connectionStatus.className = "status error";
  });

  client.on("message", (data) => {
    switch (data.type) {
      case "gemini":
        thinkingIndicator.classList.add("hidden");
        appendMessage("gemma", data.text);
        if (lastSendTime > 0) {
          const latency = Date.now() - lastSendTime;
          latencyDisplay.textContent = `⏱ ${latency}ms`;
          lastSendTime = 0;
        }
        break;

      case "turn_complete":
        thinkingIndicator.classList.add("hidden");
        break;

      case "user":
        // User transcription (echo)
        break;

      case "interrupted":
        thinkingIndicator.classList.add("hidden");
        break;

      case "error":
        thinkingIndicator.classList.add("hidden");
        appendMessage("gemma", `Error: ${data.error}`, "error");
        break;

      case "pong":
        // Keepalive response
        break;
    }
  });

  // Init
  async function init() {
    await checkHealth();

    // Camera is optional — user enables it via "Toggle Camera" button

    // Connect WebSocket
    try {
      await client.connect();
    } catch (e) {
      appendMessage("gemma", "Could not connect to backend. Make sure the server is running.", "error");
    }
  }

  init();
})();

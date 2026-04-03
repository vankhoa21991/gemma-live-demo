/**
 * pcm-processor.js
 * Handles speech recognition via Web Speech API.
 * AudioWorklet/ScriptProcessor not needed since SpeechRecognition uses its own mic access.
 */

class PCMProcessor {
  constructor(sampleRate = 16000) {
    this.sampleRate = sampleRate;
    this.isProcessing = false;
    this.onAudioChunk = null;
  }

  /** Start audio visualization (optional — not needed for speech recognition) */
  async start(stream) {
    // Not needed — SpeechRecognition manages its own audio
    this.isProcessing = true;
  }

  stop() {
    this.isProcessing = false;
    this.onAudioChunk = null;
  }

  /**
   * Start speech recognition using Web Speech API.
   * Returns the SpeechRecognition object.
   */
  startSpeechRecognition(onInterim, onFinal) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      console.error("SpeechRecognition NOT supported in this browser");
      return null;
    }

    const recognition = new SR();
    recognition.lang = "fr-FR";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }
      if (interim && onInterim) onInterim(interim);
      if (final && onFinal) onFinal(final);
    };

    recognition.onerror = (e) => {
      console.error("Speech recognition error:", e.error, "-", e.message);
    };

    recognition.onend = () => {
      console.log("SpeechRecognition ended");
    };

    recognition.onstart = () => {
      console.log("SpeechRecognition started");
    };

    try {
      recognition.start();
      console.log("SpeechRecognition.start() called");
      return recognition;
    } catch (e) {
      console.error("Failed to start SpeechRecognition:", e);
      return null;
    }
  }
}

window.PCMProcessor = PCMProcessor;

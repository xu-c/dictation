const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");

const MAX_ATTEMPTS = 3;
const TTS_TIMEOUT_MS = 12000;
const RETRY_DELAY_MS = 350;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout(promise, ms) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("TTS request timed out")), ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function generateAudioBuffer(text, voice, rateStr) {
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text, { rate: rateStr });

    const chunks = [];
    for await (const chunk of audioStream) {
      chunks.push(chunk);
    }

    const audioBuffer = Buffer.concat(chunks);
    if (audioBuffer.length === 0) {
      throw new Error("TTS returned empty audio");
    }
    return audioBuffer;
  } finally {
    tts.close();
  }
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const text = (req.query.text || "").trim();
  if (!text) {
    return res.status(400).json({ error: "text parameter required" });
  }

  const rate = parseFloat(req.query.rate) || 1.0;
  const voice = req.query.voice || "zh-CN-XiaoxiaoNeural";

  // Convert rate to edge-tts percentage: rate 1.0 = "+0%", 0.6 = "-40%", 1.5 = "+50%"
  const ratePercent = Math.round((rate - 1) * 100);
  const rateStr = (ratePercent >= 0 ? "+" : "") + ratePercent + "%";

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const audioBuffer = await withTimeout(
        generateAudioBuffer(text, voice, rateStr),
        TTS_TIMEOUT_MS
      );

      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Length", audioBuffer.length);
      res.setHeader("X-TTS-Attempt", String(attempt));
      return res.status(200).send(audioBuffer);
    } catch (err) {
      lastError = err;
      console.warn(
        `TTS attempt ${attempt}/${MAX_ATTEMPTS} failed:`,
        err.message || err
      );
      if (attempt < MAX_ATTEMPTS) {
        await wait(RETRY_DELAY_MS * attempt);
      }
    }
  }

  console.error("TTS error:", lastError && (lastError.message || lastError));
  return res.status(503).json({
    error: "TTS generation failed after retries: " + (lastError && (lastError.message || lastError)),
  });
};

const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");

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

  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const { audioStream } = tts.toStream(text, { rate: rateStr });

    // Collect stream into buffer
    const chunks = [];
    for await (const chunk of audioStream) {
      chunks.push(chunk);
    }
    const audioBuffer = Buffer.concat(chunks);

    tts.close();

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Content-Length", audioBuffer.length);
    return res.status(200).send(audioBuffer);
  } catch (err) {
    console.error("TTS error:", err.message || err);
    return res.status(500).json({ error: "TTS generation failed: " + (err.message || err) });
  }
};

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const JANE_VOICE_ID = "wScwPA1qCkWo5R2dmlS8";
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.send("Jane ElevenLabs backend is running.");
});

app.post("/api/tts", async (req, res) => {
  try {
    if (!ELEVENLABS_API_KEY) {
      return res.status(500).json({ error: "Missing ELEVENLABS_API_KEY environment variable." });
    }

    const text = String(req.body?.text || "").trim();
    if (!text) {
      return res.status(400).json({ error: "Missing text." });
    }

    const elevenResponse = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${JANE_VOICE_ID}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg"
        },
        body: JSON.stringify({
          text,
          model_id: MODEL_ID,
          voice_settings: {
            stability: 0.52,
            similarity_boost: 0.82,
            style: 0.18,
            use_speaker_boost: true
          }
        })
      }
    );

    if (!elevenResponse.ok) {
      const errorText = await elevenResponse.text();
      return res.status(elevenResponse.status).json({ error: errorText });
    }

    const audioBuffer = Buffer.from(await elevenResponse.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(audioBuffer);
  } catch (error) {
    res.status(500).json({ error: error.message || "Text-to-speech failed." });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Jane AI Assistant backend running on port ${port}`);
});

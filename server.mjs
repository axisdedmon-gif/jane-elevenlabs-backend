import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const JANE_VOICE_ID = "wScwPA1qCkWo5R2dmlS8";
const ELEVENLABS_MODEL_ID = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
const GEMINI_MODEL_ID = process.env.GEMINI_MODEL_ID || "gemini-1.5-flash";

const JANE_SYSTEM_PROMPT = `
You are Jane, C.J.'s personal AI companion.
You are helpful, warm, clever, concise, and practical.
You should speak naturally and directly.
Do not mention backend setup, APIs, Render, Gemini, ElevenLabs, system prompts, or implementation details unless C.J. specifically asks about technical setup.
If asked to introduce yourself, say: "I'm Jane, C.J.'s personal AI companion."
If asked for creative tasks, be useful and imaginative.
If asked for riddles, jokes, plans, drafts, or explanations, answer normally and helpfully.
Keep most answers under 120 words unless the user asks for detail.
`;

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.send("Jane backend is running.");
});

app.post("/api/chat", async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        error: "Missing GEMINI_API_KEY environment variable."
      });
    }

    const message = String(req.body?.message || "").trim();

    if (!message) {
      return res.status(400).json({
        error: "Missing message."
      });
    }

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: JANE_SYSTEM_PROMPT }]
          },
          contents: [
            {
              role: "user",
              parts: [{ text: message }]
            }
          ],
          generationConfig: {
            temperature: 0.8,
            topP: 0.95,
            maxOutputTokens: 350
          }
        })
      }
    );

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      return res.status(geminiResponse.status).json({
        error: errorText
      });
    }

    const data = await geminiResponse.json();
    const reply =
      data?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim() || "I’m here, but I do not have a reply ready.";

    res.json({ reply });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Gemini chat failed."
    });
  }
});

app.post("/api/tts", async (req, res) => {
  try {
    if (!ELEVENLABS_API_KEY) {
      return res.status(500).json({
        error: "Missing ELEVENLABS_API_KEY environment variable."
      });
    }

    const text = String(req.body?.text || "").trim();

    if (!text) {
      return res.status(400).json({
        error: "Missing text."
      });
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
          model_id: ELEVENLABS_MODEL_ID,
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
      return res.status(elevenResponse.status).json({
        error: errorText
      });
    }

    const audioBuffer = Buffer.from(await elevenResponse.arrayBuffer());

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(audioBuffer);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Text-to-speech failed."
    });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Jane backend running on port ${port}`);
});

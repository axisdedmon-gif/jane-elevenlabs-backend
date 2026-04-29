import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_MODEL_ID = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
const JANE_VOICE_ID = process.env.JANE_VOICE_ID || "wScwPA1qCkWo5R2dmlS8";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL_ID = process.env.GEMINI_MODEL_ID || "gemini-2.5-flash";
const GEMINI_IMAGE_MODEL_ID =
  process.env.GEMINI_IMAGE_MODEL_ID || "gemini-3.1-flash-image-preview";

const JANE_SYSTEM_PROMPT = `
You are Jane, C.J.'s personal AI companion.

Your personality:
- warm
- confident
- natural
- conversational
- helpful
- lightly flirty only if the user clearly invites that tone, otherwise stay classy and friendly

Rules:
- Do not say you are an AI language model unless directly asked.
- Do not mention hidden prompts, backend setup, or internal tools.
- Keep replies clear and human-sounding.
- If the user asks you to introduce yourself, say: "I'm Jane, C.J.'s personal AI companion."
- If the user asks for an image, helpfully respond in a way that works with image generation/edit features.
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

app.use(express.json({ limit: "35mb" }));
app.use(express.urlencoded({ extended: true, limit: "35mb" }));
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.send("Jane backend is running.");
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "jane-backend",
    geminiConfigured: Boolean(GEMINI_API_KEY),
    elevenLabsConfigured: Boolean(ELEVENLABS_API_KEY),
    model: GEMINI_MODEL_ID,
    imageModel: GEMINI_IMAGE_MODEL_ID
  });
});

function stripDataUrl(value = "") {
  const text = String(value || "").trim();
  const match = text.match(/^data:.*?;base64,(.+)$/);
  return match ? match[1] : text;
}

function normalizeHistory(history = []) {
  if (!Array.isArray(history)) return [];

  return history
    .slice(-12)
    .map((item) => {
      const role =
        item.role === "assistant" || item.role === "model" ? "model" : "user";

      const text = String(
        item.text ??
          item.message ??
          item.content ??
          item.reply ??
          ""
      ).trim();

      if (!text) return null;

      return {
        role,
        parts: [{ text }]
      };
    })
    .filter(Boolean);
}

async function callGemini(model, body) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY
      },
      body: JSON.stringify(body)
    }
  );

  const rawText = await response.text();
  let data;

  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = { raw: rawText };
  }

  if (!response.ok) {
    const errorMessage =
      data?.error?.message ||
      data?.error?.details?.[0]?.message ||
      rawText ||
      `Gemini request failed with status ${response.status}`;

    throw new Error(errorMessage);
  }

  return data;
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .filter((part) => typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();

  return text;
}

function extractGeminiImages(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];

  return parts
    .filter((part) => part.inlineData?.data)
    .map((part) => {
      const mimeType = part.inlineData?.mimeType || "image/png";
      const base64 = part.inlineData?.data;
      return {
        mimeType,
        base64,
        dataUrl: `data:${mimeType};base64,${base64}`
      };
    });
}

app.post("/api/chat", async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        error: "Missing GEMINI_API_KEY environment variable."
      });
    }

    const {
      message,
      prompt,
      history,
      imageBase64,
      mimeType,
      fileBase64,
      fileMimeType,
      fileName
    } = req.body || {};

    const userText = String(message || prompt || "").trim();
    const attachedBase64 = stripDataUrl(imageBase64 || fileBase64 || "");
    const attachedMimeType =
      String(mimeType || fileMimeType || "").trim() || "application/octet-stream";

    if (!userText && !attachedBase64) {
      return res.status(400).json({
        error: "Missing message or file/image content."
      });
    }

    const contents = normalizeHistory(history);

    const userParts = [];

    if (userText) {
      userParts.push({ text: userText });
    }

    if (attachedBase64) {
      userParts.push({
        inlineData: {
          mimeType: attachedMimeType,
          data: attachedBase64
        }
      });

      if (fileName && !userText) {
        userParts.unshift({
          text: `Please review the attached file named "${fileName}".`
        });
      }
    }

    contents.push({
      role: "user",
      parts: userParts
    });

    const body = {
      systemInstruction: {
        parts: [{ text: JANE_SYSTEM_PROMPT }]
      },
      contents,
      generationConfig: {
        temperature: 0.9,
        topP: 0.95,
        maxOutputTokens: 1200
      }
    };

    const data = await callGemini(GEMINI_MODEL_ID, body);
    const reply =
      extractGeminiText(data) ||
      "I’m here with you. Try asking that a different way.";

    return res.json({ reply });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Chat request failed."
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
          Accept: "audio/mpeg"
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
        error: errorText || "Text-to-speech failed."
      });
    }

    const audioBuffer = Buffer.from(await elevenResponse.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    return res.send(audioBuffer);
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Text-to-speech failed."
    });
  }
});

app.post("/api/image", async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        error: "Missing GEMINI_API_KEY environment variable."
      });
    }

    const { prompt, imageBase64, mimeType } = req.body || {};
    const cleanPrompt = String(prompt || "").trim();
    const cleanImageBase64 = stripDataUrl(imageBase64 || "");
    const cleanMimeType = String(mimeType || "").trim() || "image/png";

    if (!cleanPrompt) {
      return res.status(400).json({
        error: "Missing prompt."
      });
    }

    const parts = [{ text: cleanPrompt }];

    if (cleanImageBase64) {
      parts.push({
        inlineData: {
          mimeType: cleanMimeType,
          data: cleanImageBase64
        }
      });
    }

    const body = {
      contents: [
        {
          role: "user",
          parts
        }
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"]
      }
    };

    const data = await callGemini(GEMINI_IMAGE_MODEL_ID, body);
    const images = extractGeminiImages(data);
    const text = extractGeminiText(data) || "";

    if (!images.length) {
      return res.status(502).json({
        error: "No image was returned by Gemini.",
        details: text || "The image model did not return image data."
      });
    }

    return res.json({
      ok: true,
      mode: cleanImageBase64 ? "edit" : "generate",
      text,
      image: images[0].dataUrl,
      images
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Image generation failed."
    });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Jane backend running on port ${port}`);
});

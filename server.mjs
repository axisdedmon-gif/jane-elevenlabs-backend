import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const JANE_VOICE_ID = process.env.JANE_VOICE_ID || "wScwPA1qCkWo5R2dm1s8";
const ELEVENLABS_MODEL_ID = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL_ID = process.env.GEMINI_MODEL_ID || "gemini-2.5-flash";
const GEMINI_IMAGE_MODEL_ID = process.env.GEMINI_IMAGE_MODEL_ID || "gemini-3.1-flash-image-preview";
const OPENROUTESERVICE_API_KEY = process.env.OPENROUTESERVICE_API_KEY;

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "12mb" }));
app.use(express.static(__dirname));

app.get("/", (req, res) => res.send("Jane backend is running."));

function cleanText(value) {
  return String(value || "").trim();
}

function requireKey(value, name, res) {
  if (!value) {
    res.status(500).json({ error: `Missing ${name} environment variable.` });
    return false;
  }
  return true;
}

async function geminiGenerate({ model, contents, generationConfig }) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents, generationConfig })
    }
  );

  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { error: raw };
  }

  if (!response.ok) {
    throw new Error(data?.error?.message || data?.error || raw || "Gemini request failed.");
  }

  return data;
}

app.post("/api/chat", async (req, res) => {
  try {
    if (!requireKey(GEMINI_API_KEY, "GEMINI_API_KEY", res)) return;

    const message = cleanText(req.body.message);
    const history = Array.isArray(req.body.history) ? req.body.history.slice(-4) : [];

    const parts = [];
    if (message) parts.push({ text: message });

    if (req.body.fileBase64 && req.body.fileMimeType) {
      parts.push({
        inlineData: {
          mimeType: req.body.fileMimeType,
          data: req.body.fileBase64
        }
      });
    }

    const contents = [
      ...history
        .map(item => ({
          role: item.role === "assistant" ? "model" : "user",
          parts: [{ text: cleanText(item.text) }]
        }))
        .filter(item => item.parts[0].text),
      {
        role: "user",
        parts: parts.length ? parts : [{ text: "Reply briefly." }]
      }
    ];

    const data = await geminiGenerate({
      model: GEMINI_MODEL_ID,
      contents,
      generationConfig: {
        temperature: 0.72,
        topP: 0.9,
        maxOutputTokens: 360
      }
    });

    const reply = data?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    res.json({
      reply: reply || "I’m here, but I do not have a useful reply ready."
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Chat failed." });
  }
});

app.post("/api/image", async (req, res) => {
  try {
    if (!requireKey(GEMINI_API_KEY, "GEMINI_API_KEY", res)) return;

    const prompt = cleanText(req.body.prompt);
    if (!prompt) return res.status(400).json({ error: "Missing image prompt." });

    const parts = [{ text: prompt }];

    if (req.body.imageBase64 && req.body.mimeType) {
      parts.push({
        inlineData: {
          mimeType: req.body.mimeType,
          data: req.body.imageBase64
        }
      });
    }

    const data = await geminiGenerate({
      model: GEMINI_IMAGE_MODEL_ID,
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.7
      }
    });

    let text = "";
    let image = "";

    for (const part of data?.candidates?.[0]?.content?.parts || []) {
      if (part.text) text += part.text;

      const inline = part.inlineData || part.inline_data;
      if (inline?.data && inline?.mimeType) {
        image = `data:${inline.mimeType};base64,${inline.data}`;
      }
    }

    if (!image) {
      return res.status(500).json({
        error: text || "Image model returned no image. Check image model quota/support."
      });
    }

    res.json({
      mode: req.body.imageBase64 ? "edit" : "create",
      text: text.trim(),
      image
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Image generation failed." });
  }
});

app.post("/api/tts", async (req, res) => {
  try {
    if (!requireKey(ELEVENLABS_API_KEY, "ELEVENLABS_API_KEY", res)) return;

    const text = cleanText(req.body.text);
    if (!text) return res.status(400).json({ error: "Missing text." });

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

app.post("/api/travel/geocode", async (req, res) => {
  try {
    if (!requireKey(OPENROUTESERVICE_API_KEY, "OPENROUTESERVICE_API_KEY", res)) return;

    const query = cleanText(req.body.query);
    if (!query) return res.status(400).json({ error: "Missing query." });

    const url = new URL("https://api.openrouteservice.org/geocode/search");
    url.searchParams.set("api_key", OPENROUTESERVICE_API_KEY);
    url.searchParams.set("text", query);
    url.searchParams.set("size", "5");

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "Geocoding failed."
      });
    }

    const results = (data.features || []).map(feature => {
      const [lon, lat] = feature.geometry.coordinates;
      return {
        label: feature.properties.label || feature.properties.name || query,
        lat,
        lon
      };
    });

    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message || "Geocoding failed." });
  }
});

app.post("/api/travel/route", async (req, res) => {
  try {
    if (!requireKey(OPENROUTESERVICE_API_KEY, "OPENROUTESERVICE_API_KEY", res)) return;

    const start = req.body.start;
    const end = req.body.end;

    if (!start?.lat || !start?.lon || !end?.lat || !end?.lon) {
      return res.status(400).json({
        error: "Missing start or end coordinates."
      });
    }

    const response = await fetch(
      "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
      {
        method: "POST",
        headers: {
          Authorization: OPENROUTESERVICE_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          coordinates: [
            [Number(start.lon), Number(start.lat)],
            [Number(end.lon), Number(end.lat)]
          ],
          instructions: false
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "Routing failed."
      });
    }

    const feature = data.features?.[0];
    const summary = feature?.properties?.summary || {};
    const coordinates = (feature?.geometry?.coordinates || []).map(([lon, lat]) => [
      lat,
      lon
    ]);

    res.json({
      distance: summary.distance || 0,
      duration: summary.duration || 0,
      coordinates
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Routing failed." });
  }
});

app.post("/api/travel/nearby", async (req, res) => {
  try {
    if (!requireKey(OPENROUTESERVICE_API_KEY, "OPENROUTESERVICE_API_KEY", res)) return;

    const lat = Number(req.body.lat);
    const lon = Number(req.body.lon);
    const query = cleanText(req.body.query);

    if (!lat || !lon || !query) {
      return res.status(400).json({
        error: "Missing lat, lon, or query."
      });
    }

    const url = new URL("https://api.openrouteservice.org/geocode/search");
    url.searchParams.set("api_key", OPENROUTESERVICE_API_KEY);
    url.searchParams.set("text", query);
    url.searchParams.set("focus.point.lat", String(lat));
    url.searchParams.set("focus.point.lon", String(lon));
    url.searchParams.set("boundary.circle.lat", String(lat));
    url.searchParams.set("boundary.circle.lon", String(lon));
    url.searchParams.set("boundary.circle.radius", "20");
    url.searchParams.set("size", "8");

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "Nearby search failed."
      });
    }

    const results = (data.features || []).map(feature => {
      const [flon, flat] = feature.geometry.coordinates;
      return {
        label: feature.properties.label || feature.properties.name || query,
        lat: flat,
        lon: flon,
        distance: feature.properties.distance
      };
    });

    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message || "Nearby search failed." });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Jane backend running on port ${port}`);
});

// POST /api/explain-change
//
// Vercel serverless function wrapping one Gemini call for the "Explain this
// change" feature.  The Gemini API key is read from the server-side
// GEMINI_API_KEY environment variable and is never sent to the client.
//
// The endpoint receives only metadata and calculated summary statistics for
// the currently displayed observation pair (no imagery), and returns a short,
// structured explanation that separates measured facts from interpretation.

interface VercelRequest {
  method?: string;
  body?: unknown;
}

interface VercelResponse {
  status(code: number): VercelResponse;
  json(body: unknown): void;
}

interface Explanation {
  observedSignal: string;
  possibleIndication: string;
  limitations: string;
}

const MAX_TEXT = 4000;

function apiBase(): string {
  return process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta";
}

function model(): string {
  return process.env.GEMINI_MODEL || "gemini-2.5-flash";
}

function str(value: unknown, cap = 200): string | null {
  if (typeof value !== "string") return null;
  return value.slice(0, cap);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseBody(raw: unknown): Record<string, unknown> | null {
  let body = raw;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
}

function buildPrompt(body: Record<string, unknown>): string | null {
  const studyArea = parseBody(body.studyArea);
  const pair = parseBody(body.acquisitionPair);
  const dataset = parseBody(body.dataset);
  const stats = parseBody(body.statistics);
  if (!studyArea || !pair || !dataset || !stats) return null;

  const facts = {
    studyArea: {
      name: str(studyArea.name),
      country: str(studyArea.country),
      phenomenon: str(studyArea.phenomenon, 300),
    },
    observationPair: {
      sensorBand: str(pair.band),
      productType: str(pair.productType),
      polarisation: str(pair.polarisation, 20),
      temporalBaselineDays: num(pair.temporalBaselineDays),
      earlierAcquisition: str(pair.earlier, 40),
      laterAcquisition: str(pair.later, 40),
    },
    dataset: {
      status: str(dataset.status, 40),
      valueUnit: str(dataset.unit, 60),
      limitations: Array.isArray(dataset.limitations)
        ? dataset.limitations.map((l) => str(l, 300)).filter(Boolean).slice(0, 6)
        : [],
    },
    calculatedStatistics: {
      unit: str(stats.unit, 60),
      mean: num(stats.mean),
      median: num(stats.median),
      p10: num(stats.p10),
      p25: num(stats.p25),
      p75: num(stats.p75),
      p90: num(stats.p90),
      validPixelFraction: num(stats.validFraction),
    },
  };

  return JSON.stringify(facts, null, 2);
}

const SYSTEM_INSTRUCTION = `You explain radar change-detection results for a scientific monitoring tool built on NASA-ISRO NISAR SAR data.

You receive: study-area metadata, an observation pair (two acquisitions), dataset notes, and calculated summary statistics of a pixel-level difference between the two observations. You do not receive the imagery itself.

Write a short explanation as JSON with exactly these fields:
- "observed_signal": what changed in the observed radar signal, based only on the provided statistics (2 sentences maximum).
- "possible_interpretation": what the observed change could potentially indicate on the ground (1-2 sentences, tentative language such as "could", "may", "is consistent with").
- "limitations": what cannot be concluded from the available observations (1-2 sentences).

Hard rules:
- Total length: 2-4 sentences across the three fields.
- Never invent measurements, numbers, dates or product identifiers not present in the input.
- Never claim or imply that you inspected satellite imagery; you only saw statistics.
- Clearly separate measured facts ("observed_signal") from interpretation ("possible_interpretation", "limitations").
- A decrease in backscatter is NOT proof of flooding; a change is NOT proof of deforestation or vegetation loss. Do not name a specific cause as established fact.
- Use the unit exactly as provided. If the values are quicklook display units rather than calibrated backscatter, say so and do not convert or restate them as dB or sigma0.
- Do not add greetings, headings, caveats beyond the requested fields, or markdown.`;

async function callGemini(prompt: string): Promise<Explanation> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error("GEMINI_API_KEY is not configured on the server."), {
      status: 503,
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  let res: Response;
  try {
    res = await fetch(
      `${apiBase()}/models/${model()}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 400,
            responseMimeType: "application/json",
            responseSchema: {
              type: "object",
              properties: {
                observed_signal: { type: "string" },
                possible_interpretation: { type: "string" },
                limitations: { type: "string" },
              },
              required: ["observed_signal", "possible_interpretation", "limitations"],
            },
          },
        }),
      },
    );
  } catch {
    throw Object.assign(new Error("The explanation service could not be reached."), {
      status: 502,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw Object.assign(
      new Error(`The explanation service returned an error (HTTP ${res.status}).`),
      { status: 502 },
    );
  }

  const payload = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw Object.assign(new Error("The explanation service returned an empty response."), {
      status: 502,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw Object.assign(new Error("The explanation service returned an unreadable response."), {
      status: 502,
    });
  }
  const obj = parsed as Record<string, unknown>;
  return {
    observedSignal: str(obj.observed_signal, MAX_TEXT) ?? "",
    possibleIndication: str(obj.possible_interpretation, MAX_TEXT) ?? "",
    limitations: str(obj.limitations, MAX_TEXT) ?? "",
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Send a POST request." });
    return;
  }

  const body = parseBody(req.body);
  const prompt = body ? buildPrompt(body) : null;
  if (!body || !prompt) {
    res.status(400).json({ error: "Invalid request body." });
    return;
  }

  try {
    const explanation = await callGemini(prompt);
    res.status(200).json({ explanation, model: model() });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const message =
      err instanceof Error ? err.message : "Unexpected server error.";
    res.status(status).json({ error: message });
  }
}

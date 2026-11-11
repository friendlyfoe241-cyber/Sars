// Quick smoke test for api/explain-change.ts (run with: node scripts/test-api.mjs)
// Exercises request validation and the missing-API-key path without network calls.

const { default: handler } = await import("../api/explain-change.ts");

function makeRes() {
  return {
    code: null,
    body: null,
    status(c) {
      this.code = c;
      return this;
    },
    json(b) {
      this.body = b;
    },
  };
}

const validBody = {
  studyArea: { name: "Tonj floodplain wetlands", country: "South Sudan", phenomenon: "Seasonal wetland inundation" },
  acquisitionPair: {
    band: "L-band",
    productType: "L2 GCOV",
    polarisation: "HH",
    temporalBaselineDays: 12,
    earlier: "2026-10-25T03:42:52Z",
    later: "2026-11-06T03:42:53Z",
  },
  dataset: { status: "nisar_quicklook", unit: "display DN", limitations: ["quicklook values are display units"] },
  statistics: { unit: "display DN", mean: -2.1, median: -3.0, p10: -40, p25: -12, p75: 8, p90: 30, validFraction: 0.967 },
};

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`ok   ${name}`);
  else {
    failures++;
    console.log(`FAIL ${name}: ${detail}`);
  }
}

// 1. wrong method
let res = makeRes();
await handler({ method: "GET" }, res);
check("GET rejected with 405", res.code === 405, `got ${res.code}`);

// 2. invalid body
res = makeRes();
await handler({ method: "POST", body: { nonsense: true } }, res);
check("invalid body rejected with 400", res.code === 400, `got ${res.code}`);

// 3. string body works too
res = makeRes();
await handler({ method: "POST", body: JSON.stringify(validBody) }, res);
check(
  "string body accepted (reaches the service layer)",
  res.code === 503 || res.code === 200,
  `got ${res.code} ${JSON.stringify(res.body)}`,
);

// 4. missing API key -> graceful 503
delete process.env.GEMINI_API_KEY;
res = makeRes();
await handler({ method: "POST", body: validBody }, res);
check(
  "missing GEMINI_API_KEY returns 503 with a clear message",
  res.code === 503 && /GEMINI_API_KEY/.test(res.body?.error ?? ""),
  `got ${res.code} ${JSON.stringify(res.body)}`,
);

// 5. full request/response round-trip against a mock Gemini endpoint
const http = await import("node:http");
let captured = null;
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    captured = { url: req.url, body: JSON.parse(body) };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          observed_signal: "The median difference is small.",
          possible_interpretation: "This could indicate stable conditions.",
          limitations: "Flood extent cannot be determined.",
        }) }] } }],
      }),
    );
  });
});
await new Promise((r) => mock.listen(0, r));
const port = mock.address().port;
process.env.GEMINI_API_KEY = "test-key";
process.env.GEMINI_API_BASE = `http://127.0.0.1:${port}/v1beta`;

res = makeRes();
await handler({ method: "POST", body: validBody }, res);
check(
  "mocked Gemini round-trip returns the structured explanation",
  res.code === 200 && res.body?.explanation?.observedSignal === "The median difference is small.",
  `got ${res.code} ${JSON.stringify(res.body)}`,
);
check(
  "Gemini request carries the stats and the system instruction",
  captured?.url?.includes("/models/") &&
    captured?.url?.includes("key=test-key") &&
    JSON.stringify(captured?.body?.contents ?? "").includes("validPixelFraction") &&
    (captured?.body?.systemInstruction?.parts?.[0]?.text ?? "").includes("Never invent"),
  JSON.stringify(captured?.url),
);
mock.close();

process.exit(failures === 0 ? 0 : 1);

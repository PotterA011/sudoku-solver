const API_BASE = "https://sudokupad.app/api/puzzle/";
const LEGACY_BASE = "https://sudokupad.svencodes.com/ctclegacy/";

const form = document.getElementById("load-form");
const input = document.getElementById("puzzle-input");
const statusEl = document.getElementById("status");
const boardWrap = document.getElementById("board-wrap");
const jsonOut = document.getElementById("json-output");

const metaKey = document.getElementById("meta-key");
const metaTitle = document.getElementById("meta-title");
const metaAuthor = document.getElementById("meta-author");
const metaRules = document.getElementById("meta-rules");

function setStatus(msg) {
  statusEl.textContent = msg;
}

function extractApiKey(rawInput) {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return "";
  }

  const normalizedInput =
    /^sudokupad\.app\//i.test(trimmed) || /^www\.sudokupad\.app\//i.test(trimmed)
      ? `https://${trimmed}`
      : trimmed;

  try {
    const url = new URL(normalizedInput);
    const queryKey = url.searchParams.get("puzzleid");
    if (queryKey) {
      return decodeURIComponent(queryKey).replace(/^\/+|\/+$/g, "");
    }

    let pathKey = decodeURIComponent(url.pathname || "");
    pathKey = pathKey.replace(/^\/+|\/+$/g, "");
    pathKey = pathKey.replace(/^sudoku\//i, "");
    if (pathKey) {
      return pathKey;
    }
  } catch (_err) {
    return trimmed.replace(/^\/+|\/+$/g, "");
  }

  return trimmed.replace(/^\/+|\/+$/g, "");
}

function encodePuzzlePath(key) {
  return key
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function decodePayload(rawPayload) {
  const stripped = rawPayload.replace(/^(scl|ctc)/, "");
  const fixed = loadFPuzzle.fixFPuzzleSlashes(
    loadFPuzzle.saveDecodeURIComponent(stripped)
  ) || stripped;
  const decompressed = loadFPuzzle.saveDecompress(fixed);
  return PuzzleZipper.saveJsonUnzip(decompressed);
}

function parseCageMetadata(cages) {
  const metadata = {};
  for (const cage of cages || []) {
    if (!cage || typeof cage !== "object") {
      continue;
    }
    const value = cage.value;
    if (typeof value !== "string" || !value.includes(":")) {
      continue;
    }
    const idx = value.indexOf(":");
    const key = value.slice(0, idx).trim().toLowerCase();
    const val = value.slice(idx + 1).trim();
    if (["title", "author", "rules", "solution"].includes(key) && val) {
      metadata[key] = val;
    }
  }
  return metadata;
}

function normalizePuzzle(apiKey, rawPayload, decoded, fetchedUrl) {
  const rawMetadata =
    decoded && typeof decoded.metadata === "object" && decoded.metadata !== null
      ? decoded.metadata
      : {};
  const cages = Array.isArray(decoded.cages) ? decoded.cages : [];
  const lines = Array.isArray(decoded.lines) ? decoded.lines : [];
  const underlays = Array.isArray(decoded.underlays) ? decoded.underlays : [];
  const overlays = Array.isArray(decoded.overlays) ? decoded.overlays : [];
  const regions = Array.isArray(decoded.regions) ? decoded.regions : [];
  const cells = Array.isArray(decoded.cells) ? decoded.cells : [];

  const metaFromCages = parseCageMetadata(cages);
  const metadata = {
    source: rawMetadata.source || null,
    title: metaFromCages.title || rawMetadata.title || decoded.title || null,
    author: metaFromCages.author || rawMetadata.author || decoded.author || null,
    rules: metaFromCages.rules || rawMetadata.rules || decoded.rules || null,
    solution: metaFromCages.solution || null,
  };

  const givens = [];
  const values = [];
  for (let r = 0; r < cells.length; r += 1) {
    const row = Array.isArray(cells[r]) ? cells[r] : [];
    for (let c = 0; c < row.length; c += 1) {
      const cell = row[c];
      if (!cell || typeof cell !== "object") {
        continue;
      }
      if (cell.value === undefined || cell.value === null || cell.value === "") {
        continue;
      }
      const entry = { row: r, col: c, value: cell.value };
      if (cell.given === true) {
        givens.push(entry);
      } else {
        values.push(entry);
      }
    }
  }

  const rows = cells.length;
  const cols = rows > 0 && Array.isArray(cells[0]) ? cells[0].length : 0;

  return {
    api_key: apiKey,
    source: {
      fetched_url: fetchedUrl,
      raw_prefix: rawPayload.slice(0, 3),
      raw_length: rawPayload.length,
    },
    metadata,
    grid: {
      rows,
      cols,
      cell_size: decoded.cellSize || 64,
      cells,
    },
    features: {
      lines,
      arrows: lines.filter((line) => line && Array.isArray(line.wayPoints)),
      cages,
      underlays,
      overlays,
      regions,
      givens,
      values,
    },
    stats: {
      line_count: lines.length,
      arrow_count: lines.filter((line) => line && Array.isArray(line.wayPoints)).length,
      cage_count: cages.length,
      underlay_count: underlays.length,
      overlay_count: overlays.length,
      region_count: regions.length,
      given_count: givens.length,
      value_count: values.length,
    },
    decoded_raw: decoded,
  };
}

function drawGrid(svg, rows, cols, cellPx) {
  const width = cols * cellPx;
  const height = rows * cellPx;

  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("x", "0");
  bg.setAttribute("y", "0");
  bg.setAttribute("width", String(width));
  bg.setAttribute("height", String(height));
  bg.setAttribute("fill", "white");
  svg.appendChild(bg);

  for (let r = 0; r <= rows; r += 1) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", "0");
    line.setAttribute("y1", String(r * cellPx));
    line.setAttribute("x2", String(width));
    line.setAttribute("y2", String(r * cellPx));
    line.setAttribute("stroke", "black");
    line.setAttribute("stroke-width", r === 0 || r === rows ? "2.5" : "1");
    svg.appendChild(line);
  }

  for (let c = 0; c <= cols; c += 1) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(c * cellPx));
    line.setAttribute("y1", "0");
    line.setAttribute("x2", String(c * cellPx));
    line.setAttribute("y2", String(height));
    line.setAttribute("stroke", "black");
    line.setAttribute("stroke-width", c === 0 || c === cols ? "2.5" : "1");
    svg.appendChild(line);
  }
}

function drawRegionBoundaries(svg, regions, rows, cols, cellPx) {
  if (!Array.isArray(regions) || regions.length === 0) {
    return;
  }

  const regionMap = new Map();
  for (let rid = 0; rid < regions.length; rid += 1) {
    const region = regions[rid];
    if (!Array.isArray(region)) {
      continue;
    }
    for (const cell of region) {
      if (!Array.isArray(cell) || cell.length < 2) {
        continue;
      }
      const r = Number(cell[0]);
      const c = Number(cell[1]);
      if (Number.isFinite(r) && Number.isFinite(c)) {
        regionMap.set(`${r},${c}`, rid);
      }
    }
  }

  const sameRegion = (r1, c1, r2, c2) =>
    regionMap.get(`${r1},${c1}`) !== undefined &&
    regionMap.get(`${r1},${c1}`) === regionMap.get(`${r2},${c2}`);

  const drawEdge = (x1, y1, x2, y2) => {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(x1));
    line.setAttribute("y1", String(y1));
    line.setAttribute("x2", String(x2));
    line.setAttribute("y2", String(y2));
    line.setAttribute("stroke", "#000");
    line.setAttribute("stroke-width", "2.5");
    svg.appendChild(line);
  };

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      // top edge
      if (r === 0 || !sameRegion(r, c, r - 1, c)) {
        drawEdge(c * cellPx, r * cellPx, (c + 1) * cellPx, r * cellPx);
      }
      // left edge
      if (c === 0 || !sameRegion(r, c, r, c - 1)) {
        drawEdge(c * cellPx, r * cellPx, c * cellPx, (r + 1) * cellPx);
      }
      // bottom edge
      if (r === rows - 1 || !sameRegion(r, c, r + 1, c)) {
        drawEdge(c * cellPx, (r + 1) * cellPx, (c + 1) * cellPx, (r + 1) * cellPx);
      }
      // right edge
      if (c === cols - 1 || !sameRegion(r, c, r, c + 1)) {
        drawEdge((c + 1) * cellPx, r * cellPx, (c + 1) * cellPx, (r + 1) * cellPx);
      }
    }
  }
}

function drawUnderlays(svg, underlays, cellPx) {
  for (const u of underlays) {
    if (!u || !Array.isArray(u.center)) {
      continue;
    }
    const width = Number(u.width || 1) * cellPx;
    const height = Number(u.height || 1) * cellPx;
    const cx = Number(u.center[0]) * cellPx;
    const cy = Number(u.center[1]) * cellPx;
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(cx - width / 2));
    rect.setAttribute("y", String(cy - height / 2));
    rect.setAttribute("width", String(width));
    rect.setAttribute("height", String(height));
    rect.setAttribute("fill", u.backgroundColor || "#f2f2f2");
    rect.setAttribute("fill-opacity", "0.35");
    svg.appendChild(rect);
  }
}

function drawLines(svg, lines, cellPx) {
  const hasExplicitFill = (fill) => {
    if (typeof fill !== "string") {
      return false;
    }
    const f = fill.trim().toLowerCase();
    return f !== "" && f !== "none" && f !== "transparent" && f !== "#ffffff00";
  };

  for (const l of lines) {
    if (!l || !Array.isArray(l.wayPoints) || l.wayPoints.length < 2) {
      continue;
    }
    const pts = l.wayPoints.map((p) => `${Number(p[1]) * cellPx},${Number(p[0]) * cellPx}`);
    const isClosed =
      pts.length > 2 && pts[0] === pts[pts.length - 1] && hasExplicitFill(l.fill);
    if (isClosed && hasExplicitFill(l.fill)) {
      const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      poly.setAttribute("points", pts.join(" "));
      poly.setAttribute("fill", l.fill);
      poly.setAttribute("stroke", l.color || "#000");
      poly.setAttribute("stroke-width", String((Number(l.thickness) || 1) * 0.2));
      svg.appendChild(poly);
      continue;
    }
    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("points", pts.join(" "));
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke", l.color || "#000");
    polyline.setAttribute("stroke-width", String(Number(l.thickness) || 2));
    polyline.setAttribute("stroke-linecap", l["stroke-linecap"] || "round");
    polyline.setAttribute("stroke-linejoin", l["stroke-linejoin"] || "round");
    svg.appendChild(polyline);
  }
}

function drawOverlays(svg, overlays, cellPx) {
  for (const overlay of overlays || []) {
    if (!overlay || !Array.isArray(overlay.center)) {
      continue;
    }
    const text = overlay.text;
    if (typeof text !== "string" || text.length === 0) {
      continue;
    }
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    const x = Number(overlay.center[1]) * cellPx;
    const y = Number(overlay.center[0]) * cellPx;
    t.textContent = text;
    t.setAttribute("x", String(x));
    t.setAttribute("y", String(y));
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("dominant-baseline", "middle");
    t.setAttribute("font-size", String(overlay.fontSize || 18));
    t.setAttribute("fill", overlay.color || "#111");
    if (overlay.angle) {
      t.setAttribute("transform", `rotate(${Number(overlay.angle)}, ${x}, ${y})`);
    }
    svg.appendChild(t);
  }
}

function drawNumbers(svg, cells, cellPx) {
  for (let r = 0; r < cells.length; r += 1) {
    const row = Array.isArray(cells[r]) ? cells[r] : [];
    for (let c = 0; c < row.length; c += 1) {
      const cell = row[c];
      if (!cell || typeof cell !== "object") {
        continue;
      }
      if (cell.value === undefined || cell.value === null || cell.value === "") {
        continue;
      }
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.textContent = String(cell.value);
      text.setAttribute("x", String((c + 0.5) * cellPx));
      text.setAttribute("y", String((r + 0.62) * cellPx));
      text.setAttribute("font-size", String(Math.max(14, Math.floor(cellPx * 0.48))));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("fill", "#111");
      svg.appendChild(text);
    }
  }
}

function renderPuzzle(normalized) {
  const rows = normalized.grid.rows || 9;
  const cols = normalized.grid.cols || 9;
  const cellPx = 48;
  const width = cols * cellPx;
  const height = rows * cellPx;

  boardWrap.innerHTML = "";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("board-svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));

  drawGrid(svg, rows, cols, cellPx);
  drawRegionBoundaries(svg, normalized.features.regions, rows, cols, cellPx);
  drawUnderlays(svg, normalized.features.underlays, cellPx);
  drawLines(svg, normalized.features.lines, cellPx);
  drawOverlays(svg, normalized.features.overlays, cellPx);
  drawNumbers(svg, normalized.grid.cells, cellPx);

  boardWrap.appendChild(svg);
}

function updateMeta(normalized) {
  metaKey.textContent = normalized.api_key || "-";
  metaTitle.textContent = normalized.metadata.title || "Unknown";
  metaAuthor.textContent = normalized.metadata.author || "Unknown";
  metaRules.textContent = normalized.metadata.rules || "None found";
}

async function loadPuzzle(inputValue) {
  const apiKey = extractApiKey(inputValue);
  if (!apiKey) {
    throw new Error("Please enter a SudokuPad URL or API key.");
  }
  const candidateUrls = [
    `${API_BASE}${encodePuzzlePath(apiKey)}`,
    `${LEGACY_BASE}${encodePuzzlePath(apiKey)}`,
  ];

  let rawPayload = "";
  let fetchedUrl = "";
  let lastErr = "";
  for (const url of candidateUrls) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        lastErr = `Failed to fetch puzzle (${res.status}) from ${url}`;
        continue;
      }
      rawPayload = (await res.text()).trim();
      fetchedUrl = url;
      if (rawPayload) {
        break;
      }
      lastErr = `Empty response from ${url}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }

  if (!rawPayload) {
    throw new Error(
      `Failed to fetch puzzle. Last error: ${lastErr || "unknown error"}`
    );
  }

  const decoded = decodePayload(rawPayload);
  if (!decoded || typeof decoded !== "object") {
    throw new Error("Decoded puzzle is not an object.");
  }
  return normalizePuzzle(apiKey, rawPayload, decoded, fetchedUrl);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    setStatus("Loading puzzle...");
    const normalized = await loadPuzzle(input.value);
    updateMeta(normalized);
    renderPuzzle(normalized);
    jsonOut.value = JSON.stringify(normalized, null, 2);
    setStatus("Loaded and rendered.");
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "Failed to load puzzle.");
  }
});

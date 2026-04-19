const API_BASE = "https://sudokupad.app/api/puzzle/";

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

  try {
    const url = new URL(trimmed);
    const queryKey = url.searchParams.get("puzzleid");
    if (queryKey) {
      return decodeURIComponent(queryKey);
    }

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length > 0) {
      return decodeURIComponent(parts[parts.length - 1]);
    }
  } catch (_err) {
    return trimmed;
  }

  return trimmed;
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

function normalizePuzzle(apiKey, rawPayload, decoded) {
  const cages = Array.isArray(decoded.cages) ? decoded.cages : [];
  const lines = Array.isArray(decoded.lines) ? decoded.lines : [];
  const underlays = Array.isArray(decoded.underlays) ? decoded.underlays : [];
  const overlays = Array.isArray(decoded.overlays) ? decoded.overlays : [];
  const regions = Array.isArray(decoded.regions) ? decoded.regions : [];
  const cells = Array.isArray(decoded.cells) ? decoded.cells : [];

  const metaFromCages = parseCageMetadata(cages);
  const metadata = {
    title: metaFromCages.title || decoded.title || null,
    author: metaFromCages.author || decoded.author || null,
    rules: metaFromCages.rules || decoded.rules || null,
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
      fetched_url: `${API_BASE}${encodeURIComponent(apiKey)}`,
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
  for (const l of lines) {
    if (!l || !Array.isArray(l.wayPoints) || l.wayPoints.length < 2) {
      continue;
    }
    const pts = l.wayPoints.map((p) => `${Number(p[1]) * cellPx},${Number(p[0]) * cellPx}`);
    const isClosed =
      pts.length > 2 && pts[0] === pts[pts.length - 1] && (l.fill || l.color || "#000");
    if (isClosed) {
      const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      poly.setAttribute("points", pts.join(" "));
      poly.setAttribute("fill", l.fill || l.color || "#000");
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
  drawUnderlays(svg, normalized.features.underlays, cellPx);
  drawLines(svg, normalized.features.lines, cellPx);
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
  const res = await fetch(`${API_BASE}${encodeURIComponent(apiKey)}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch puzzle (${res.status})`);
  }
  const rawPayload = (await res.text()).trim();
  const decoded = decodePayload(rawPayload);
  if (!decoded || typeof decoded !== "object") {
    throw new Error("Decoded puzzle is not an object.");
  }
  return normalizePuzzle(apiKey, rawPayload, decoded);
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

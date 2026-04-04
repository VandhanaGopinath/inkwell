/**
 * canvas.js — Inkwell Canvas Engine
 * Smooth Bezier drawing, pressure sensitivity, zoom/pan
 */

const CanvasEngine = (() => {
  // Canvas elements
  let mainCanvas, ctx, cursorCanvas, cursorCtx;
  let wrapper;

  // Drawing state
  let isDrawing = false;
  let currentTool = 'pen';
  let currentColor = '#1a1a2e';
  let currentSize = 3;
  let currentOpacity = 1;
  let lastPoint = null;
  let points = [];

  // Zoom / Pan
  let scale = 1;
  let offsetX = 24;
  let offsetY = 24;
  let isPanning = false;
  let panStart = { x: 0, y: 0 };
  let panOffset = { x: 0, y: 0 };

  // Dimensions
  const CANVAS_W = 1200;
  const CANVAS_H = 1600;

  // Stroke collection (for persistence)
  let currentStroke = null;

  // ── Init ──────────────────────────────────────────────
  function init() {
    mainCanvas = document.getElementById('main-canvas');
    ctx = mainCanvas.getContext('2d');
    cursorCanvas = document.getElementById('cursor-canvas');
    cursorCtx = cursorCanvas.getContext('2d');
    wrapper = document.getElementById('canvas-wrapper');

    mainCanvas.width = CANVAS_W;
    mainCanvas.height = CANVAS_H;
    cursorCanvas.width = wrapper.offsetWidth;
    cursorCanvas.height = wrapper.offsetHeight;

    drawPageLines();
    positionCanvas();
    bindEvents();
    updateZoomLabel();
  }

  function positionCanvas() {
    mainCanvas.style.left = `${offsetX}px`;
    mainCanvas.style.top = `${offsetY}px`;
    mainCanvas.style.transform = `scale(${scale})`;
    mainCanvas.style.transformOrigin = 'top left';
    cursorCanvas.style.left = '0';
    cursorCanvas.style.top = '0';
    cursorCanvas.width = wrapper.offsetWidth;
    cursorCanvas.height = wrapper.offsetHeight;
  }

  function drawPageLines() {
    ctx.save();
    ctx.strokeStyle = '#f0f0f8';
    ctx.lineWidth = 0.8;
    for (let y = 40; y < CANVAS_H; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_W, y);
      ctx.stroke();
    }
    // Left margin line
    ctx.strokeStyle = '#ffd6d0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(60, 0);
    ctx.lineTo(60, CANVAS_H);
    ctx.stroke();
    ctx.restore();
  }

  // ── Event Binding ─────────────────────────────────────
  function bindEvents() {
    // Mouse events
    mainCanvas.addEventListener('mousedown', onPointerDown);
    mainCanvas.addEventListener('mousemove', onPointerMove);
    mainCanvas.addEventListener('mouseup', onPointerUp);
    mainCanvas.addEventListener('mouseleave', onPointerLeave);

    // Touch events
    mainCanvas.addEventListener('touchstart', onTouchStart, { passive: false });
    mainCanvas.addEventListener('touchmove', onTouchMove, { passive: false });
    mainCanvas.addEventListener('touchend', onTouchEnd, { passive: false });

    // Pointer events (stylus pressure)
    mainCanvas.addEventListener('pointerdown', onStylusDown);
    mainCanvas.addEventListener('pointermove', onStylusMove);
    mainCanvas.addEventListener('pointerup', onStylusUp);

    // Cursor preview on wrapper
    wrapper.addEventListener('mousemove', drawCursor);
    wrapper.addEventListener('mouseleave', clearCursor);

    // Zoom
    wrapper.addEventListener('wheel', onWheel, { passive: false });

    // Keyboard shortcuts
    window.addEventListener('keydown', onKeyDown);

    // Resize observer
    new ResizeObserver(positionCanvas).observe(wrapper);
  }

  // ── Coordinate Helpers ────────────────────────────────
  function getCanvasPoint(clientX, clientY) {
    const rect = mainCanvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / scale,
      y: (clientY - rect.top) / scale,
    };
  }

  function getWrapperPoint(clientX, clientY) {
    const rect = wrapper.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  // ── Drawing ───────────────────────────────────────────
  function onPointerDown(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return; // handled by stylus
    if (e.altKey) return startPan(e.clientX, e.clientY);
    e.preventDefault();
    beginStroke(e.clientX, e.clientY, 0.5);
  }

  function onStylusDown(e) {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    const pressure = e.pressure || 0.5;
    beginStroke(e.clientX, e.clientY, pressure);
    mainCanvas.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!isDrawing) return;
    if (e.pointerType && e.pointerType !== 'mouse') return;
    continueStroke(e.clientX, e.clientY, 0.5);
  }

  function onStylusMove(e) {
    if (e.pointerType === 'mouse') return;
    if (!isDrawing) return;
    continueStroke(e.clientX, e.clientY, e.pressure || 0.5);
  }

  function onPointerUp(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    endStroke();
  }

  function onStylusUp(e) {
    if (e.pointerType === 'mouse') return;
    endStroke();
  }

  function onPointerLeave(e) {
    if (!isPanning) endStroke();
  }

  function onTouchStart(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
      const t = e.touches[0];
      beginStroke(t.clientX, t.clientY, 0.5);
    }
  }

  function onTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 1 && isDrawing) {
      const t = e.touches[0];
      continueStroke(t.clientX, t.clientY, 0.5);
    }
  }

  function onTouchEnd(e) {
    e.preventDefault();
    endStroke();
  }

  // ── Stroke Logic ──────────────────────────────────────
  function beginStroke(clientX, clientY, pressure) {
    if (isPanning) return;
    isDrawing = true;
    const pt = getCanvasPoint(clientX, clientY);
    lastPoint = pt;
    points = [{ ...pt, pressure, time: Date.now() }];

    // Start stroke record
    currentStroke = {
      tool: currentTool,
      color: currentColor,
      size: currentSize,
      opacity: currentOpacity,
      points: [{ x: pt.x, y: pt.y, pressure, time: Date.now() }],
    };

    ctx.save();
    applyToolStyle();

    if (currentTool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
    }

    ctx.beginPath();
    ctx.arc(pt.x, pt.y, (currentSize * pressure) / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function continueStroke(clientX, clientY, pressure) {
    if (!isDrawing) return;
    const pt = getCanvasPoint(clientX, clientY);
    points.push({ ...pt, pressure, time: Date.now() });

    if (currentStroke) {
      currentStroke.points.push({ x: pt.x, y: pt.y, pressure, time: Date.now() });
    }

    if (points.length < 2) { lastPoint = pt; return; }

    ctx.save();
    applyToolStyle();

    if (currentTool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = currentSize * 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(lastPoint.x, lastPoint.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
    } else {
      // Bezier smoothing
      const prev = points.length >= 3 ? points[points.length - 3] : lastPoint;
      const p1 = points[points.length - 2];
      const p2 = pt;

      const cp1x = p1.x + (p2.x - prev.x) * 0.2;
      const cp1y = p1.y + (p2.y - prev.y) * 0.2;
      const cp2x = p2.x - (p2.x - p1.x) * 0.2;
      const cp2y = p2.y - (p2.y - p1.y) * 0.2;

      const width = currentSize * pressure * (currentTool === 'highlighter' ? 6 : 1);

      ctx.lineWidth = Math.max(0.5, width);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
      ctx.stroke();
    }

    ctx.restore();
    lastPoint = pt;
  }

  function endStroke() {
    if (!isDrawing) return;
    isDrawing = false;
    points = [];

    // Push stroke to StrokeManager for undo/redo and persistence
    if (currentStroke && window.StrokeManager) {
      window.StrokeManager.pushStroke(currentStroke);
    }
    currentStroke = null;
  }

  function applyToolStyle() {
    if (currentTool === 'highlighter') {
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = currentColor;
      ctx.fillStyle = currentColor;
    } else {
      ctx.globalAlpha = currentOpacity;
      ctx.strokeStyle = currentColor;
      ctx.fillStyle = currentColor;
    }
  }

  // ── Cursor Preview ────────────────────────────────────
  function drawCursor(e) {
    const rect = wrapper.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    clearCursor();
    cursorCtx.save();

    const size = currentTool === 'eraser'
      ? currentSize * 4 * scale
      : currentSize * scale;

    cursorCtx.globalAlpha = currentTool === 'highlighter' ? 0.4 : 0.7;
    cursorCtx.fillStyle = currentTool === 'eraser' ? 'rgba(255,0,0,0.3)' : currentColor;
    cursorCtx.strokeStyle = currentTool === 'eraser' ? '#ff4444' : currentColor;
    cursorCtx.lineWidth = 1.5;

    cursorCtx.beginPath();
    cursorCtx.arc(cx, cy, Math.max(2, size / 2), 0, Math.PI * 2);

    if (currentTool === 'eraser') {
      cursorCtx.stroke();
    } else {
      cursorCtx.fill();
    }

    cursorCtx.restore();
  }

  function clearCursor() {
    cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
  }

  // ── Zoom & Pan ────────────────────────────────────────
  function onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Zoom
      const delta = e.deltaY < 0 ? 1.1 : 0.9;
      const rect = wrapper.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const prevScale = scale;
      scale = Math.min(4, Math.max(0.2, scale * delta));

      // Adjust offset to zoom toward cursor
      offsetX = mx - (mx - offsetX) * (scale / prevScale);
      offsetY = my - (my - offsetY) * (scale / prevScale);

      positionCanvas();
      updateZoomLabel();
    } else {
      // Pan
      offsetX -= e.deltaX;
      offsetY -= e.deltaY;
      positionCanvas();
    }
  }

  function startPan(clientX, clientY) {
    isPanning = true;
    panStart = { x: clientX - offsetX, y: clientY - offsetY };
    wrapper.style.cursor = 'grab';
  }

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomIn(); }
      if (e.key === '-') { e.preventDefault(); zoomOut(); }
      if (e.key === '0') { e.preventDefault(); zoomReset(); }
    }
    // Tool shortcuts
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === 'p') setTool('pen');
      if (e.key === 'h') setTool('highlighter');
      if (e.key === 'e') setTool('eraser');
    }
  }

  function zoomIn() {
    scale = Math.min(4, scale * 1.2);
    positionCanvas();
    updateZoomLabel();
  }

  function zoomOut() {
    scale = Math.max(0.2, scale / 1.2);
    positionCanvas();
    updateZoomLabel();
  }

  function zoomReset() {
    scale = 1;
    offsetX = 24;
    offsetY = 24;
    positionCanvas();
    updateZoomLabel();
  }

  function updateZoomLabel() {
    const label = document.getElementById('zoom-label');
    if (label) label.textContent = Math.round(scale * 100) + '%';
  }

  // ── Tool / Color / Size Setters ───────────────────────
  function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    wrapper.style.cursor = 'none';
  }

  function setColor(color) {
    currentColor = color;
    document.querySelectorAll('.color-swatch').forEach(sw => {
      sw.classList.toggle('active', sw.dataset.color === color);
    });
  }

  function setSize(size) {
    currentSize = parseFloat(size);
  }

  // ── Canvas Operations ─────────────────────────────────
  function clearCanvas() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawPageLines();
  }

  function getImageData() {
    return ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
  }

  function putImageData(data) {
    ctx.putImageData(data, 0, 0);
  }

  function getDataURL(format = 'image/png') {
    return mainCanvas.toDataURL(format);
  }

  function getCanvas() { return mainCanvas; }
  function getCtx() { return ctx; }

  // ── Restore Strokes ───────────────────────────────────
  function redrawStrokes(strokes) {
    clearCanvas();
    strokes.forEach(stroke => {
      replayStroke(stroke);
    });
  }

  function replayStroke(stroke) {
    if (!stroke.points || stroke.points.length === 0) return;
    ctx.save();

    if (stroke.tool === 'highlighter') {
      ctx.globalAlpha = 0.3;
    } else {
      ctx.globalAlpha = stroke.opacity || 1;
    }

    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (stroke.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
    }

    const pts = stroke.points;
    if (pts.length === 1) {
      const p = pts[0];
      ctx.beginPath();
      ctx.arc(p.x, p.y, stroke.size * (p.pressure || 0.5) / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      for (let i = 1; i < pts.length; i++) {
        const p1 = pts[i - 1];
        const p2 = pts[i];
        const prev = i >= 2 ? pts[i - 2] : p1;

        const cp1x = p1.x + (p2.x - prev.x) * 0.2;
        const cp1y = p1.y + (p2.y - prev.y) * 0.2;
        const cp2x = p2.x - (p2.x - p1.x) * 0.2;
        const cp2y = p2.y - (p2.y - p1.y) * 0.2;

        const pressure = p2.pressure || 0.5;
        const width = stroke.size * pressure * (stroke.tool === 'highlighter' ? 6 : 1);

        ctx.lineWidth = Math.max(0.5, width);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  // ── Public API ────────────────────────────────────────
  return {
    init,
    setTool,
    setColor,
    setSize,
    clearCanvas,
    getDataURL,
    getCanvas,
    getCtx,
    getImageData,
    putImageData,
    redrawStrokes,
    replayStroke,
    zoomIn,
    zoomOut,
    zoomReset,
    drawPageLines,
    get currentTool() { return currentTool; },
    get currentColor() { return currentColor; },
    get currentSize() { return currentSize; },
    CANVAS_W,
    CANVAS_H,
  };
})();

window.CanvasEngine = CanvasEngine;

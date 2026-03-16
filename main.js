const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d', { alpha: false });

const ui = {
    muInput: document.getElementById('muInput'),
    dtInput: document.getElementById('dtInput'),
    timeScaleInput: document.getElementById('timeScaleInput'),
    launchScaleInput: document.getElementById('launchScaleInput'),
    vectorScaleInput: document.getElementById('vectorScaleInput'),
    trailLengthInput: document.getElementById('trailLengthInput'),
    showTrailsInput: document.getElementById('showTrailsInput'),
    showVectorsInput: document.getElementById('showVectorsInput'),
    pauseBtn: document.getElementById('pauseBtn'),
    removeLastBtn: document.getElementById('removeLastBtn'),
    clearBtn: document.getElementById('clearBtn'),
    stats: document.getElementById('stats')
};

const viewport = {
    width: 0,
    height: 0,
    dpr: 1
};

const state = {
    mu: 1,
    dt: 0.004,
    timeScale: 1,
    scale: 120,            // пикселей на 1 мировую единицу
    launchScale: 1.2,      // перевод drag-вектора в начальную скорость
    vectorScale: 0.35,     // визуальная длина вектора скорости
    showTrails: true,
    showVectors: false,
    trailMaxLength: 120,
    trailSampleEvery: 2,
    centerRadius: 0.08,    // радиус центрального тела в мировых единицах
    farRadius: 40,         // удаление тел, улетевших слишком далеко
    paused: false
};

const drag = {
    active: false,
    pointerId: null,
    startWorld: null,
    currentWorld: null
};

const colors = [
    '#ff6b6b',
    '#ffd166',
    '#06d6a0',
    '#4cc9f0',
    '#f72585',
    '#b8f2e6',
    '#f4a261',
    '#a29bfe',
    '#90be6d',
    '#e76f51'
];

let bodies = [];
let lastTime = performance.now();
let accumulator = 0;

function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    viewport.width = rect.width;
    viewport.height = rect.height;
    viewport.dpr = window.devicePixelRatio || 1;

    canvas.width = Math.round(viewport.width * viewport.dpr);
    canvas.height = Math.round(viewport.height * viewport.dpr);

    ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
}

function worldToScreen(x, y) {
    return {
        x: viewport.width / 2 + x * state.scale,
        y: viewport.height / 2 - y * state.scale
    };
}

function screenToWorld(px, py) {
    return {
        x: (px - viewport.width / 2) / state.scale,
        y: (viewport.height / 2 - py) / state.scale
    };
}

function eventToCanvasPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
    };
}

function readNumber(input, fallback, min = -Infinity, max = Infinity) {
    const value = Number(input.value);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
}

function randomColor() {
    return colors[Math.floor(Math.random() * colors.length)];
}

function accelerationAt(x, y) {
    const r2 = x * x + y * y;
    const centerR2 = state.centerRadius * state.centerRadius;

    if (r2 <= centerR2) {
        return { ax: 0, ay: 0, inside: true };
    }

    const invR = 1 / Math.sqrt(r2);
    const invR3 = invR * invR * invR;
    const factor = -state.mu * invR3;

    return {
        ax: factor * x,
        ay: factor * y,
        inside: false
    };
}

function createBody(x, y, vx, vy) {
    const a = accelerationAt(x, y);
    if (a.inside) return null;

    return {
        x,
        y,
        vx,
        vy,
        ax: a.ax,
        ay: a.ay,
        color: randomColor(),
        trail: [{ x, y }],
        trailTick: 0,
        alive: true
    };
}

function recomputeAccelerations() {
    for (const body of bodies) {
        const a = accelerationAt(body.x, body.y);
        if (a.inside) {
            body.alive = false;
        } else {
            body.ax = a.ax;
            body.ay = a.ay;
        }
    }
    bodies = bodies.filter(body => body.alive);
}

function trimTrails() {
    for (const body of bodies) {
        if (body.trail.length > state.trailMaxLength) {
            body.trail = body.trail.slice(-state.trailMaxLength);
        }
    }
}

function applySettings() {
    state.mu = readNumber(ui.muInput, 1, 0.0001);
    state.dt = readNumber(ui.dtInput, 0.004, 0.0005);
    state.timeScale = readNumber(ui.timeScaleInput, 1, 0.1);
    state.launchScale = readNumber(ui.launchScaleInput, 1.2, 0.01);
    state.vectorScale = readNumber(ui.vectorScaleInput, 0.35, 0.01);
    state.trailMaxLength = Math.floor(readNumber(ui.trailLengthInput, 120, 10, 1000));
    state.showTrails = ui.showTrailsInput.checked;
    state.showVectors = ui.showVectorsInput.checked;

    trimTrails();
    recomputeAccelerations();
}

function stepBody(body, dt) {
    const nextX = body.x + body.vx * dt + 0.5 * body.ax * dt * dt;
    const nextY = body.y + body.vy * dt + 0.5 * body.ay * dt * dt;

    const nextA = accelerationAt(nextX, nextY);

    if (nextA.inside) {
        body.alive = false;
        return;
    }

    const nextVx = body.vx + 0.5 * (body.ax + nextA.ax) * dt;
    const nextVy = body.vy + 0.5 * (body.ay + nextA.ay) * dt;

    body.x = nextX;
    body.y = nextY;
    body.vx = nextVx;
    body.vy = nextVy;
    body.ax = nextA.ax;
    body.ay = nextA.ay;

    const r = Math.hypot(body.x, body.y);
    if (r > state.farRadius) {
        body.alive = false;
        return;
    }

    body.trailTick += 1;
    if (body.trailTick >= state.trailSampleEvery) {
        body.trailTick = 0;
        body.trail.push({ x: body.x, y: body.y });

        if (body.trail.length > state.trailMaxLength) {
            body.trail.shift();
        }
    }
}

function physicsStep(dt) {
    for (const body of bodies) {
        if (body.alive) {
            stepBody(body, dt);
        }
    }
    bodies = bodies.filter(body => body.alive);
}

function drawArrow(x1, y1, x2, y2, color, width = 1.5) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);

    if (length < 1) return;

    const ux = dx / length;
    const uy = dy / length;
    const head = Math.min(10, length * 0.35);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(
        x2 - ux * head - uy * head * 0.45,
        y2 - uy * head + ux * head * 0.45
    );
    ctx.lineTo(
        x2 - ux * head + uy * head * 0.45,
        y2 - uy * head - ux * head * 0.45
    );
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}

function drawAxes() {
    const cx = viewport.width / 2;
    const cy = viewport.height / 2;

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(viewport.width, cy);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, viewport.height);
    ctx.stroke();

    ctx.restore();
}

function drawCenterBody() {
    const center = worldToScreen(0, 0);
    const radiusPx = Math.max(6, state.centerRadius * state.scale);

    ctx.save();
    ctx.shadowColor = 'rgba(255, 209, 102, 0.6)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawTrail(body) {
    if (body.trail.length < 2) return;

    ctx.save();
    ctx.strokeStyle = body.color;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.beginPath();
    for (let i = 0; i < body.trail.length; i++) {
        const p = worldToScreen(body.trail[i].x, body.trail[i].y);
        if (i === 0) {
            ctx.moveTo(p.x, p.y);
        } else {
            ctx.lineTo(p.x, p.y);
        }
    }
    ctx.stroke();
    ctx.restore();
}

function drawVelocityVector(body) {
    const start = worldToScreen(body.x, body.y);
    const end = worldToScreen(
        body.x + body.vx * state.vectorScale,
        body.y + body.vy * state.vectorScale
    );

    drawArrow(start.x, start.y, end.x, end.y, body.color, 1.6);
}

function drawBody(body) {
    const p = worldToScreen(body.x, body.y);

    ctx.save();
    ctx.fillStyle = body.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawDragPreview() {
    if (!drag.active || !drag.startWorld || !drag.currentWorld) return;

    const start = worldToScreen(drag.startWorld.x, drag.startWorld.y);
    const current = worldToScreen(drag.currentWorld.x, drag.currentWorld.y);

    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(current.x, current.y);
    ctx.stroke();
    ctx.restore();

    drawArrow(start.x, start.y, current.x, current.y, '#ffffff', 1.3);

    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(start.x, start.y, 4, 0, Math.PI * 2);
    ctx.fill();

    const vx = (drag.currentWorld.x - drag.startWorld.x) * state.launchScale;
    const vy = (drag.currentWorld.y - drag.startWorld.y) * state.launchScale;
    const v = Math.hypot(vx, vy);

    ctx.font = '13px Inter, Arial, sans-serif';
    ctx.fillText(`v0 = ${v.toFixed(3)}`, current.x + 10, current.y - 10);
    ctx.restore();
}

function updateStats() {
    ui.stats.innerHTML = `
    Тел: <b>${bodies.length}</b><br>
    μ = ${state.mu.toFixed(3)}<br>
    dt = ${state.dt.toFixed(4)}<br>
  `;
}

function render() {
    ctx.fillStyle = '#050816';
    ctx.fillRect(0, 0, viewport.width, viewport.height);

    drawAxes();
    drawCenterBody();

    if (state.showTrails) {
        for (const body of bodies) {
            drawTrail(body);
        }
    }

    if (state.showVectors) {
        for (const body of bodies) {
            drawVelocityVector(body);
        }
    }

    for (const body of bodies) {
        drawBody(body);
    }

    drawDragPreview();
    updateStats();
}

function togglePause() {
    state.paused = !state.paused;
    ui.pauseBtn.textContent = state.paused ? 'Продолжить' : 'Пауза';
}

function clearAll() {
    bodies = [];
}

function removeLast() {
    bodies.pop();
}

function startDrag(event) {
    if (event.button !== 0) return;

    const pos = eventToCanvasPosition(event);
    const world = screenToWorld(pos.x, pos.y);

    if (Math.hypot(world.x, world.y) <= state.centerRadius * 1.1) {
        return;
    }

    drag.active = true;
    drag.pointerId = event.pointerId;
    drag.startWorld = world;
    drag.currentWorld = world;

    canvas.setPointerCapture(event.pointerId);
}

function moveDrag(event) {
    if (!drag.active || event.pointerId !== drag.pointerId) return;

    const pos = eventToCanvasPosition(event);
    drag.currentWorld = screenToWorld(pos.x, pos.y);
}

function endDrag(event) {
    if (!drag.active || event.pointerId !== drag.pointerId) return;

    const pos = eventToCanvasPosition(event);
    drag.currentWorld = screenToWorld(pos.x, pos.y);

    const vx = (drag.currentWorld.x - drag.startWorld.x) * state.launchScale;
    const vy = (drag.currentWorld.y - drag.startWorld.y) * state.launchScale;

    const body = createBody(drag.startWorld.x, drag.startWorld.y, vx, vy);
    if (body) {
        bodies.push(body);
    }

    drag.active = false;
    drag.pointerId = null;
    drag.startWorld = null;
    drag.currentWorld = null;
}

function cancelDrag() {
    drag.active = false;
    drag.pointerId = null;
    drag.startWorld = null;
    drag.currentWorld = null;
}

function animate(now) {
    let elapsed = (now - lastTime) / 1000;
    lastTime = now;

    if (elapsed > 0.05) elapsed = 0.05;

    if (!state.paused) {
        accumulator += elapsed * state.timeScale;

        let substeps = 0;
        const maxSubsteps = 400;

        while (accumulator >= state.dt && substeps < maxSubsteps) {
            physicsStep(state.dt);
            accumulator -= state.dt;
            substeps += 1;
        }

        if (substeps === maxSubsteps) {
            accumulator = 0;
        }
    }

    render();
    requestAnimationFrame(animate);
}

function init() {
    resizeCanvas();
    applySettings();
    render();

    window.addEventListener('resize', resizeCanvas);

    [
        ui.muInput,
        ui.dtInput,
        ui.timeScaleInput,
        ui.launchScaleInput,
        ui.vectorScaleInput,
        ui.trailLengthInput,
        ui.showTrailsInput,
        ui.showVectorsInput
    ].forEach(input => {
        input.addEventListener('input', applySettings);
        input.addEventListener('change', applySettings);
    });

    ui.pauseBtn.addEventListener('click', togglePause);
    ui.clearBtn.addEventListener('click', clearAll);
    ui.removeLastBtn.addEventListener('click', removeLast);

    canvas.addEventListener('pointerdown', startDrag);
    canvas.addEventListener('pointermove', moveDrag);
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', cancelDrag);

    requestAnimationFrame(animate);
}

init();
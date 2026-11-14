(function () {
  "use strict";

  // Exact WGSL caustic-water fragment shader from the Figma file's "Water caustic"
  // shader fill (same algorithm/constants Figma uses), paired with a minimal
  // fullscreen-quad vertex shader so it can run standalone via WebGPU.
  var WGSL = `
diagnostic(off,derivative_uniformity);
struct Uniforms {
  frameData: vec4f,
  inputDimsAndPad: vec4f,
  waterColor: vec4f,
  highlightColor: vec4f,
  intensity: vec4f,
  playhead: vec4f,
  scale: vec4f,
  center: vec4f,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VsIn {
  @location(0) pos: vec2f,
  @location(1) uv: vec2f,
};
struct VsOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex fn vs_main(in: VsIn) -> VsOut {
  var out: VsOut;
  out.position = vec4f(in.pos, 0.0, 1.0);
  out.uv = in.uv;
  return out;
}

@fragment fn fs_main(@location(0) outputUv_in: vec2f) -> @location(0) vec4f {
  let outputUv = outputUv_in;
  let dims = max(u.frameData.yz, vec2f(1.0));
  let inputDims = max(u.inputDimsAndPad.xy, vec2f(1.0));
  let fragPx = outputUv * dims;
  let uvRaw = fragPx / inputDims;
  let waterColor = u.waterColor;
  let highlightColor = u.highlightColor;
  let intensity = u.intensity.x;
  let playhead = u.playhead.x;
  let scale = u.scale.x;
  let cx = u.center.x / 100.0;
  let cy = u.center.y / 100.0;
  let uv = (uvRaw - vec2f(cx, cy)) / scale + vec2f(1.0 - cx, 1.0 - cy);
  let TAU = 6.28318530718;
  let MAX_ITER = 5;
  let t_val = playhead * TAU / 100.0 + 23.0;
  let minDim = min(dims.x, dims.y);
  let uvPx = uv * dims / minDim;
  let p = (fract(uvPx) * TAU) - 250.0;
  var i = p;
  var c = 1.0;
  let inten = mix(0.002519, 0.01178, intensity);
  for (var n = 0; n < MAX_ITER; n++) {
    let nt = t_val * f32(n + 1);
    i = p + vec2f(cos(nt - i.x) + sin(nt + i.y), sin(nt - i.y) + cos(nt + i.x));
    c += 1.0 / length(vec2f(p.x / (sin(i.x + nt) / inten), p.y / (cos(i.y + nt) / inten)));
  }
  c /= f32(MAX_ITER);
  c = 1.17 - pow(c, 1.4);
  let causticMask = clamp(pow(abs(c), 8.0), 0.0, 1.0);
  let alpha = mix(waterColor.a, highlightColor.a, causticMask);
  let colour = mix(waterColor.rgb, highlightColor.rgb, causticMask);
  return vec4f(colour * alpha, alpha);
}
`;

  // Default params lifted from the Figma shader instances on this design.
  var DEFAULTS = {
    waterColor: [0.4769010841846466, 0.6674377918243408, 0.8235989809036255, 1],
    highlightColor: [0.9289175271987915, 0.9858560562133789, 1, 1],
    intensity: 0.24,
    scale: 1,
    center: [50, 20.13052749633789],
  };

  function colorToArray(c, fallback) {
    return Array.isArray(c) ? c : fallback;
  }

  async function mountCausticCanvas(container, opts) {
    opts = opts || {};
    if (!("gpu" in navigator)) return false;

    var canvas = document.createElement("canvas");
    canvas.className = "water-canvas";
    container.appendChild(canvas);

    var adapter, device;
    try {
      adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error("no adapter");
      device = await adapter.requestDevice();
    } catch (e) {
      canvas.remove();
      return false;
    }

    var ctx = canvas.getContext("webgpu");
    if (!ctx) {
      canvas.remove();
      return false;
    }
    var format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device: device, format: format, alphaMode: "premultiplied" });

    var module = device.createShaderModule({ code: WGSL });

    // Fullscreen quad: pos.xy in clip space, uv in [0,1] (y flipped so uv.y=0 is top).
    var verts = new Float32Array([
      -1, -1, 0, 1,
       1, -1, 1, 1,
      -1,  1, 0, 0,
      -1,  1, 0, 0,
       1, -1, 1, 1,
       1,  1, 1, 0,
    ]);
    var vbuf = device.createBuffer({
      size: verts.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(vbuf.getMappedRange()).set(verts);
    vbuf.unmap();

    var ubuf = device.createBuffer({
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    var pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: module,
        entryPoint: "vs_main",
        buffers: [{
          arrayStride: 16,
          attributes: [
            { shaderLocation: 0, format: "float32x2", offset: 0 },
            { shaderLocation: 1, format: "float32x2", offset: 8 },
          ],
        }],
      },
      fragment: { module: module, entryPoint: "fs_main", targets: [{ format: format }] },
      primitive: { topology: "triangle-list" },
    });

    var bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: ubuf } }],
    });

    var waterColor = colorToArray(opts.waterColor, DEFAULTS.waterColor);
    var highlightColor = colorToArray(opts.highlightColor, DEFAULTS.highlightColor);
    var intensity = typeof opts.intensity === "number" ? opts.intensity : DEFAULTS.intensity;
    var scale = typeof opts.scale === "number" ? opts.scale : DEFAULTS.scale;
    var center = colorToArray(opts.center, DEFAULTS.center);
    var speed = typeof opts.speed === "number" ? opts.speed : 0.6; // playhead units/sec
    var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    function resize() {
      var w = Math.max(1, Math.round(container.clientWidth * dpr));
      var h = Math.max(1, Math.round(container.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    }
    resize();
    var ro = new ResizeObserver(resize);
    ro.observe(container);

    var playhead = 22.06;
    var lastT = null;
    var running = true;
    var io = new IntersectionObserver(function (entries) {
      running = entries[0].isIntersecting;
      if (running) { lastT = null; requestAnimationFrame(frame); }
    }, { rootMargin: "200px" });
    io.observe(container);

    function frame(t) {
      if (!running) return;
      if (lastT == null) lastT = t;
      var dt = (t - lastT) / 1000;
      lastT = t;
      if (!reduceMotion) playhead += dt * speed;

      var w = canvas.width, h = canvas.height;
      var data = new Float32Array(32);
      data.set([0, w, h, 0], 0);
      data.set([w, h, 0, 0], 4);
      data.set(waterColor, 8);
      data.set(highlightColor, 12);
      data.set([intensity, 0, 0, 0], 16);
      data.set([playhead, 0, 0, 0], 20);
      data.set([scale, 0, 0, 0], 24);
      data.set([center[0], center[1], 0, 0], 28);
      device.queue.writeBuffer(ubuf, 0, data);

      var encoder = device.createCommandEncoder();
      var pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: ctx.getCurrentTexture().createView(),
          loadOp: "clear",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: "store",
        }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.setVertexBuffer(0, vbuf);
      pass.draw(6);
      pass.end();
      device.queue.submit([encoder.finish()]);

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    device.lost.then(function () {
      running = false;
    });

    return true;
  }

  // The whole sea as ONE continuous shape and ONE canvas, from a soft
  // fade-in behind the hero caricature, through the postcard section,
  // out through the pulled tendril's wavy edge. The mask stacks three
  // pieces in the tendril's own coordinate space: a gradient-fade rect
  // (the hero fade), a plain rect (the postcard section), and the
  // tendril's "filled above the curve" shape — so no seam shows
  // anywhere along the whole run.
  async function mountSea() {
    var container = document.querySelector(".sea");
    var strokeContainer = document.querySelector(".sea-stroke");
    var heroEl = document.querySelector(".hero");
    var aboutEl = document.querySelector(".about");
    var tendrilEl = document.querySelector(".water-sand-edge-wrap");
    if (!container || !strokeContainer || !heroEl || !aboutEl || !tendrilEl) return;

    // Fraction of the hero's own height, counting up from its bottom
    // edge, where the sea fade begins (measured off the Figma export).
    var HERO_FADE_FRACTION = 0.42;
    // How much of that fade band is the actual fade (the rest is solid).
    var HERO_FADE_SOLID_AT = 0.48;

    var TENDRIL_W = 1998.95;
    var TENDRIL_H = 689.712;
    var curveD = null;
    try {
      // ?v= bump this whenever water-fill-shape.svg's content changes — fetch()
      // isn't covered by index.html's own asset-versioning, and this file is
      // cached like any other static asset.
      var res = await fetch("images/shared/water-fill-shape.svg?v=20261109b");
      var text = await res.text();
      var m = text.match(/<path d="([^"]+)"/);
      if (m) curveD = m[1];
    } catch (e) {
      /* fall through with curveD null */
    }

    // The raw, unclosed torn-paper line (not the closed fill shape above)
    // — this is what gets drawn as a visible stroke rather than used as
    // a mask, so it must be the open path, not water-fill-shape.svg's
    // closed-for-filling version.
    var strokeD = null;
    try {
      var sres = await fetch("images/shared/water-sand-edge.svg?v=20261109c");
      var stext = await sres.text();
      var sm = stext.match(/<path d="([^"]+)"/);
      if (sm) strokeD = sm[1];
    } catch (e) {
      /* fall through with strokeD null */
    }

    var currentMaskUrl = null;
    var currentStrokeUrl = null;

    function layout() {
      var hRect = heroEl.getBoundingClientRect();
      var aRect = aboutEl.getBoundingClientRect();
      var tRect = tendrilEl.getBoundingClientRect();
      var scrollY = window.scrollY;

      var fadeDistance = HERO_FADE_FRACTION * hRect.height;
      var top = hRect.bottom + scrollY - fadeDistance;
      var bottom = tRect.bottom + scrollY;
      container.style.top = top + "px";
      container.style.height = Math.max(1, bottom - top) + "px";
      // Identical top/height to the mask container, so the stroke (drawn
      // from the same path data, in the same coordinate space, further
      // below) can only ever land exactly on the mask's own cutout edge.
      strokeContainer.style.top = top + "px";
      strokeContainer.style.height = Math.max(1, bottom - top) + "px";

      if (!curveD) return; // no mask available; container still shows its gradient fallback
      var tendrilH = Math.max(1, tRect.height);
      var svgPerPx = TENDRIL_H / tendrilH;
      var fadeH = fadeDistance * svgPerPx;
      var aboutH = Math.max(1, aRect.height) * svgPerPx;
      // The fade and the solid section below it are one continuous rect
      // sharing a single gradient fill (rather than two abutting shapes)
      // so there's no seam between them — adjacent SVG shapes can leave a
      // faint anti-aliasing line where their edges meet at a non-integer
      // pixel row. The rect also overlaps a few units into the curve
      // below it for the same reason: both are fully opaque white there,
      // so the overlap is invisible but removes that seam too.
      var solidH = fadeH + aboutH;
      var overlap = Math.max(2, TENDRIL_H * 0.004);
      var totalH = solidH + TENDRIL_H;
      var svg =
        '<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" viewBox="0 0 ' + TENDRIL_W + " " + totalH + '">' +
        '<defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#fff" stop-opacity="0"/>' +
        '<stop offset="' + (solidH ? (fadeH * HERO_FADE_SOLID_AT) / solidH : 1) + '" stop-color="#fff" stop-opacity="1"/>' +
        '<stop offset="1" stop-color="#fff" stop-opacity="1"/>' +
        "</linearGradient></defs>" +
        '<rect x="0" y="0" width="' + TENDRIL_W + '" height="' + (solidH + overlap) + '" fill="url(#f)"/>' +
        '<g transform="translate(0,' + solidH + ')"><path d="' + curveD + '" fill="#fff"/></g>' +
        "</svg>";
      var blob = new Blob([svg], { type: "image/svg+xml" });
      var url = URL.createObjectURL(blob);
      var prevUrl = currentMaskUrl;
      currentMaskUrl = url;
      container.style.webkitMaskImage = 'url("' + url + '")';
      container.style.maskImage = 'url("' + url + '")';
      container.style.webkitMaskSize = "100% 100%";
      container.style.maskSize = "100% 100%";
      container.style.webkitMaskRepeat = "no-repeat";
      container.style.maskRepeat = "no-repeat";
      if (prevUrl) URL.revokeObjectURL(prevUrl);

      if (strokeD) {
        // Continue the path in a straight line well past each end, then
        // widen the viewBox (and the container + filter region, by the
        // same amount) to match — so the stroke's actual terminus sits
        // outside the viewport and only ever gets clipped by it, instead
        // of ending visibly on-screen. Each side is kept just large
        // enough to clear the displacement jaggedness (feDisplacementMap
        // scale 12) with a little room to spare, not the much bigger
        // margin this used to carry — real iOS Safari can let a
        // pinch-zoom-out gesture reach past the clipping ancestor and
        // expose whatever hangs off each edge here. The right side gets
        // less margin than the left: that's the end users actually
        // zoom out and notice, so it's trimmed closer to the minimum
        // the jaggedness needs.
        var STROKE_EXT_START_FRACTION = 0.05;
        var STROKE_EXT_END_FRACTION = 0.015;
        var strokeExtStart = TENDRIL_W * STROKE_EXT_START_FRACTION;
        var strokeExtEnd = TENDRIL_W * STROKE_EXT_END_FRACTION;
        var extendedStrokeD = strokeD;
        var startMatch = strokeD.match(/^M\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/);
        var endMatch = strokeD.match(/(-?[\d.]+)[ ,]+(-?[\d.]+)\s*$/);
        if (startMatch && endMatch) {
          var startX = parseFloat(startMatch[1]), startY = parseFloat(startMatch[2]);
          var endX = parseFloat(endMatch[1]), endY = parseFloat(endMatch[2]);
          extendedStrokeD =
            "M" + (startX - strokeExtStart) + " " + startY +
            "L" + strokeD.slice(1) +
            "L" + (endX + strokeExtEnd) + " " + endY;
        }
        var strokeViewW = TENDRIL_W + strokeExtStart + strokeExtEnd;
        var strokeSvg =
          '<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" viewBox="' + -strokeExtStart + " 0 " + strokeViewW + " " + totalH + '">' +
          '<defs><filter id="torn" x="' + -strokeExtStart + '" y="0" width="' + strokeViewW + '" height="' + TENDRIL_H + '" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">' +
          '<feTurbulence type="fractalNoise" baseFrequency="0.25 0.25" numOctaves="3" seed="2782"/>' +
          '<feDisplacementMap in="SourceGraphic" scale="12" xChannelSelector="R" yChannelSelector="G"/>' +
          "</filter></defs>" +
          '<g transform="translate(0,' + solidH + ')"><path d="' + extendedStrokeD + '" fill="none" stroke="#fff" stroke-width="36" filter="url(#torn)"/></g>' +
          "</svg>";
        var strokeBlob = new Blob([strokeSvg], { type: "image/svg+xml" });
        var strokeUrl = URL.createObjectURL(strokeBlob);
        var prevStrokeUrl = currentStrokeUrl;
        currentStrokeUrl = strokeUrl;
        var extStartPct = STROKE_EXT_START_FRACTION * 100;
        var extEndPct = STROKE_EXT_END_FRACTION * 100;
        strokeContainer.style.left = -extStartPct + "%";
        strokeContainer.style.width = (100 + extStartPct + extEndPct) + "%";
        strokeContainer.style.backgroundImage = 'url("' + strokeUrl + '")';
        strokeContainer.style.backgroundSize = "100% 100%";
        strokeContainer.style.backgroundRepeat = "no-repeat";
        if (prevStrokeUrl) URL.revokeObjectURL(prevStrokeUrl);
      }
    }

    layout();
    window.addEventListener("resize", layout);

    var ok = await mountCausticCanvas(container, { speed: 0.6 });
    if (ok) container.classList.add("water-bg--gpu");
  }

  function init() {
    mountSea();
    document.querySelectorAll("[data-caustic]").forEach(function (el) {
      var opts = {};
      if (el.hasAttribute("data-caustic-speed")) {
        opts.speed = parseFloat(el.getAttribute("data-caustic-speed"));
      }
      mountCausticCanvas(el, opts).then(function (ok) {
        if (ok) el.classList.add("water-bg--gpu");
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

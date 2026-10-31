(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Eye tracking ---------- */
  (function eyeTracking() {
    var eyeLeft = document.getElementById("eye-left");
    var eyeRight = document.getElementById("eye-right");
    if (!eyeLeft || !eyeRight || reduceMotion) return;

    var maxOffset = 7; // in SVG viewBox units

    function moveEyes(clientX, clientY) {
      [eyeLeft, eyeRight].forEach(function (eye) {
        var rect = eye.getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        var dx = clientX - cx;
        var dy = clientY - cy;
        var angle = Math.atan2(dy, dx);
        var dist = Math.min(maxOffset, Math.hypot(dx, dy) / 20);
        var ox = Math.cos(angle) * dist;
        var oy = Math.sin(angle) * dist;
        eye.style.transform = "translate(" + ox.toFixed(1) + "px, " + oy.toFixed(1) + "px)";
      });
    }

    document.addEventListener("mousemove", function (e) {
      moveEyes(e.clientX, e.clientY);
    });
    document.addEventListener("touchmove", function (e) {
      if (e.touches && e.touches[0]) moveEyes(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
  })();

  /* ---------- Scroll morph: cheek stars -> postcard starfish ---------- */
  (function cheekToStarfish() {
    var cheekRight = document.getElementById("cheek-right");
    var cheekLeft = document.getElementById("cheek-left");
    var target = document.querySelector(".starfish-big");
    var hero = document.querySelector(".hero");
    if (!cheekRight || !cheekLeft || !target || !hero) return;

    var flying = document.createElement("div");
    flying.className = "flying-star";
    flying.innerHTML =
      '<svg viewBox="0 0 609 756" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M476.787 331.002C484.443 332.205 486.088 342.502 479.187 346.029L459.027 356.333C455.941 357.91 454.222 361.295 454.768 364.718L458.338 387.075C459.56 394.728 450.275 399.474 444.788 394.001L428.759 378.012C426.305 375.564 422.554 374.975 419.468 376.552L399.309 386.856C392.408 390.383 385.025 383.019 388.535 376.11L398.788 355.924C400.358 352.834 399.759 349.085 397.305 346.637L381.276 330.648C375.789 325.175 380.511 315.878 388.167 317.081L410.533 320.594C413.957 321.132 417.338 319.404 418.907 316.314L429.16 296.128C432.67 289.219 442.971 290.837 444.193 298.49L447.763 320.847C448.309 324.27 450.997 326.951 454.421 327.489L476.787 331.002Z" fill="#FFC29E"/>' +
      "</svg>";
    Object.assign(flying.style, {
      position: "absolute",
      pointerEvents: "none",
      zIndex: "5",
      opacity: "0",
      willChange: "transform, opacity",
    });
    document.body.appendChild(flying);

    var startRect, endRect, heroHeight;

    function measure() {
      var r1 = cheekRight.getBoundingClientRect();
      var r2 = cheekLeft.getBoundingClientRect();
      var scrollX = window.scrollX, scrollY = window.scrollY;
      var midX = (r1.left + r1.right + r2.left + r2.right) / 4 + scrollX;
      var midY = (r1.top + r1.bottom + r2.top + r2.bottom) / 4 + scrollY;
      var size = Math.max(r1.width, r1.height) * 1.6;
      startRect = { x: midX, y: midY, size: size };

      var t = target.getBoundingClientRect();
      endRect = {
        x: t.left + t.width / 2 + scrollX,
        y: t.top + t.height / 2 + scrollY,
        size: Math.max(t.width, t.height),
      };

      heroHeight = hero.offsetHeight;
    }

    function lerp(a, b, t) { return a + (b - a) * t; }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    var ticking = false;
    function update() {
      ticking = false;
      var progress = clamp(window.scrollY / heroHeight, 0, 1);

      var cheekOpacity = 1 - clamp(progress / 0.25, 0, 1);
      cheekRight.style.opacity = cheekOpacity;
      cheekLeft.style.opacity = cheekOpacity;

      var flyOpacity = clamp(progress / 0.1, 0, 1) - clamp((progress - 0.82) / 0.15, 0, 1);
      var size = lerp(startRect.size, endRect.size, progress);
      var x = lerp(startRect.x, endRect.x, progress);
      var y = lerp(startRect.y, endRect.y, progress);
      var rotate = lerp(0, 160, progress);

      flying.style.opacity = reduceMotion ? "0" : String(Math.max(0, flyOpacity));
      flying.style.width = size + "px";
      flying.style.height = size + "px";
      flying.style.left = (x - size / 2) + "px";
      flying.style.top = (y - size / 2) + "px";
      flying.style.transform = "rotate(" + rotate + "deg)";

      target.style.opacity = String(clamp((progress - 0.75) / 0.2, 0, 1));
    }

    function onScroll() {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    }

    target.style.transition = "opacity 0.2s linear";
    target.style.opacity = "0";

    measure();
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", function () {
      measure();
      update();
    });
  })();

  // Keep the runner figure's pulling hand locked onto the tendril's visual
  // tip at any viewport width: both the tendril (full-bleed, aspect-ratio
  // locked) and the figure (clamp()-sized) scale independently, so the
  // figure is positioned absolutely each layout pass from the tendril's
  // measured tip point plus the figure's own hand-anchor fraction.
  (function alignRunnerToTendril() {
    var wrap = document.querySelector(".water-sand-edge-wrap");
    var figure = document.querySelector(".runner-figure");
    var section = document.querySelector(".runner-transition");
    if (!wrap || !figure || !section) return;

    // Fraction of the tendril SVG's own box (2026.3 x 807.621) where its
    // path reaches its deepest/visual tip, nearest the pulling hand.
    var TIP_X_FRAC = 846.168 / 2026.3;
    var TIP_Y_FRAC = 788.782 / 807.621;

    // Fraction of the runner figure's own box (483 x 593) where its
    // fist/hand sits.
    var HAND_X_FRAC = 471 / 483;
    var HAND_Y_FRAC = 152 / 593;

    function layout() {
      var sectionRect = section.getBoundingClientRect();
      var wrapRect = wrap.getBoundingClientRect();

      var tipX = wrapRect.left - sectionRect.left + TIP_X_FRAC * wrapRect.width;
      var tipY = wrapRect.top - sectionRect.top + TIP_Y_FRAC * wrapRect.height;

      var vw = window.innerWidth;
      var figureWidth = Math.min(420, Math.max(220, vw * 0.32));
      var figureHeight = figureWidth * (593 / 483);

      var figureLeft = tipX - HAND_X_FRAC * figureWidth;
      var figureTop = tipY - HAND_Y_FRAC * figureHeight;

      figure.style.position = "absolute";
      figure.style.left = figureLeft + "px";
      figure.style.top = figureTop + "px";
      figure.style.width = figureWidth + "px";
      figure.style.margin = "0";

      var neededHeight = figureTop + figureHeight + 20;
      section.style.minHeight = Math.max(neededHeight, 60) + "px";
    }

    layout();
    window.addEventListener("resize", layout);
    window.addEventListener("load", layout);
  })();
})();

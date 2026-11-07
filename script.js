(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Eye tracking ---------- */
  (function eyeTracking() {
    var eyeLeft = document.getElementById("eye-left");
    var eyeRight = document.getElementById("eye-right");
    if (!eyeLeft || !eyeRight || reduceMotion) return;

    var maxOffset = 7; // in SVG viewBox units
    var eyes = [eyeLeft, eyeRight];
    var centers = null;

    // getBoundingClientRect() reflects the eye's CURRENT transform, so
    // measuring it on every mousemove (as the eye is already offset from
    // a previous move) feeds that offset back into the next center
    // calculation. Each eye sits at a different angle/distance from the
    // cursor, so that feedback loop converges differently per eye —
    // which read as the right eye being "more responsive" than the left.
    // Measuring each eye's resting center once (transform reset to none)
    // removes the feedback entirely.
    function measureCenters() {
      eyes.forEach(function (eye) { eye.style.transform = "translate(0px, 0px)"; });
      centers = eyes.map(function (eye) {
        var rect = eye.getBoundingClientRect();
        return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
      });
    }

    function moveEyes(clientX, clientY) {
      if (!centers) measureCenters();
      eyes.forEach(function (eye, i) {
        var c = centers[i];
        var dx = clientX - c.cx;
        var dy = clientY - c.cy;
        var angle = Math.atan2(dy, dx);
        var dist = Math.min(maxOffset, Math.hypot(dx, dy) / 20);
        var ox = Math.cos(angle) * dist;
        var oy = Math.sin(angle) * dist;
        eye.style.transform = "translate(" + ox.toFixed(1) + "px, " + oy.toFixed(1) + "px)";
      });
    }

    measureCenters();
    document.addEventListener("mousemove", function (e) {
      moveEyes(e.clientX, e.clientY);
    });
    document.addEventListener("touchmove", function (e) {
      if (e.touches && e.touches[0]) moveEyes(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    window.addEventListener("resize", measureCenters);
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
})();

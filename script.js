(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Eye tracking ---------- */
  (function eyeTracking() {
    var eyeLeft = document.getElementById("eye-left");
    var eyeRight = document.getElementById("eye-right");
    if (!eyeLeft || !eyeRight || reduceMotion) return;

    // How far the pupil may travel from center, as a fraction of the
    // eye shape's own radius (measured per-eye via getBBox, in local SVG
    // units — unaffected by CSS transforms or screen scaling), so the
    // motion stays visually inside the eye regardless of its rendered
    // size instead of using one fixed unit count tuned for a single size.
    var MAX_OFFSET_FRACTION = 0.3;
    var eyes = [eyeLeft, eyeRight];
    var centers = null;

    function eyeRadius(eye) {
      var box = eye.getBBox();
      return (box.width + box.height) / 4;
    }

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
        return {
          cx: rect.left + rect.width / 2,
          cy: rect.top + rect.height / 2,
          maxOffset: eyeRadius(eye) * MAX_OFFSET_FRACTION,
        };
      });
    }

    function moveEyes(clientX, clientY) {
      if (!centers) measureCenters();
      eyes.forEach(function (eye, i) {
        var c = centers[i];
        var dx = clientX - c.cx;
        var dy = clientY - c.cy;
        var angle = Math.atan2(dy, dx);
        var dist = Math.min(c.maxOffset, Math.hypot(dx, dy) / 12);
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

})();

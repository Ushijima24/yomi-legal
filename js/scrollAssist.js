/**
 * iOS / シミュレータ向けスクロール補助。
 * #app-scroll をタッチ・ホイール・マウスドラッグで動かす。
 */
(function initYomiScrollAssist() {
  function box() {
    return document.getElementById('app-scroll');
  }

  function ignoreTarget(t) {
    return !!(t && (t.closest('input, textarea, select, button, a, label') || t.isContentEditable));
  }

  let startY = 0;
  let startTop = 0;
  let active = false;

  function begin(y, target) {
    const el = box();
    if (!el || ignoreTarget(target)) return false;
    active = true;
    startY = y;
    startTop = el.scrollTop;
    return true;
  }

  function move(y) {
    const el = box();
    if (!active || !el) return;
    el.scrollTop = startTop + (startY - y);
  }

  function end() {
    active = false;
  }

  document.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) return;
      begin(e.touches[0].clientY, e.target);
    },
    { passive: true }
  );
  document.addEventListener(
    'touchmove',
    (e) => {
      if (!active || e.touches.length !== 1) return;
      move(e.touches[0].clientY);
    },
    { passive: true }
  );
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', end, { passive: true });

  // シミュレータ: マウスでドラッグ
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (begin(e.clientY, e.target)) e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!active) return;
    move(e.clientY);
  });
  document.addEventListener('mouseup', end);
  document.addEventListener('mouseleave', end);

  // シミュレータ: トラックパッドの2本指＝wheel
  document.addEventListener(
    'wheel',
    (e) => {
      const el = box();
      if (!el) return;
      el.scrollTop += e.deltaY;
      e.preventDefault();
    },
    { passive: false }
  );
})();

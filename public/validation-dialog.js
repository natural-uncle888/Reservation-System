(function () {
  // 捲動到指定欄位，並加上暫時的紅色高亮
  function scrollToField(target) {
    if (!target) return;

    var focusEl = target;

    // 如果是區塊元素，抓裡面的第一個可輸入欄位
    if (target.matches && (target.matches('section') || target.matches('.section') || target.matches('.form-row') || target.matches('.field-group'))) {
      var candidate = target.querySelector('input, textarea, select, button');
      if (candidate) {
        focusEl = candidate;
      }
    }

    try {
      if (focusEl && typeof focusEl.focus === "function") {
        focusEl.focus({ preventScroll: true });
      }
    } catch (e) {}

    if (target.scrollIntoView) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (focusEl && focusEl.scrollIntoView) {
      focusEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    if (target.classList && !target.classList.contains("field-error-highlight")) {
      target.classList.add("field-error-highlight");
      setTimeout(function () {
        target.classList.remove("field-error-highlight");
      }, 1600);
    }
  }

  function ensureBackdrop() {
    var backdrop = document.querySelector(".validation-backdrop");
    if (backdrop) return backdrop;

    backdrop = document.createElement("div");
    backdrop.className = "validation-backdrop";
    backdrop.innerHTML =
      '<div class="validation-modal" role="alertdialog" aria-modal="true" aria-labelledby="validation-title">' +
        '<div class="validation-title" id="validation-title">小提醒</div>' +
        '<div class="validation-message"></div>' +
        '<button type="button" class="validation-btn">回到填寫位置</button>' +
      "</div>";
    document.body.appendChild(backdrop);

    // 點背景關閉
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) {
        backdrop.classList.remove("is-active");
        if (backdrop._targetEl) scrollToField(backdrop._targetEl);
      }
    });

    // 點按鈕關閉
    var btn = backdrop.querySelector(".validation-btn");
    if (btn) {
      btn.addEventListener("click", function () {
        backdrop.classList.remove("is-active");
        if (backdrop._targetEl) scrollToField(backdrop._targetEl);
      });
    }

    return backdrop;
  }

  // 全站共用：顯示必填錯誤提示彈窗
  window.showValidationDialog = function (msg, targetEl) {
    var backdrop = ensureBackdrop();
    backdrop._targetEl = targetEl || null;

    var msgNode = backdrop.querySelector(".validation-message");
    if (msgNode) {
      msgNode.textContent = msg || "請檢查紅框標示的欄位";
    }

    backdrop.classList.add("is-active");

    if (targetEl) {
      scrollToField(targetEl);
    }
  };
})();

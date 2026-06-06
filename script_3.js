
document.addEventListener("DOMContentLoaded", function () {
  const buttons = document.querySelectorAll("button");
  buttons.forEach(btn => {
    if (btn.textContent.includes("貼上信件內容（僅顯示）")) {
      btn.style.display = "none";
    }
  });
});

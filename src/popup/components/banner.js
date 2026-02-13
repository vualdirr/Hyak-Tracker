const $ = (id) => document.getElementById(id);

export function setBannerBasic({ domain, title, subtitle }) {
  $("pageDomain") && ($("pageDomain").textContent = domain || "—");
  $("bannerTitle") && ($("bannerTitle").textContent = title || "—");
  $("bannerSub") && ($("bannerSub").textContent = subtitle || "—");

  // reset images
  const bg = $("bannerBg");
  if (bg) bg.style.backgroundImage = "";

  const poster = $("poster");
  if (poster) {
    poster.src = "";
    poster.style.display = "none";
  }

  $("animeStatusPill")?.classList.add("hidden");
}

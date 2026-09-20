(() => {
  const matches = Array.isArray(window.ARSENAL_MATCHES) ? [...window.ARSENAL_MATCHES] : [];
  matches.sort((a, b) => b.date.localeCompare(a.date));

  const latestEl = document.getElementById("latestReview");
  const archiveEl = document.getElementById("archiveList");
  const seasonFilter = document.getElementById("seasonFilter");
  const competitionFilter = document.getElementById("competitionFilter");
  const searchInput = document.getElementById("searchInput");
  const emptyState = document.getElementById("emptyState");

  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[char]));

  const formatDate = (iso) => {
    const [y, m, d] = iso.split("-");
    return y + "." + m + "." + d;
  };

  const list = (items) => "<ul>" + (Array.isArray(items) ? items : []).map((item) => "<li>" + escapeHtml(item) + "</li>").join("") + "</ul>";
  const safeStat = (match, key) => escapeHtml(match?.stats?.[key] ?? "—");

  function renderPhotos(match) {
    const photos = Array.isArray(match.photos) ? match.photos.filter((p) => p && p.src) : [];
    if (!photos.length) return "";
    return '<div class="photo-strip" aria-label="경기 주요 사진">' + photos.slice(0, 3).map((photo) => {
      const image = '<img loading="lazy" src="' + escapeHtml(photo.src) + '" alt="' + escapeHtml(photo.alt || match.title) + '">';
      const wrapped = photo.sourceUrl
        ? '<a href="' + escapeHtml(photo.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + image + '</a>'
        : image;
      const caption = photo.caption || photo.credit || "";
      return '<figure>' + wrapped + (caption ? '<figcaption>' + escapeHtml(caption) + '</figcaption>' : "") + '</figure>';
    }).join("") + "</div>";
  }

  function renderMedia(match) {
    const media = Array.isArray(match.media) ? match.media.filter((m) => m && m.url) : [];
    if (!media.length) return "";
    return '<section class="media"><h3>사진 · 영상</h3><div class="media-links">' +
      media.map((item) => '<a class="media-link" href="' + escapeHtml(item.url) +
        '" target="_blank" rel="noopener noreferrer">' + escapeHtml(item.label || "미디어 보기") + '</a>').join("") +
      '</div></section>';
  }

  function renderReview(match) {
    if (!match) {
      latestEl.innerHTML = '<p class="empty-state">아직 기록된 경기가 없음.</p>';
      return;
    }

    const sourceLinks = (match.sources || []).map((source) =>
      '<a href="' + escapeHtml(source.url) + '" target="_blank" rel="noopener noreferrer">' +
      escapeHtml(source.label) + "</a>"
    ).join("");

    const decisive = match.decisive || match.whyLost || [];

    latestEl.innerHTML = `
      <article class="match-review" id="${escapeHtml(match.id)}">
        <div class="match-hero">
          <div class="match-meta">
            <span>${escapeHtml(match.season)}</span>
            <span>${formatDate(match.date)}</span>
            <span>${escapeHtml(match.competition)} · ${escapeHtml(match.round)}</span>
            <span>${escapeHtml(match.venue)}</span>
            <span>결과 ${escapeHtml(match.result)}</span>
          </div>
          <div class="scoreline">
            <div class="team">${escapeHtml(match.home)}</div>
            <div class="score">${match.homeScore}–${match.awayScore}</div>
            <div class="team away">${escapeHtml(match.away)}</div>
          </div>
          <p class="verdict">${escapeHtml(match.verdict)}</p>
        </div>

        ${renderPhotos(match)}

        <div class="review-grid">
          <section class="review-block">
            <h3>경기 한눈에 보기</h3>
            ${list(match.summary)}
          </section>
          <section class="review-block">
            <h3>승패를 가른 핵심</h3>
            ${list(decisive)}
          </section>
          <section class="review-block">
            <h3>아르테타의 선택</h3>
            ${list(match.arteta)}
          </section>
          <section class="review-block">
            <h3>다음 경기에서 볼 것</h3>
            ${list(match.nextWatch)}
          </section>
        </div>

        <div class="stats" aria-label="아스날 경기 주요 통계">
          <div class="stat"><strong>${safeStat(match, "possession")}</strong><span>아스날 점유율</span></div>
          <div class="stat"><strong>${safeStat(match, "shots")}</strong><span>아스날 슈팅</span></div>
          <div class="stat"><strong>${safeStat(match, "xg")}</strong><span>아스날 xG</span></div>
          <div class="stat"><strong>${safeStat(match, "bigChances")}</strong><span>아스날 빅찬스</span></div>
        </div>

        ${renderMedia(match)}

        <div class="sources">
          <h3>참고 자료</h3>
          ${sourceLinks || '<span class="archive-sub">출처 정리 중</span>'}
        </div>
      </article>
    `;
  }

  function populateFilters() {
    [...new Set(matches.map((m) => m.season).filter(Boolean))].sort().reverse().forEach((season) => {
      const option = document.createElement("option");
      option.value = season;
      option.textContent = season;
      seasonFilter.appendChild(option);
    });

    [...new Set(matches.map((m) => m.competition).filter(Boolean))].sort().forEach((competition) => {
      const option = document.createElement("option");
      option.value = competition;
      option.textContent = competition;
      competitionFilter.appendChild(option);
    });
  }

  function filteredMatches() {
    const season = seasonFilter.value;
    const competition = competitionFilter.value;
    const query = searchInput.value.trim().toLowerCase();

    return matches.filter((match) => {
      const seasonOk = season === "all" || match.season === season;
      const competitionOk = competition === "all" || match.competition === competition;
      const searchText = [match.home, match.away, match.title, match.subtitle, match.round].join(" ").toLowerCase();
      const searchOk = !query || searchText.includes(query);
      return seasonOk && competitionOk && searchOk;
    });
  }

  function renderArchive() {
    const filtered = filteredMatches();
    archiveEl.innerHTML = "";
    emptyState.hidden = filtered.length > 0;

    filtered.forEach((match) => {
      const row = document.createElement("article");
      row.className = "archive-item";
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-label", match.title + " 리뷰 보기");
      row.innerHTML = `
        <div class="archive-date">${formatDate(match.date)}</div>
        <div>
          <h3 class="archive-title">${escapeHtml(match.title)}</h3>
          <p class="archive-sub">${escapeHtml(match.season)} · ${escapeHtml(match.competition)} · ${escapeHtml(match.round)}<br>${escapeHtml(match.subtitle)}</p>
        </div>
        <div class="archive-score">${match.homeScore}–${match.awayScore}</div>
      `;

      const open = () => {
        renderReview(match);
        document.getElementById("latest").scrollIntoView({ behavior: "smooth", block: "start" });
      };

      row.addEventListener("click", open);
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
      archiveEl.appendChild(row);
    });

    // Keep the selected review unless the active filters exclude it.
    const currentId = latestEl.querySelector(".match-review")?.id;
    if (filtered.length && (!currentId || !filtered.some((m) => m.id === currentId))) {
      renderReview(filtered[0]);
    }
  }

  populateFilters();
  renderReview(matches[0]);
  renderArchive();

  seasonFilter.addEventListener("change", renderArchive);
  competitionFilter.addEventListener("change", renderArchive);
  searchInput.addEventListener("input", renderArchive);
})();

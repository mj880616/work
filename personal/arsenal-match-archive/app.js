(() => {
  const matches = Array.isArray(window.ARSENAL_MATCHES) ? [...window.ARSENAL_MATCHES] : [];
  matches.sort((a, b) => b.date.localeCompare(a.date));

  const latestEl = document.getElementById("latestReview");
  const archiveEl = document.getElementById("archiveList");
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

  const list = (items) => "<ul>" + items.map((item) => "<li>" + escapeHtml(item) + "</li>").join("") + "</ul>";

  function renderReview(match) {
    if (!match) {
      latestEl.innerHTML = '<p class="empty-state">아직 기록된 경기가 없음.</p>';
      return;
    }

    const sourceLinks = match.sources.map((source) =>
      '<a href="' + escapeHtml(source.url) + '" target="_blank" rel="noopener noreferrer">' +
      escapeHtml(source.label) + "</a>"
    ).join("");

    latestEl.innerHTML = `
      <article class="match-review" id="${escapeHtml(match.id)}">
        <div class="match-hero">
          <div class="match-meta">
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

        <div class="review-grid">
          <section class="review-block">
            <h3>경기 한눈에 보기</h3>
            ${list(match.summary)}
          </section>
          <section class="review-block">
            <h3>왜 졌나</h3>
            ${list(match.whyLost)}
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
          <div class="stat"><strong>${escapeHtml(match.stats.possession)}</strong><span>아스날 점유율</span></div>
          <div class="stat"><strong>${escapeHtml(match.stats.shots)}</strong><span>아스날 슈팅</span></div>
          <div class="stat"><strong>${escapeHtml(match.stats.xg)}</strong><span>아스날 xG</span></div>
          <div class="stat"><strong>${escapeHtml(match.stats.bigChances)}</strong><span>아스날 빅찬스</span></div>
        </div>

        <div class="sources">
          <h3>참고 자료</h3>
          ${sourceLinks}
        </div>
      </article>
    `;
  }

  function populateCompetitionFilter() {
    const competitions = [...new Set(matches.map((m) => m.competition))].sort();
    competitions.forEach((competition) => {
      const option = document.createElement("option");
      option.value = competition;
      option.textContent = competition;
      competitionFilter.appendChild(option);
    });
  }

  function renderArchive() {
    const competition = competitionFilter.value;
    const query = searchInput.value.trim().toLowerCase();

    const filtered = matches.filter((match) => {
      const competitionOk = competition === "all" || match.competition === competition;
      const searchText = [match.home, match.away, match.title, match.subtitle].join(" ").toLowerCase();
      const searchOk = !query || searchText.includes(query);
      return competitionOk && searchOk;
    });

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
          <p class="archive-sub">${escapeHtml(match.subtitle)}</p>
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
  }

  populateCompetitionFilter();
  renderReview(matches[0]);
  renderArchive();

  competitionFilter.addEventListener("change", renderArchive);
  searchInput.addEventListener("input", renderArchive);
})();
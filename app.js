(function () {
  const STORAGE_KEY = "hotwheel-mario-kart-state-v3";
  const LEGACY_STORAGE_KEYS = ["hotwheel-mario-kart-state-v2"];
  const INITIAL_RATING = 1500;
  const K_FACTOR = 24;
  const LANES = [1, 2, 3, 4, 5];
  const REPOSITORY_SAVE_PATH = "./data/save-state.json";

  const dataset = window.HOT_WHEELS_COLLECTION || { entries: [], sourceUrl: "" };
  const baseEntries = dataset.entries || [];
  const baseMap = Object.fromEntries(baseEntries.map((entry) => [entry.id, entry]));

  let activeTab = "home";
  let collectionFilters = {
    character: [],
    vehicle: [],
    tires: [],
    glider: [],
    collected: [],
  };
  let state = loadState();
  let repositoryFileHandle = null;

  function baseState() {
    return {
      collection: {},
      ratings: Object.fromEntries(baseEntries.map((entry) => [entry.id, INITIAL_RATING])),
      activeTournament: null,
      historicalEvents: [],
      _meta: {
        updatedAt: null,
      },
    };
  }

  function normalizeState(candidate) {
    const fallback = baseState();
    return {
      collection: candidate?.collection || {},
      ratings: { ...fallback.ratings, ...(candidate?.ratings || {}) },
      activeTournament: candidate?.activeTournament || null,
      historicalEvents: candidate?.historicalEvents || [],
      _meta: {
        updatedAt: candidate?._meta?.updatedAt || null,
      },
    };
  }

  function loadState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      for (const legacyKey of LEGACY_STORAGE_KEYS) {
        const legacyRaw = localStorage.getItem(legacyKey);
        if (!legacyRaw) continue;
        try {
          const migrated = normalizeState(JSON.parse(legacyRaw));
          localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
          return migrated;
        } catch (error) {
          console.error(`Failed to migrate legacy state from ${legacyKey}`, error);
        }
      }
      return baseState();
    }
    try {
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      console.error(error);
      return baseState();
    }
  }

  function saveState(options = {}) {
    if (options.touch !== false) {
      state._meta.updatedAt = new Date().toISOString();
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function ratingOf(id) {
    return state.ratings[id] ?? INITIAL_RATING;
  }

  function allEntries() {
    return baseEntries.map((entry) => {
      const saved = state.collection[entry.id] || {};
      const status = saved.status || (saved.collected ? "collected" : "uncollected");
      return {
        ...entry,
        status,
        collected: status === "collected",
        planned: status === "planned",
        collectedAt: saved.collectedAt || "",
        collectionNote: saved.collectionNote || "",
        rating: ratingOf(entry.id),
      };
    });
  }

  function entryById(id) {
    return allEntries().find((entry) => entry.id === id) || baseMap[id];
  }

  function collectedEntries() {
    return allEntries().filter((entry) => entry.collected);
  }

  function plannedEntries() {
    return allEntries().filter((entry) => entry.planned);
  }

  function sortByRating(list) {
    return [...list].sort((a, b) => b.rating - a.rating || a.character.localeCompare(b.character, "zh-CN"));
  }

  function sourceOrderedEntries() {
    const merged = allEntries();
    const orderMap = Object.fromEntries(baseEntries.map((entry, index) => [entry.id, index]));
    return [...merged].sort((a, b) => orderMap[a.id] - orderMap[b.id]);
  }

  function uniqueOptions(key) {
    const values = sourceOrderedEntries()
      .map((entry) => {
        if (key === "glider") return entry.glider || "无";
        if (key === "collected") {
          if (entry.planned) return "计划收集";
          return entry.collected ? "已收藏" : "未收藏";
        }
        return entry[key] || "";
      })
      .filter(Boolean);
    return [...new Set(values)];
  }

  function matchesMultiFilter(selectedValues, actualValue) {
    if (!selectedValues.length) return true;
    return selectedValues.includes(actualValue);
  }

  function exportStateToFile() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `hotwheel-data-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importStateFromText(text) {
    state = normalizeState(JSON.parse(text));
    saveState({ touch: false });
    render();
  }

  function timestampOf(value) {
    return value ? new Date(value).getTime() : 0;
  }

  function hasMeaningfulState(candidate) {
    return (
      Object.keys(candidate.collection || {}).length > 0 ||
      (candidate.historicalEvents || []).length > 0 ||
      candidate.activeTournament !== null ||
      Object.values(candidate.ratings || {}).some((value) => value !== INITIAL_RATING)
    );
  }

  async function fetchRepositoryState() {
    const response = await fetch(REPOSITORY_SAVE_PATH, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`无法读取仓库存档：${response.status}`);
    }
    return normalizeState(await response.json());
  }

  async function loadRepositoryState(preferNewer = true) {
    const repoState = await fetchRepositoryState();
    const hasRepositoryData = hasMeaningfulState(repoState);
    if (!hasRepositoryData) {
      return false;
    }
    const localHasData = hasMeaningfulState(state);
    if (!localHasData) {
      state = repoState;
      saveState({ touch: false });
      render();
      return true;
    }
    if (preferNewer) {
      const localTs = timestampOf(state._meta.updatedAt);
      const repoTs = timestampOf(repoState._meta.updatedAt);
      if (repoTs < localTs) {
        return false;
      }
    }
    state = repoState;
    saveState({ touch: false });
    render();
    return true;
  }

  async function saveRepositoryStateToFile() {
    const content = `${JSON.stringify(state, null, 2)}\n`;
    if ("showSaveFilePicker" in window) {
      if (!repositoryFileHandle) {
        repositoryFileHandle = await window.showSaveFilePicker({
          suggestedName: "save-state.json",
          types: [
            {
              description: "JSON",
              accept: { "application/json": [".json"] },
            },
          ],
        });
      }
      const writable = await repositoryFileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      return "已写入本地 save-state.json，请继续 git add / commit / push。";
    }

    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "save-state.json";
    link.click();
    URL.revokeObjectURL(url);
    return "浏览器不支持直接覆盖文件，已下载 save-state.json，请手动替换到 data 目录后再 git push。";
  }

  function vehicleVisual(entry) {
    return `
      <div class="vehicle-visual">
        <span class="vehicle-thumb small">${entry.characterImage ? `<img src="./${entry.characterImage}" alt="${entry.character}" />` : "角"}</span>
        <span class="vehicle-thumb small">${entry.vehicleImage ? `<img src="./${entry.vehicleImage}" alt="${entry.vehicle}" />` : "车"}</span>
        <span class="vehicle-thumb small">${entry.tireImage ? `<img src="./${entry.tireImage}" alt="${entry.tires}" />` : "胎"}</span>
        ${entry.gliderImage ? `<span class="vehicle-thumb small"><img src="./${entry.gliderImage}" alt="${entry.glider}" /></span>` : '<span class="vehicle-thumb small empty-slot"></span>'}
      </div>
    `;
  }

  function formatDateTime(value) {
    if (!value) return "未设置";
    return new Date(value).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatDateOnly(value) {
    return value || "未设置";
  }

  function formatScore(value) {
    return Number(value || 0).toFixed(3);
  }

  function formatRating(value) {
    return Math.round(value || 0);
  }

  function calculateRounds(count) {
    if (count <= 20) return 5;
    return 5 + Math.ceil((count - 20) / 5);
  }

  function heatSizes(count) {
    for (let fourCount = 0; fourCount <= 5; fourCount += 1) {
      const remainder = count - fourCount * 4;
      if (remainder >= 0 && remainder % 5 === 0) {
        return [...Array(remainder / 5).fill(5), ...Array(fourCount).fill(4)];
      }
    }
    if (count >= 4) return [count];
    throw new Error("至少需要 4 辆车才能开始比赛。");
  }

  function shuffle(list) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function standingsFor(event, useCurrentRatings = true) {
    return event.participantIds
      .map((id) => {
        const standing = event.standings[id];
        const entry = entryById(id);
        return {
          id,
          entry,
          seed: standing.seed,
          eventPoints: standing.eventPoints,
          lastRoundScore: standing.lastRoundScore,
          laneCounts: standing.laneCounts,
          heats: standing.heats,
          rating: useCurrentRatings ? ratingOf(id) : standing.lastKnownRating ?? ratingOf(id),
        };
      })
      .sort((a, b) =>
        b.eventPoints - a.eventPoints ||
        b.lastRoundScore - a.lastRoundScore ||
        b.rating - a.rating ||
        a.seed - b.seed
      );
  }

  function matchupCounts(event) {
    const map = {};
    event.rounds.forEach((round) => {
      round.heats.forEach((heat) => {
        const ids = heat.assignments.map((item) => item.carId);
        ids.forEach((id, index) => {
          for (let next = index + 1; next < ids.length; next += 1) {
            const other = ids[next];
            const key = [id, other].sort().join("::");
            map[key] = (map[key] || 0) + 1;
          }
        });
      });
    });
    return map;
  }

  function laneUsage(event) {
    const usage = {};
    event.participantIds.forEach((id) => {
      usage[id] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, lastLane: null };
    });
    event.rounds.forEach((round) => {
      round.heats.forEach((heat) => {
        heat.assignments.forEach((assignment) => {
          usage[assignment.carId][assignment.lane] += 1;
          usage[assignment.carId].lastLane = assignment.lane;
        });
      });
    });
    return usage;
  }

  function chooseHeat(sortedIds, remainingIds, size, matchupMap) {
    const heat = [];
    const pool = [...remainingIds];
    while (heat.length < size) {
      let bestIndex = 0;
      let bestScore = Number.POSITIVE_INFINITY;
      for (let i = 0; i < pool.length; i += 1) {
        const id = pool[i];
        const repeatPenalty = heat.reduce((sum, current) => {
          const key = [id, current].sort().join("::");
          return sum + (matchupMap[key] || 0);
        }, 0);
        const seedPenalty = sortedIds.indexOf(id);
        const score = repeatPenalty * 100 + seedPenalty;
        if (score < bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }
      heat.push(pool.splice(bestIndex, 1)[0]);
    }
    return {
      heat,
      remaining: remainingIds.filter((id) => !heat.includes(id)),
    };
  }

  function lanePermutations(length) {
    const results = [];
    function visit(current, remaining) {
      if (current.length === length) {
        results.push(current);
        return;
      }
      remaining.forEach((lane, index) => {
        visit([...current, lane], remaining.filter((_, inner) => inner !== index));
      });
    }
    visit([], LANES);
    return results;
  }

  function assignLanes(carIds, event) {
    const usage = laneUsage(event);
    const perms = lanePermutations(carIds.length);
    let best = perms[0];
    let bestScore = Number.POSITIVE_INFINITY;
    perms.forEach((perm) => {
      const score = perm.reduce((sum, lane, index) => {
        const stats = usage[carIds[index]];
        return sum + stats[lane] * 10 + (stats.lastLane === lane ? 4 : 0);
      }, 0);
      if (score < bestScore) {
        best = perm;
        bestScore = score;
      }
    });
    return carIds
      .map((carId, index) => ({ lane: best[index], carId }))
      .sort((a, b) => a.lane - b.lane);
  }

  function appendRound(event) {
    const sortedIds = event.rounds.length === 0
      ? shuffle([...event.participantIds])
      : standingsFor(event).map((item) => item.id);
    const sizes = heatSizes(sortedIds.length);
    const matches = matchupCounts(event);
    let remaining = [...sortedIds];
    const heats = sizes.map((size, index) => {
      const selected = chooseHeat(sortedIds, remaining, size, matches);
      remaining = selected.remaining;
      return {
        id: `round-${event.rounds.length + 1}-heat-${index + 1}`,
        heatNumber: index + 1,
        assignments: assignLanes(selected.heat, event),
        result: null,
      };
    });
    event.rounds.push({ number: event.rounds.length + 1, heats });
  }

  function createTournament(name, participantIds) {
    const event = {
      id: `event-${Date.now()}`,
      name,
      createdAt: new Date().toISOString(),
      completedAt: null,
      participantIds,
      totalRounds: calculateRounds(participantIds.length),
      rounds: [],
      standings: Object.fromEntries(
        participantIds.map((id, index) => [
          id,
          {
            seed: index + 1,
            eventPoints: 0,
            lastRoundScore: 0,
            laneCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
            heats: [],
            lastKnownRating: ratingOf(id),
          },
        ])
      ),
      undoStack: [],
    };
    appendRound(event);
    return event;
  }

  function locateHeat(event, heatId) {
    for (const round of event.rounds) {
      const heat = round.heats.find((item) => item.id === heatId);
      if (heat) return { round, heat };
    }
    return null;
  }

  function beatProbability(a, b) {
    return 1 / (1 + 10 ** ((b - a) / 400));
  }

  function resolveHeatResults(heat, values) {
    const finished = [];
    const dnf = [];
    const seen = new Set();
    const errors = [];

    heat.assignments.forEach((assignment) => {
      const raw = values[String(assignment.lane)];
      if (!raw) {
        errors.push(`第 ${assignment.lane} 道还没有录入结果。`);
        return;
      }
      if (raw === "DNF") {
        dnf.push({ ...assignment, result: "DNF" });
        return;
      }
      const place = Number(raw);
      if (!Number.isInteger(place)) {
        errors.push(`第 ${assignment.lane} 道的名次不是有效整数。`);
        return;
      }
      if (seen.has(place)) {
        errors.push(`名次 ${place} 被重复录入了。`);
        return;
      }
      seen.add(place);
      finished.push({ ...assignment, result: place });
    });

    if (errors.length) throw new Error(errors.join("\n"));
    if (!finished.length) throw new Error("至少要有 1 辆完赛车辆，不能全部录入为 DNF。");

    finished.sort((a, b) => a.result - b.result);
    finished.forEach((item, index) => {
      if (item.result !== index + 1) {
        errors.push(`完赛车辆名次必须连续为 1 到 ${finished.length}，当前录入不符合规则。`);
      }
    });

    const maxPlace = Math.max(...finished.map((item) => item.result));
    if (maxPlace !== finished.length) {
      errors.push(`当前共有 ${finished.length} 辆完赛，但最大名次写成了 ${maxPlace}。`);
    }

    if (errors.length) throw new Error(errors.join("\n"));

    dnf.sort((a, b) => a.lane - b.lane);
    return [...finished, ...dnf].map((item, index) => ({ ...item, rank: index + 1 }));
  }

  function syncHistory() {
    if (!state.activeTournament) return;
    const copy = clone(state.activeTournament);
    const index = state.historicalEvents.findIndex((item) => item.id === copy.id);
    if (index >= 0) state.historicalEvents[index] = copy;
    else state.historicalEvents.unshift(copy);
  }

  function submitHeat(heatId, values) {
    const event = state.activeTournament;
    if (!event) return;
    const located = locateHeat(event, heatId);
    if (!located) return;
    const { round, heat } = located;
    if (heat.result) {
      alert("这个 heat 已经录入过了。请先撤回最近一次录入。");
      return;
    }

    const snapshot = {
      tournament: clone(event),
      ratings: clone(state.ratings),
    };

    const ranking = resolveHeatResults(heat, values);
    const ids = heat.assignments.map((item) => item.carId);
    const before = Object.fromEntries(ids.map((id) => [id, ratingOf(id)]));
    const scores = {};
    const expected = {};
    const deltas = {};

    ranking.forEach((item) => {
      scores[item.carId] = (ranking.length - item.rank) / (ranking.length - 1);
    });

    ids.forEach((id) => {
      const opponents = ids.filter((other) => other !== id);
      expected[id] = opponents.reduce((sum, other) => sum + beatProbability(before[id], before[other]), 0) / opponents.length;
      deltas[id] = K_FACTOR * (scores[id] - expected[id]);
    });

    ids.forEach((id) => {
      state.ratings[id] = before[id] + deltas[id];
      const standing = event.standings[id];
      const result = ranking.find((item) => item.carId === id);
      standing.eventPoints += scores[id];
      standing.lastRoundScore = scores[id];
      standing.lastKnownRating = state.ratings[id];
      standing.heats.push({
        roundNumber: round.number,
        heatId: heat.id,
        rank: result.rank,
        result: result.result,
        actualScore: scores[id],
        expectedScore: expected[id],
        ratingBefore: before[id],
        ratingAfter: state.ratings[id],
        delta: deltas[id],
      });
    });

    heat.assignments.forEach((assignment) => {
      event.standings[assignment.carId].laneCounts[assignment.lane] += 1;
    });

    heat.result = {
      submittedAt: new Date().toISOString(),
      ranking,
      scores,
      expected,
      deltas,
      ratingsBefore: before,
    };

    event.undoStack.push(snapshot);
    const roundFinished = round.heats.every((item) => item.result);
    const eventFinished = roundFinished && round.number >= event.totalRounds;
    if (roundFinished && !eventFinished) appendRound(event);
    if (eventFinished) event.completedAt = new Date().toISOString();

    syncHistory();
    saveState();
    render();
  }

  function undoLastHeat() {
    const event = state.activeTournament;
    if (!event || !event.undoStack.length) {
      alert("当前锦标赛没有可撤回的录入。");
      return;
    }
    const snapshot = event.undoStack[event.undoStack.length - 1];
    state.activeTournament = snapshot.tournament;
    state.ratings = snapshot.ratings;
    syncHistory();
    saveState();
    render();
  }

  function resetRatings() {
    if (!window.confirm("确认把全部等级分恢复为 1500 吗？")) return;
    state.ratings = Object.fromEntries(baseEntries.map((entry) => [entry.id, INITIAL_RATING]));
    if (state.activeTournament) state.activeTournament.undoStack = [];
    saveState();
    render();
  }

  function clearHistory() {
    if (!window.confirm("确认清空当前锦标赛和全部历史记录吗？")) return;
    state.activeTournament = null;
    state.historicalEvents = [];
    saveState();
    render();
  }

  function saveCollection(id, payload) {
    state.collection[id] = {
      ...(state.collection[id] || {}),
      ...payload,
    };
    saveState();
    render();
  }

  function compactStats() {
    const list = allEntries();
    const collected = list.filter((item) => item.collected);
    const planned = list.filter((item) => item.planned);
    const gliderCount = collected.filter((item) => item.type === "glider").length;
    return [
      ["总条目", list.length],
      ["已收藏", collected.length],
      ["计划收集", planned.length],
      ["滑翔伞车型", gliderCount],
      ["当前赛事", state.activeTournament ? state.activeTournament.name : "未开始"],
    ];
  }

  function renderHero() {
    document.getElementById("hero-stats").innerHTML = compactStats()
      .map(([label, value]) => `
        <article class="stat-card compact">
          <div class="stat-label">${label}</div>
          <div class="stat-value smallish">${value}</div>
        </article>
      `)
      .join("");
  }

  function cardMedia(entry) {
    return `
      <div class="avatar-stack">
        <span class="avatar">${entry.characterImage ? `<img src="./${entry.characterImage}" alt="${entry.character}" />` : entry.character.slice(0, 1)}</span>
        <span class="vehicle-thumb">${entry.vehicleImage ? `<img src="./${entry.vehicleImage}" alt="${entry.vehicle}" />` : "车"}</span>
        <span class="vehicle-thumb">${entry.tireImage ? `<img src="./${entry.tireImage}" alt="${entry.tires}" />` : "胎"}</span>
        ${entry.glider ? `<span class="vehicle-thumb">${entry.gliderImage ? `<img src="./${entry.gliderImage}" alt="${entry.glider}" />` : "伞"}</span>` : ""}
      </div>
    `;
  }

  function renderHome() {
    const tab = document.getElementById("tab-home");
    const planned = sortByRating(plannedEntries());
    const collected = sortByRating(collectedEntries());
    if (!planned.length && !collected.length) {
      tab.innerHTML = `<div class="empty"><p>主页显示计划收集和已收藏车辆。先去收藏库保存几辆车吧。</p></div>`;
      return;
    }
    tab.innerHTML = `
      <div class="section-title">
        <div>
          <h2>主页总览</h2>
          <p class="muted">纯 GitHub Pages 版本，数据保存在当前浏览器；如需在手机和电脑间同步，请使用导出 / 导入 JSON。</p>
        </div>
      </div>
      ${planned.length ? `<div class="section-title" style="margin-top:8px"><div><h3>计划收集</h3><p class="muted">这些车辆高亮置顶，但不会进入比赛和成绩区。</p></div></div><div class="car-grid planned-row">${planned.map((entry) => `<article class="car-card planned-card"><div class="car-top">${cardMedia(entry)}<div><h3>${entry.character}</h3><div class="muted">${entry.vehicle}${entry.glider ? ` + ${entry.glider}` : ""}</div></div></div><div class="tags"><span class="tag collected">计划收集</span><span class="tag">等级分 ${formatRating(entry.rating)}</span></div><div class="muted small">${entry.collectionNote || "暂无收藏备注"}</div></article>`).join("")}</div>` : ""}
      ${collected.length ? `<div class="section-title" style="margin-top:22px"><div><h3>已收藏</h3><p class="muted">这些车辆可进入比赛区和成绩区。</p></div></div><div class="car-grid">${collected.slice(0, 12).map((entry) => `<article class="car-card"><div class="car-top">${cardMedia(entry)}<div><h3>${entry.character}</h3><div class="muted">${entry.vehicle}${entry.glider ? ` + ${entry.glider}` : ""}</div></div></div><div class="tags"><span class="tag collected">${entry.type === "glider" ? "滑翔伞车型" : "普通车型"}</span><span class="tag">等级分 ${formatRating(entry.rating)}</span><span class="tag">收藏于 ${formatDateOnly(entry.collectedAt)}</span></div><div class="muted small">${entry.collectionNote || "暂无收藏备注"}</div></article>`).join("")}</div>` : ""}
    `;
  }

  function renderCollection() {
    const entries = sourceOrderedEntries().filter((entry) => {
      const characterOk = matchesMultiFilter(collectionFilters.character, entry.character);
      const vehicleOk = matchesMultiFilter(collectionFilters.vehicle, entry.vehicle);
      const tiresOk = matchesMultiFilter(collectionFilters.tires, entry.tires);
      const gliderOk = matchesMultiFilter(collectionFilters.glider, entry.glider || "无");
      const collectedLabel = entry.planned ? "计划收集" : entry.collected ? "已收藏" : "未收藏";
      const collectedOk = matchesMultiFilter(collectionFilters.collected, collectedLabel);
      return characterOk && vehicleOk && tiresOk && gliderOk && collectedOk;
    });
    const renderFilterGroup = (key, placeholder) => `<details class="filter-details"><summary>${placeholder}</summary><div class="filter-actions"><button type="button" class="secondary-btn compact-btn" data-action="filter-all" data-filter-key="${key}">全选</button><button type="button" class="secondary-btn compact-btn" data-action="filter-none" data-filter-key="${key}">全不选</button></div><div class="checkbox-filter">${uniqueOptions(key).map((option) => `<label class="checkbox-chip"><input type="checkbox" data-filter-checkbox="${key}" value="${option}" ${collectionFilters[key].includes(option) ? "checked" : ""} /><span>${option}</span></label>`).join("")}</div></details>`;
    document.getElementById("tab-collection").innerHTML = `<div class="section-title"><div><h2>收藏数据库</h2><p class="muted">数据保存在本地浏览器。你可以在“等级分与历史”页导出或导入 JSON 进行手动同步。</p></div><div class="toolbar"><button class="secondary-btn" data-action="clear-filters">清空筛选</button></div></div><div class="table-wrap collection-table-wrap"><table class="standings-table collection-table"><thead><tr><th>选手</th><th>车辆</th><th>滑翔伞</th><th>等级分</th><th>收集状态</th><th>收藏时间</th><th>收藏备注</th><th>保存</th><th>发售信息</th></tr><tr class="filter-row"><th>${renderFilterGroup("character", "筛选选手")}</th><th><div class="filter-stack">${renderFilterGroup("vehicle", "筛选车架")}${renderFilterGroup("tires", "筛选轮胎")}</div></th><th>${renderFilterGroup("glider", "筛选滑翔伞")}</th><th></th><th>${renderFilterGroup("collected", "筛选收藏状态")}</th><th></th><th></th><th></th><th></th></tr></thead><tbody>${entries.map((entry) => `<tr><td><div class="table-entity name-cell"><span class="avatar small">${entry.characterImage ? `<img src="./${entry.characterImage}" alt="${entry.character}" />` : entry.character.slice(0, 1)}</span><div><div class="name-line">${entry.character}</div><div class="muted small">${entry.code || "无代码"}</div></div></div></td><td><div class="table-entity vehicle-cell"><div>${vehicleVisual(entry)}</div><div><div>${entry.vehicle}</div><div class="muted small">${entry.tires}</div></div></div></td><td>${entry.glider || "无"}</td><td>${formatRating(entry.rating)}</td><td><select name="collected" form="collection-form-${entry.id}"><option value="uncollected" ${entry.status === "uncollected" ? "selected" : ""}>未收藏</option><option value="planned" ${entry.status === "planned" ? "selected" : ""}>计划收集</option><option value="collected" ${entry.status === "collected" ? "selected" : ""}>已收藏</option></select></td><td><input type="date" name="collectedAt" form="collection-form-${entry.id}" value="${entry.collectedAt || ""}" /></td><td><input type="text" name="collectionNote" form="collection-form-${entry.id}" value="${entry.collectionNote || ""}" placeholder="备注" /></td><td><form id="collection-form-${entry.id}" data-action="save-collection" data-entry-id="${entry.id}"><button type="submit" class="accent-btn compact-btn">保存</button></form></td><td><details class="meta-detail compact-detail"><summary>查看</summary><div class="detail-grid"><div><strong>首发：</strong>${entry.firstAppearance || "-"}</div><div><strong>复刻：</strong>${entry.otherAppearances || "-"}</div></div></details></td></tr>`).join("")}</tbody></table></div>`;
  }

  function creationForm() {
    const collected = collectedEntries();
    const rounds = collected.length >= 4 ? calculateRounds(collected.length) : 0;
    return `<form class="control-card" data-action="create-tournament-form"><h3>新建锦标赛</h3><p class="muted">默认使用全部已收藏车辆参赛。只有在你需要精细选择时，再展开参赛名单。</p><div class="form-grid"><label>赛事名称<input type="text" name="name" value="马里奥卡丁车收藏赛 ${new Date().toLocaleDateString("zh-CN")}" /></label><label>已收藏数量<input type="text" value="${collected.length} 辆" disabled /></label><label>推荐轮数<input type="text" value="${rounds ? `${rounds} 轮` : "至少 4 辆"}" disabled /></label></div><details class="participant-picker"><summary>展开精细选择参赛车辆</summary><div class="participant-actions"><button type="button" class="secondary-btn compact-btn" data-action="participants-all">全选</button><button type="button" class="secondary-btn compact-btn" data-action="participants-none">全不选</button></div><div class="pick-list">${collected.length ? collected.map((entry) => `<label class="pick-item"><input type="checkbox" name="participant" value="${entry.id}" checked /><span>${entry.character} / ${entry.vehicle}${entry.glider ? ` / ${entry.glider}` : ""}</span></label>`).join("") : '<div class="muted">当前没有已收藏车辆。</div>'}</div></details><div class="toolbar"><button type="submit" class="primary-btn" ${collected.length < 4 ? "disabled" : ""}>开始比赛</button></div></form>`;
  }

  function heatCard(roundNumber, heat) {
    return `<article class="heat-card"><div class="section-title"><div><h3>第 ${roundNumber} 轮 Heat ${heat.heatNumber}</h3><p class="muted">${heat.assignments.length} 车，显示每一道对应的选手。</p></div><span class="status-pill">${heat.result ? "已录入" : "待录入"}</span></div><form data-action="submit-heat" data-heat-id="${heat.id}"><table class="lane-table"><thead><tr><th>赛道</th><th>选手</th><th>车辆</th><th>录入</th></tr></thead><tbody>${heat.assignments.map((assignment) => { const entry = entryById(assignment.carId); const existing = heat.result ? heat.result.ranking.find((item) => item.carId === assignment.carId) : null; return `<tr><td><span class="lane-badge">${assignment.lane}</span></td><td>${entry.character}</td><td><div class="table-entity vehicle-cell"><div>${vehicleVisual(entry)}</div><div class="muted small">${entry.character} / ${entry.vehicle} / ${entry.tires}${entry.glider ? ` / ${entry.glider}` : ""}</div></div></td><td>${heat.result ? `<span class="status-pill">${existing.result === "DNF" ? `DNF / 排名 ${existing.rank}` : `第 ${existing.rank} 名`}</span>` : `<select name="lane-${assignment.lane}"><option value="">选择名次</option>${Array.from({ length: heat.assignments.length }, (_, index) => `<option value="${index + 1}">${index + 1}</option>`).join("")}<option value="DNF">DNF</option></select>`}</td></tr>`; }).join("")}</tbody></table>${heat.result ? "" : '<div class="toolbar" style="margin-top:14px"><button type="submit" class="accent-btn">保存本 heat 成绩</button></div>'}</form></article>`;
  }

  function standingsTable(event) {
    return `<div class="table-wrap"><h3 style="margin-bottom:12px">当前赛事积分榜</h3><table class="standings-table"><thead><tr><th>排名</th><th>选手</th><th>车辆</th><th>赛事积分</th><th>等级分</th><th>收藏时间</th><th>车道分布</th></tr></thead><tbody>${standingsFor(event).map((item, index) => `<tr><td>${index + 1}</td><td>${item.entry.character}</td><td><div class="table-entity vehicle-cell"><div>${vehicleVisual(item.entry)}</div><div class="muted small">${item.entry.vehicle} / ${item.entry.tires}${item.entry.glider ? ` / ${item.entry.glider}` : ""}</div></div></td><td>${formatScore(item.eventPoints)}</td><td>${formatRating(item.rating)}</td><td>${formatDateOnly(item.entry.collectedAt)}</td><td>L1:${item.laneCounts[1]} L2:${item.laneCounts[2]} L3:${item.laneCounts[3]} L4:${item.laneCounts[4]} L5:${item.laneCounts[5]}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function podium(event) {
    if (!event.completedAt) return `<div class="empty"><p>赛事完成后会在这里显示前三名颁奖页。</p></div>`;
    const top = standingsFor(event).slice(0, 3);
    return `<div class="section-title" style="margin-top:22px"><div><h3>颁奖台</h3><p class="muted">按赛事积分决出前三名。</p></div></div><div class="podium-stage">${[1, 0, 2].map((positionIndex) => { const item = top[positionIndex]; const klass = positionIndex === 0 ? "first" : positionIndex === 1 ? "second" : "third"; const number = positionIndex === 0 ? 1 : positionIndex === 1 ? 2 : 3; if (!item) return "<div></div>"; return `<article class="podium-slot ${klass}"><div class="podium-figure"><span class="podium-avatar">${item.entry.characterImage ? `<img src="./${item.entry.characterImage}" alt="${item.entry.character}" />` : item.entry.character}</span><div class="podium-parts"><span class="vehicle-thumb">${item.entry.vehicleImage ? `<img src="./${item.entry.vehicleImage}" alt="${item.entry.vehicle}" />` : ""}</span><span class="vehicle-thumb">${item.entry.tireImage ? `<img src="./${item.entry.tireImage}" alt="${item.entry.tires}" />` : ""}</span>${item.entry.gliderImage ? `<span class="vehicle-thumb"><img src="./${item.entry.gliderImage}" alt="${item.entry.glider}" /></span>` : '<span class="vehicle-thumb empty-slot"></span>'}</div></div><div class="podium-block"><div class="podium-number">${number}</div><div class="podium-name">${item.entry.character}</div></div></article>`; }).join("")}</div>`;
  }

  function renderTournament() {
    const tab = document.getElementById("tab-tournament");
    const event = state.activeTournament;
    if (!event) {
      tab.innerHTML = `<div class="grid two">${creationForm()}<div class="mini-card"><h3>赛事说明</h3><p class="muted">首轮随机，之后按赛事积分重排。优先 5 车 heat，余数优先拆成两个 4 车 heat，避免 3 车 heat。</p><p class="muted">每个 heat 录入后即时更新赛事积分和全局等级分，支持撤回最近一次录入。</p></div></div>`;
      return;
    }
    const flattenedHeats = event.rounds.flatMap((round) => round.heats.map((heat) => ({ roundNumber: round.number, heat })));
    const currentFlat = [...flattenedHeats].reverse().find((item) => !item.heat.result) || flattenedHeats[flattenedHeats.length - 1];
    const currentIndex = flattenedHeats.findIndex((item) => item.heat.id === currentFlat.heat.id);
    const previousFlat = currentIndex > 0 ? flattenedHeats[currentIndex - 1] : null;
    const mainHeats = [previousFlat, currentFlat].filter(Boolean);
    const archivedHeats = flattenedHeats.filter((item) => !mainHeats.some((main) => main.heat.id === item.heat.id));
    tab.innerHTML = `<div class="grid two"><div class="control-card"><div class="section-title"><div><h2>${event.name}</h2><p class="muted">创建于 ${formatDateTime(event.createdAt)}，共 ${event.participantIds.length} 车，计划 ${event.totalRounds} 轮。</p></div><span class="status-pill">${event.completedAt ? "已完赛" : "进行中"}</span></div><div class="toolbar"><button class="secondary-btn" data-action="undo-last-heat" ${event.undoStack.length ? "" : "disabled"}>撤回最近一次录入</button><button class="secondary-btn" data-action="export-state">导出 JSON</button></div></div>${creationForm()}</div><div class="section-title" style="margin-top:22px"><div><h3>当前比赛区</h3><p class="muted">主界面只保留上一个 heat 和当前 heat，其他内容收纳到历史折叠区。</p></div></div><div class="heat-grid">${mainHeats.map((item, index) => `<div><div class="section-title" style="margin:12px 0"><div><h3>${index === mainHeats.length - 1 ? "当前 Heat" : "上一个 Heat"}</h3><p class="muted">第 ${item.roundNumber} 轮 Heat ${item.heat.heatNumber}</p></div></div>${heatCard(item.roundNumber, item.heat)}</div>`).join("")}</div>${archivedHeats.length ? `<details class="history-heats-panel" style="margin-top:22px"><summary>展开查看更早的 heat 历史</summary><div class="history-heats-scroll">${archivedHeats.map((item) => `<div class="history-heat-item"><div class="section-title" style="margin:0 0 10px"><div><h3>第 ${item.roundNumber} 轮 Heat ${item.heat.heatNumber}</h3><p class="muted">${item.heat.result ? "已录入" : "未录入"}</p></div></div>${heatCard(item.roundNumber, item.heat)}</div>`).join("")}</div></details>` : ""}<div style="margin-top:22px">${standingsTable(event)}</div>${podium(event)}`;
  }

  function renderRatings() {
    const tab = document.getElementById("tab-ratings");
    const collected = sortByRating(collectedEntries());
    const history = state.historicalEvents;
    tab.innerHTML = `<div class="grid two"><div class="control-card"><h2>收藏车辆等级分榜</h2><p class="muted">这里只显示已收藏车辆。计划收集不会出现在这里。</p><div class="table-wrap" style="margin-top:14px"><table class="standings-table"><thead><tr><th>排名</th><th>选手</th><th>车辆</th><th>等级分</th><th>收藏时间</th></tr></thead><tbody>${collected.map((entry, index) => `<tr><td>${index + 1}</td><td>${entry.character}</td><td><div class="table-entity vehicle-cell"><div>${vehicleVisual(entry)}</div><div class="muted small">${entry.vehicle} / ${entry.tires}${entry.glider ? ` / ${entry.glider}` : ""}</div></div></td><td>${formatRating(entry.rating)}</td><td>${formatDateOnly(entry.collectedAt)}</td></tr>`).join("")}</tbody></table></div></div><div class="control-card"><h2>数据工具</h2><p class="muted">仓库存档模式：启动时读取 <code>data/save-state.json</code>。电脑上保存为仓库存档后，再手动 git push，手机刷新即可看到进度。</p><div class="toolbar" style="margin-top:14px"><button class="secondary-btn" data-action="load-repository-save">从仓库存档恢复</button><button class="secondary-btn" data-action="save-repository-save">保存为仓库存档</button><button class="secondary-btn" data-action="export-state">导出全部数据</button><button class="secondary-btn" data-action="trigger-import">导入 JSON</button><button class="secondary-btn" data-action="reset-ratings">等级分恢复 1500</button><button class="danger-btn" data-action="clear-history">一键清除历史</button></div><input id="import-json-input" type="file" accept="application/json,.json" hidden /></div></div><div class="section-title" style="margin-top:22px"><div><h3>赛事历史</h3><p class="muted">历史记录也会被一起导出到 JSON。</p></div></div><div class="history-grid">${history.length ? history.map((event) => `<article class="history-card"><h3>${event.name}</h3><p class="muted small">创建 ${formatDateTime(event.createdAt)}${event.completedAt ? `，完赛 ${formatDateTime(event.completedAt)}` : "，尚未完赛"}</p><p class="muted small">参赛 ${event.participantIds.length} 车 / 轮次 ${event.rounds.length} / 计划 ${event.totalRounds}</p><div class="small">${standingsFor(event, false).filter((item) => item.entry.collected).slice(0, 3).map((item, index) => `<div>${index + 1}. ${item.entry.character} / ${item.entry.vehicle}${item.entry.glider ? ` + ${item.entry.glider}` : ""} (${formatScore(item.eventPoints)})</div>`).join("") || "该历史赛事中的车辆当前都未标记为收藏。"}</div></article>`).join("") : '<div class="empty"><p>还没有历史赛事记录。</p></div>'}</div>`;
  }

  function renderTabs() {
    document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("is-active", button.dataset.tab === activeTab));
    document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${activeTab}`));
  }

  function render() {
    renderHero();
    renderHome();
    renderCollection();
    renderTournament();
    renderRatings();
    renderTabs();
  }

  document.addEventListener("click", (event) => {
    const tabButton = event.target.closest(".tab");
    if (tabButton) {
      activeTab = tabButton.dataset.tab;
      renderTabs();
      return;
    }
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    const action = actionButton.dataset.action;
    if (action === "undo-last-heat") undoLastHeat();
    if (action === "export-state") exportStateToFile();
    if (action === "load-repository-save") {
      loadRepositoryState(false).then(() => {
        alert("已从仓库存档读取当前状态。");
      }).catch((error) => {
        alert(`读取仓库存档失败：${error.message}`);
      });
    }
    if (action === "save-repository-save") {
      saveRepositoryStateToFile().then((message) => {
        alert(message);
      }).catch((error) => {
        alert(`保存仓库存档失败：${error.message}`);
      });
    }
    if (action === "reset-ratings") resetRatings();
    if (action === "clear-history") clearHistory();
    if (action === "trigger-import") document.getElementById("import-json-input")?.click();
    if (action === "clear-filters") { collectionFilters = { character: [], vehicle: [], tires: [], glider: [], collected: [] }; renderCollection(); }
    if (action === "filter-all") { const key = actionButton.dataset.filterKey; collectionFilters[key] = uniqueOptions(key); renderCollection(); }
    if (action === "filter-none") { const key = actionButton.dataset.filterKey; collectionFilters[key] = []; renderCollection(); }
    if (action === "participants-all") document.querySelectorAll('input[name="participant"]').forEach((checkbox) => { checkbox.checked = true; });
    if (action === "participants-none") document.querySelectorAll('input[name="participant"]').forEach((checkbox) => { checkbox.checked = false; });
  });

  document.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-filter-checkbox]");
    if (checkbox) {
      const key = checkbox.dataset.filterCheckbox;
      const current = new Set(collectionFilters[key]);
      if (checkbox.checked) current.add(checkbox.value);
      else current.delete(checkbox.value);
      collectionFilters[key] = [...current];
      renderCollection();
      return;
    }
    if (event.target.id === "import-json-input") {
      const file = event.target.files?.[0];
      if (!file) return;
      file.text().then((text) => {
        importStateFromText(text);
        alert("JSON 导入成功。");
      }).catch((error) => {
        alert(`导入失败：${error.message}`);
      }).finally(() => {
        event.target.value = "";
      });
    }
  });

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (form.matches('[data-action="save-collection"]')) {
      event.preventDefault();
      const data = new FormData(form);
      const status = data.get("collected") || "uncollected";
      saveCollection(form.dataset.entryId, {
        status,
        collected: status === "collected",
        collectedAt: data.get("collectedAt") || "",
        collectionNote: data.get("collectionNote") || "",
      });
      return;
    }
    if (form.matches('[data-action="create-tournament-form"]')) {
      event.preventDefault();
      const data = new FormData(form);
      const participantIds = data.getAll("participant");
      if (participantIds.length < 4) {
        alert("至少选择 4 辆已收藏车辆。");
        return;
      }
      if (state.activeTournament && !window.confirm("当前已有一场锦标赛，确认用新赛事覆盖它吗？")) return;
      const name = (data.get("name") || "").toString().trim() || `马里奥卡丁车收藏赛 ${new Date().toLocaleDateString("zh-CN")}`;
      state.activeTournament = createTournament(name, participantIds);
      syncHistory();
      saveState();
      activeTab = "tournament";
      render();
      return;
    }
    if (form.matches('[data-action="submit-heat"]')) {
      event.preventDefault();
      const data = new FormData(form);
      const values = {};
      form.querySelectorAll('select[name^="lane-"]').forEach((select) => { values[select.name.replace("lane-", "")] = data.get(select.name); });
      try {
        submitHeat(form.dataset.heatId, values);
      } catch (error) {
        alert(error.message);
      }
    }
  });

  render();
  loadRepositoryState(true).catch(() => {});
})();

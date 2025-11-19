(function () {
  const STORAGE_KEY = "promptLibrary.prompts.v1";
  const USER_RATINGS_KEY = "promptLibrary.userRatings.v1";
  const NOTES_KEY = "promptLibrary.notes.v1";

  // Metadata tracking functions
  function trackModel(modelName, content) {
    // Validation
    if (!modelName || typeof modelName !== "string") {
      throw new Error("Model name must be a non-empty string");
    }
    if (modelName.length > 100) {
      throw new Error("Model name must be 100 characters or less");
    }
    if (typeof content !== "string") {
      throw new Error("Content must be a string");
    }

    const now = new Date().toISOString();
    const tokenEstimate = estimateTokens(content, false);

    return {
      model: modelName.trim(),
      createdAt: now,
      updatedAt: now,
      tokenEstimate: tokenEstimate,
    };
  }

  function updateTimestamps(metadata) {
    if (!metadata || typeof metadata !== "object") {
      throw new Error("Metadata must be a valid object");
    }
    if (!metadata.createdAt) {
      throw new Error("Metadata must have a createdAt timestamp");
    }

    const now = new Date().toISOString();
    const createdAt = new Date(metadata.createdAt);
    const updatedAt = new Date(now);

    // Validate ISO 8601 format
    if (isNaN(createdAt.getTime())) {
      throw new Error("createdAt must be a valid ISO 8601 timestamp");
    }
    if (updatedAt < createdAt) {
      throw new Error("updatedAt must be greater than or equal to createdAt");
    }

    return {
      ...metadata,
      updatedAt: now,
    };
  }

  function estimateTokens(text, isCode = false) {
    if (typeof text !== "string") {
      throw new Error("Text must be a string");
    }

    const words = text
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0);
    const wordCount = words.length;
    const charCount = text.length;

    // Base calculation
    let minTokens = Math.ceil(0.75 * wordCount);
    let maxTokens = Math.ceil(0.25 * charCount);

    // Code multiplier
    if (isCode) {
      minTokens = Math.ceil(minTokens * 1.3);
      maxTokens = Math.ceil(maxTokens * 1.3);
    }

    // Determine confidence
    const avgTokens = (minTokens + maxTokens) / 2;
    let confidence;
    if (avgTokens < 1000) {
      confidence = "high";
    } else if (avgTokens <= 5000) {
      confidence = "medium";
    } else {
      confidence = "low";
    }

    return {
      min: minTokens,
      max: maxTokens,
      confidence: confidence,
    };
  }

  function formatTimestamp(isoString) {
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now - date;
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) {
        return (
          "Today at " +
          date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        );
      } else if (diffDays === 1) {
        return (
          "Yesterday at " +
          date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        );
      } else if (diffDays < 7) {
        return diffDays + " days ago";
      } else {
        return date.toLocaleDateString([], {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
      }
    } catch {
      return "Invalid date";
    }
  }

  const form = document.getElementById("promptForm");
  const titleInput = document.getElementById("title");
  const contentInput = document.getElementById("content");
  const cardsEl = document.getElementById("cards");
  const countEl = document.getElementById("count");
  const ratingFilterEl = document.getElementById("ratingFilter");
  const sortByEl = document.getElementById("sortBy");

  // Export/Import elements
  const exportBtn = document.getElementById("exportBtn");
  const importBtn = document.getElementById("importBtn");
  const importFileInput = document.getElementById("importFile");

  let userRatings = loadUserRatings();
  let promptNotes = loadNotes();

  // Export/Import Schema Definition
  const EXPORT_VERSION = "1.0.0";
  const EXPORT_COMPATIBLE_VERSIONS = ["1.0.0"];

  // Export/Import Functions
  function calculateExportStatistics(prompts, ratings, notes) {
    const totalPrompts = prompts.length;
    const ratingsArray = prompts
      .map((p) => getUserRating(p.id))
      .filter((r) => r > 0);
    const averageRating =
      ratingsArray.length > 0
        ? ratingsArray.reduce((sum, r) => sum + r, 0) / ratingsArray.length
        : 0;

    const modelCounts = {};
    prompts.forEach((p) => {
      const model = p.metadata?.model || "Unknown";
      modelCounts[model] = (modelCounts[model] || 0) + 1;
    });

    const mostUsedModel =
      Object.entries(modelCounts).sort(([, a], [, b]) => b - a)[0]?.[0] ||
      "None";

    const totalTokensEstimate = prompts.reduce((sum, p) => {
      if (p.metadata?.tokenEstimate) {
        return (
          sum +
          (p.metadata.tokenEstimate.min + p.metadata.tokenEstimate.max) / 2
        );
      }
      return sum;
    }, 0);

    return {
      totalPrompts,
      averageRating: Math.round(averageRating * 100) / 100,
      mostUsedModel,
      totalTokensEstimate: Math.round(totalTokensEstimate),
      promptsWithNotes: Object.keys(notes).length,
      ratedPrompts: ratingsArray.length,
    };
  }

  function validateExportData() {
    const prompts = getPrompts();
    const ratings = loadUserRatings();
    const notes = loadNotes();

    // Validate prompts structure
    if (!Array.isArray(prompts)) {
      throw new Error("Invalid prompts data: not an array");
    }

    prompts.forEach((prompt, index) => {
      if (!prompt.id || !prompt.title || !prompt.content) {
        throw new Error(
          `Invalid prompt at index ${index}: missing required fields`
        );
      }
    });

    // Validate ratings structure
    if (typeof ratings !== "object" || ratings === null) {
      throw new Error("Invalid ratings data: not an object");
    }

    // Validate notes structure
    if (typeof notes !== "object" || notes === null) {
      throw new Error("Invalid notes data: not an object");
    }

    return { prompts, ratings, notes };
  }

  function exportData() {
    try {
      const { prompts, ratings, notes } = validateExportData();
      const statistics = calculateExportStatistics(prompts, ratings, notes);

      const exportData = {
        version: EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        statistics,
        data: {
          prompts,
          userRatings: ratings,
          notes,
        },
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json",
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;

      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, -5);
      link.download = `prompt-library-export-${timestamp}.json`;

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showNotification(
        `Successfully exported ${statistics.totalPrompts} prompts`,
        "success"
      );
    } catch (error) {
      console.error("Export failed:", error);
      showNotification(`Export failed: ${error.message}`, "error");
    }
  }

  function validateImportData(data) {
    if (!data || typeof data !== "object") {
      throw new Error("Invalid file format: not a JSON object");
    }

    if (!data.version) {
      throw new Error("Invalid file format: missing version");
    }

    if (!EXPORT_COMPATIBLE_VERSIONS.includes(data.version)) {
      throw new Error(
        `Incompatible version: ${
          data.version
        }. Compatible versions: ${EXPORT_COMPATIBLE_VERSIONS.join(", ")}`
      );
    }

    if (!data.data || typeof data.data !== "object") {
      throw new Error("Invalid file format: missing or invalid data section");
    }

    const { prompts, userRatings, notes } = data.data;

    if (!Array.isArray(prompts)) {
      throw new Error("Invalid data: prompts must be an array");
    }

    if (typeof userRatings !== "object" || userRatings === null) {
      throw new Error("Invalid data: userRatings must be an object");
    }

    if (typeof notes !== "object" || notes === null) {
      throw new Error("Invalid data: notes must be an object");
    }

    // Validate each prompt
    prompts.forEach((prompt, index) => {
      if (!prompt.id || typeof prompt.id !== "string") {
        throw new Error(
          `Invalid prompt at index ${index}: missing or invalid ID`
        );
      }
      if (!prompt.title || typeof prompt.title !== "string") {
        throw new Error(
          `Invalid prompt at index ${index}: missing or invalid title`
        );
      }
      if (!prompt.content || typeof prompt.content !== "string") {
        throw new Error(
          `Invalid prompt at index ${index}: missing or invalid content`
        );
      }
    });

    return data;
  }

  function createBackup() {
    try {
      return {
        prompts: localStorage.getItem(STORAGE_KEY),
        ratings: localStorage.getItem(USER_RATINGS_KEY),
        notes: localStorage.getItem(NOTES_KEY),
        timestamp: Date.now(),
      };
    } catch (error) {
      throw new Error(`Failed to create backup: ${error.message}`);
    }
  }

  function restoreBackup(backup) {
    try {
      if (backup.prompts !== null) {
        localStorage.setItem(STORAGE_KEY, backup.prompts);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }

      if (backup.ratings !== null) {
        localStorage.setItem(USER_RATINGS_KEY, backup.ratings);
      } else {
        localStorage.removeItem(USER_RATINGS_KEY);
      }

      if (backup.notes !== null) {
        localStorage.setItem(NOTES_KEY, backup.notes);
      } else {
        localStorage.removeItem(NOTES_KEY);
      }

      // Reload data
      userRatings = loadUserRatings();
      promptNotes = loadNotes();
      renderPrompts();
    } catch (error) {
      throw new Error(`Failed to restore backup: ${error.message}`);
    }
  }

  function findDuplicatePrompts(newPrompts, existingPrompts) {
    const existingIds = new Set(existingPrompts.map((p) => p.id));
    return newPrompts.filter((p) => existingIds.has(p.id));
  }

  function showMergeConflictDialog(duplicates, onResolve) {
    const dialog = document.createElement("div");
    dialog.className = "merge-dialog-overlay";
    dialog.innerHTML = `
      <div class="merge-dialog">
        <h3>Import Conflicts Detected</h3>
        <p>Found ${duplicates.length} prompt(s) with IDs that already exist:</p>
        <ul class="conflict-list">
          ${duplicates
            .map((p) => `<li><strong>${p.title}</strong> (ID: ${p.id})</li>`)
            .join("")}
        </ul>
        <p>How would you like to handle these conflicts?</p>
        <div class="merge-actions">
          <button class="btn btn-primary" data-action="replace">
            Replace Existing
          </button>
          <button class="btn btn-secondary" data-action="skip">
            Skip Duplicates
          </button>
          <button class="btn btn-secondary" data-action="rename">
            Rename Imports
          </button>
          <button class="btn btn-danger" data-action="cancel">
            Cancel Import
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    dialog.addEventListener("click", (e) => {
      const action = e.target.dataset.action;
      if (action) {
        document.body.removeChild(dialog);
        onResolve(action);
      }
    });
  }

  function generateNewId() {
    let newId;
    const existingIds = new Set(getPrompts().map((p) => p.id));
    do {
      newId = makeId();
    } while (existingIds.has(newId));
    return newId;
  }

  function processImportData(importData, conflictResolution) {
    const existingPrompts = getPrompts();
    const existingRatings = loadUserRatings();
    const existingNotes = loadNotes();

    const {
      prompts: newPrompts,
      userRatings: newRatings,
      notes: newNotes,
    } = importData.data;
    const duplicates = findDuplicatePrompts(newPrompts, existingPrompts);

    let finalPrompts = [...existingPrompts];
    let finalRatings = { ...existingRatings };
    let finalNotes = { ...existingNotes };

    const duplicateIds = new Set(duplicates.map((p) => p.id));
    const processedIds = new Set(); // Track which IDs we've processed for ratings/notes

    newPrompts.forEach((prompt) => {
      if (duplicateIds.has(prompt.id)) {
        switch (conflictResolution) {
          case "replace":
            // Remove existing and add new
            finalPrompts = finalPrompts.filter((p) => p.id !== prompt.id);
            finalPrompts.unshift(prompt);
            break;
          case "skip":
            // Do nothing, skip this prompt
            return;
          case "rename":
            // Generate new ID and add
            const newId = generateNewId();
            const renamedPrompt = { ...prompt, id: newId };
            finalPrompts.unshift(renamedPrompt);

            // Update ratings and notes with new ID
            if (newRatings[prompt.id] !== undefined) {
              finalRatings[newId] = newRatings[prompt.id];
            }
            if (newNotes[prompt.id] !== undefined) {
              finalNotes[newId] = newNotes[prompt.id];
            }
            processedIds.add(prompt.id);
            return;
        }
      } else {
        // No conflict, just add
        finalPrompts.unshift(prompt);
      }

      // Add ratings and notes for non-conflicting or replaced prompts
      if (newRatings[prompt.id] !== undefined) {
        finalRatings[prompt.id] = newRatings[prompt.id];
      }
      if (newNotes[prompt.id] !== undefined) {
        finalNotes[prompt.id] = newNotes[prompt.id];
      }
      processedIds.add(prompt.id);
    });

    // Import all remaining ratings and notes that weren't processed with prompts
    // This handles cases where notes/ratings exist for prompts not in current export
    Object.keys(newRatings).forEach((id) => {
      if (!processedIds.has(id) && newRatings[id] !== undefined) {
        finalRatings[id] = newRatings[id];
      }
    });

    Object.keys(newNotes).forEach((id) => {
      if (!processedIds.has(id) && newNotes[id] !== undefined) {
        finalNotes[id] = newNotes[id];
      }
    });

    return { finalPrompts, finalRatings, finalNotes };
  }

  function importData(file) {
    const backup = createBackup();

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importData = JSON.parse(e.target.result);
        const validatedData = validateImportData(importData);

        const existingPrompts = getPrompts();
        const duplicates = findDuplicatePrompts(
          validatedData.data.prompts,
          existingPrompts
        );

        const processAndComplete = (conflictResolution) => {
          try {
            const { finalPrompts, finalRatings, finalNotes } =
              processImportData(validatedData, conflictResolution);

            // Save all data
            setPrompts(finalPrompts);
            saveUserRatings(finalRatings);
            saveNotes(finalNotes);

            // Update in-memory data
            userRatings = finalRatings;
            promptNotes = finalNotes;

            // Re-render
            renderPrompts();

            const imported = validatedData.data.prompts.length;
            const skipped =
              conflictResolution === "skip" ? duplicates.length : 0;
            showNotification(
              `Successfully imported ${imported - skipped} prompts` +
                (skipped > 0 ? ` (${skipped} skipped due to conflicts)` : ""),
              "success"
            );
          } catch (error) {
            console.error("Import processing failed:", error);
            restoreBackup(backup);
            showNotification(
              `Import failed during processing: ${error.message}`,
              "error"
            );
          }
        };

        if (duplicates.length > 0) {
          showMergeConflictDialog(duplicates, (action) => {
            if (action === "cancel") {
              showNotification("Import cancelled", "info");
              return;
            }
            processAndComplete(action);
          });
        } else {
          processAndComplete("none");
        }
      } catch (error) {
        console.error("Import failed:", error);
        showNotification(`Import failed: ${error.message}`, "error");
      }
    };

    reader.onerror = () => {
      showNotification("Failed to read file", "error");
    };

    reader.readAsText(file);
  }

  function showNotification(message, type = "info") {
    // Remove any existing notifications
    const existing = document.querySelector(".notification");
    if (existing) {
      existing.remove();
    }

    const notification = document.createElement("div");
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
      <span class="notification-message">${message}</span>
      <button class="notification-close" aria-label="Close notification">×</button>
    `;

    document.body.appendChild(notification);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove();
      }
    }, 5000);

    // Manual close
    notification
      .querySelector(".notification-close")
      .addEventListener("click", () => {
        notification.remove();
      });
  }

  function safeParse(json, fallback) {
    try {
      return JSON.parse(json);
    } catch {
      return fallback;
    }
  }

  function getPrompts() {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = safeParse(raw, []);
    if (!Array.isArray(arr)) return [];
    return arr;
  }

  function setPrompts(arr) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  }

  function loadUserRatings() {
    try {
      const raw = localStorage.getItem(USER_RATINGS_KEY);
      const obj = safeParse(raw, {});
      return obj && typeof obj === "object" ? obj : {};
    } catch {
      return {};
    }
  }

  function saveUserRatings(map) {
    localStorage.setItem(USER_RATINGS_KEY, JSON.stringify(map || {}));
  }

  function loadNotes() {
    try {
      const raw = localStorage.getItem(NOTES_KEY);
      const obj = safeParse(raw, {});
      return obj && typeof obj === "object" ? obj : {};
    } catch {
      return {};
    }
  }

  function saveNotes(notes) {
    try {
      localStorage.setItem(NOTES_KEY, JSON.stringify(notes || {}));
    } catch (e) {
      console.error("Failed to save notes:", e);
    }
  }

  function getNotes(promptId) {
    const notes = promptNotes[promptId];
    return notes && typeof notes === "object" ? notes : null;
  }

  function setNotes(promptId, content) {
    if (!content || content.trim() === "") {
      delete promptNotes[promptId];
    } else {
      promptNotes[promptId] = {
        content: content.trim(),
        lastModified: Date.now(),
        characterCount: content.trim().length,
      };
    }
    saveNotes(promptNotes);
  }

  function getUserRating(id) {
    const v = userRatings[id];
    return typeof v === "number" ? Math.max(0, Math.min(5, v)) : 0;
  }

  function setRating(id, stars) {
    const clamped = Math.max(0, Math.min(5, Number(stars) || 0));
    userRatings[id] = clamped;
    saveUserRatings(userRatings);
    // Re-render to respect filter/sort depending on rating
    renderPrompts();
  }

  function makeId() {
    return (
      Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    ).toUpperCase();
  }

  function createPreview(text) {
    const trimmed = (text || "").trim().replace(/\s+/g, " ");
    if (!trimmed) return "";
    const words = trimmed.split(" ");
    const previewWords = words.slice(0, 12).join(" ");
    return words.length > 12 ? previewWords + "…" : previewWords;
  }

  function getCurrentFilterMin() {
    const val = ratingFilterEl ? Number(ratingFilterEl.value) : 0;
    return Number.isFinite(val) ? val : 0;
  }

  function getCurrentSort() {
    return (sortByEl && sortByEl.value) || "newest";
  }

  function getFilteredSortedPrompts() {
    const prompts = getPrompts();
    const min = getCurrentFilterMin();
    let out = prompts.filter((p) => getUserRating(p.id) >= min);

    const sort = getCurrentSort();
    out.sort((a, b) => {
      switch (sort) {
        case "oldest":
          return (a.createdAt || 0) - (b.createdAt || 0);
        case "title-asc":
          return (a.title || "").localeCompare(b.title || "");
        case "title-desc":
          return (b.title || "").localeCompare(a.title || "");
        case "rating-asc":
          return getUserRating(a.id) - getUserRating(b.id);
        case "rating-desc":
          return getUserRating(b.id) - getUserRating(a.id);
        case "model-asc":
          const modelA = a.metadata?.model || "zzz";
          const modelB = b.metadata?.model || "zzz";
          return modelA.localeCompare(modelB);
        case "model-desc":
          const modelA2 = a.metadata?.model || "";
          const modelB2 = b.metadata?.model || "";
          return modelB2.localeCompare(modelA2);
        case "tokens-asc":
          const avgA = a.metadata?.tokenEstimate
            ? (a.metadata.tokenEstimate.min + a.metadata.tokenEstimate.max) / 2
            : 0;
          const avgB = b.metadata?.tokenEstimate
            ? (b.metadata.tokenEstimate.min + b.metadata.tokenEstimate.max) / 2
            : 0;
          return avgA - avgB;
        case "tokens-desc":
          const avgA2 = a.metadata?.tokenEstimate
            ? (a.metadata.tokenEstimate.min + a.metadata.tokenEstimate.max) / 2
            : 0;
          const avgB2 = b.metadata?.tokenEstimate
            ? (b.metadata.tokenEstimate.min + b.metadata.tokenEstimate.max) / 2
            : 0;
          return avgB2 - avgA2;
        case "newest":
        default:
          return (b.createdAt || 0) - (a.createdAt || 0);
      }
    });
    return out;
  }

  function renderPrompts() {
    const prompts = getFilteredSortedPrompts();

    if (countEl) {
      countEl.textContent = prompts.length
        ? `${prompts.length} saved`
        : "No prompts yet";
    }

    cardsEl.innerHTML = "";

    if (!prompts.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.style.padding = "6px 2px 10px";
      empty.textContent = "No prompts saved yet. Create one above.";
      cardsEl.appendChild(empty);
      return;
    }

    for (const p of prompts) {
      const card = document.createElement("article");
      card.className = "card";
      card.dataset.id = p.id;

      const h3 = document.createElement("h3");
      h3.className = "card-title";
      h3.textContent = p.title;

      const prev = document.createElement("p");
      prev.className = "card-preview";
      prev.textContent = createPreview(p.content);

      // Metadata display
      const metadataEl = document.createElement("div");
      metadataEl.className = "card-metadata";

      if (p.metadata) {
        const modelEl = document.createElement("div");
        modelEl.className = "metadata-model";
        modelEl.innerHTML = `<span class="metadata-label">Model:</span> ${p.metadata.model}`;

        const timestampEl = document.createElement("div");
        timestampEl.className = "metadata-timestamp";
        timestampEl.innerHTML = `<span class="metadata-label">Created:</span> ${formatTimestamp(
          p.metadata.createdAt
        )}`;

        const tokensEl = document.createElement("div");
        tokensEl.className = "metadata-tokens";
        const { min, max, confidence } = p.metadata.tokenEstimate;
        tokensEl.innerHTML = `<span class="metadata-label">Tokens:</span> <span class="token-estimate token-confidence-${confidence}">${min}-${max} (${confidence})</span>`;

        metadataEl.appendChild(modelEl);
        metadataEl.appendChild(timestampEl);
        metadataEl.appendChild(tokensEl);
      } else {
        // Fallback for prompts without metadata
        const fallbackEl = document.createElement("div");
        fallbackEl.className = "metadata-fallback";
        fallbackEl.textContent = "Legacy prompt (no metadata)";
        metadataEl.appendChild(fallbackEl);
      }

      const ratingWrap = document.createElement("div");
      renderRatingComponent(ratingWrap, p);

      const actions = document.createElement("div");
      actions.className = "card-actions";

      const notesBtn = document.createElement("button");
      notesBtn.type = "button";
      notesBtn.className = "btn btn-notes";
      notesBtn.setAttribute("aria-label", `Toggle notes for ${p.title}`);
      notesBtn.dataset.action = "toggle-notes";
      notesBtn.dataset.id = p.id;

      const hasNotes = getNotes(p.id);
      notesBtn.innerHTML = hasNotes ? "📝" : "📄";
      notesBtn.setAttribute("aria-expanded", "false");

      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn-danger";
      del.setAttribute("aria-label", `Delete ${p.title}`);
      del.textContent = "Delete";
      del.dataset.action = "delete";
      del.dataset.id = p.id;

      actions.appendChild(notesBtn);
      actions.appendChild(del);

      // Notes section (initially hidden)
      const notesSection = document.createElement("div");
      notesSection.className = "notes-section";
      notesSection.dataset.id = p.id;
      notesSection.setAttribute("aria-hidden", "true");

      const notesTextarea = document.createElement("textarea");
      notesTextarea.className = "notes-textarea";
      notesTextarea.placeholder = "Add your notes about this prompt...";
      notesTextarea.maxLength = 500;
      notesTextarea.rows = 3;
      const currentNotes = getNotes(p.id);
      if (currentNotes) {
        notesTextarea.value = currentNotes.content;
      }

      const notesControls = document.createElement("div");
      notesControls.className = "notes-controls";

      const charCount = document.createElement("span");
      charCount.className = "char-count";
      charCount.textContent = `${notesTextarea.value.length}/500`;

      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "btn btn-primary notes-save";
      saveBtn.textContent = "Save";
      saveBtn.disabled = true;
      saveBtn.dataset.action = "save-notes";
      saveBtn.dataset.id = p.id;

      const deleteNotesBtn = document.createElement("button");
      deleteNotesBtn.type = "button";
      deleteNotesBtn.className = "btn btn-danger notes-delete";
      deleteNotesBtn.textContent = "Delete Notes";
      deleteNotesBtn.style.display = currentNotes ? "block" : "none";
      deleteNotesBtn.dataset.action = "delete-notes";
      deleteNotesBtn.dataset.id = p.id;

      notesControls.appendChild(charCount);
      notesControls.appendChild(saveBtn);
      notesControls.appendChild(deleteNotesBtn);

      notesSection.appendChild(notesTextarea);
      notesSection.appendChild(notesControls);

      card.appendChild(h3);
      card.appendChild(prev);
      card.appendChild(metadataEl);
      card.appendChild(ratingWrap);
      card.appendChild(actions);
      card.appendChild(notesSection);

      cardsEl.appendChild(card);
    }
  }

  function addPrompt(title, content, modelName = "Default Model") {
    try {
      const prompts = getPrompts();
      const metadata = trackModel(modelName, content);

      prompts.unshift({
        id: makeId(),
        title,
        content,
        createdAt: Date.now(),
        metadata: metadata,
      });
      setPrompts(prompts);
    } catch (error) {
      console.error("Error adding prompt:", error);
      throw error;
    }
  }

  function deletePrompt(id) {
    const prompts = getPrompts().filter((p) => p.id !== id);
    setPrompts(prompts);
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = (titleInput.value || "").trim();
    const content = (contentInput.value || "").trim();
    const modelInput = document.getElementById("model");
    const model = modelInput
      ? (modelInput.value || "").trim()
      : "Default Model";

    if (!title || !content) {
      // Basic hint: mark invalid fields
      if (!title) titleInput.focus();
      return;
    }

    try {
      addPrompt(title, content, model || "Default Model");
      form.reset();
      titleInput.focus();
      renderPrompts();
    } catch (error) {
      alert("Error saving prompt: " + error.message);
    }
  });

  cardsEl.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const action = t.dataset.action;
    const id = t.dataset.id;

    if (action === "delete" && id) {
      deletePrompt(id);
      renderPrompts();
    } else if (action === "toggle-notes" && id) {
      toggleNotesSection(id);
    } else if (action === "save-notes" && id) {
      saveNotesForPrompt(id);
    } else if (action === "delete-notes" && id) {
      if (confirm("Delete these notes? This action cannot be undone.")) {
        setNotes(id, "");
        renderPrompts();
      }
    }
  });

  cardsEl.addEventListener("input", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    if (t.classList.contains("notes-textarea")) {
      const card = t.closest(".card");
      if (!card) return;

      const id = card.dataset.id;
      const charCountEl = card.querySelector(".char-count");
      const saveBtn = card.querySelector(".notes-save");
      const currentNotes = getNotes(id);

      if (charCountEl) {
        charCountEl.textContent = `${t.value.length}/500`;
      }

      if (saveBtn) {
        const hasChanges = currentNotes
          ? t.value.trim() !== currentNotes.content
          : t.value.trim() !== "";
        saveBtn.disabled = !hasChanges;

        if (hasChanges && !saveBtn.classList.contains("unsaved")) {
          saveBtn.classList.add("unsaved");
        } else if (!hasChanges) {
          saveBtn.classList.remove("unsaved");
        }
      }
    }
  });

  function toggleNotesSection(promptId) {
    const card = document.querySelector(`[data-id="${promptId}"]`);
    if (!card) return;

    const notesSection = card.querySelector(".notes-section");
    const notesBtn = card.querySelector(`[data-action="toggle-notes"]`);

    if (!notesSection || !notesBtn) return;

    const isExpanded = notesBtn.getAttribute("aria-expanded") === "true";
    const newExpanded = !isExpanded;

    notesBtn.setAttribute("aria-expanded", String(newExpanded));
    notesSection.setAttribute("aria-hidden", String(!newExpanded));

    if (newExpanded) {
      notesSection.classList.add("expanded");
      const textarea = notesSection.querySelector(".notes-textarea");
      if (textarea) {
        setTimeout(() => textarea.focus(), 100);
      }
    } else {
      notesSection.classList.remove("expanded");
    }
  }

  function saveNotesForPrompt(promptId) {
    const card = document.querySelector(`[data-id="${promptId}"]`);
    if (!card) return;

    const textarea = card.querySelector(".notes-textarea");
    const saveBtn = card.querySelector(".notes-save");
    const deleteBtn = card.querySelector(".notes-delete");
    const notesBtn = card.querySelector(`[data-action="toggle-notes"]`);

    if (!textarea) return;

    const content = textarea.value.trim();
    setNotes(promptId, content);

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.classList.remove("unsaved");
      saveBtn.textContent = "Saved ✓";
      setTimeout(() => {
        if (saveBtn) saveBtn.textContent = "Save";
      }, 1500);
    }

    if (deleteBtn) {
      deleteBtn.style.display = content ? "block" : "none";
    }

    if (notesBtn) {
      notesBtn.innerHTML = content ? "📝" : "📄";
    }
  }

  if (ratingFilterEl) {
    ratingFilterEl.addEventListener("change", renderPrompts);
  }
  if (sortByEl) {
    sortByEl.addEventListener("change", renderPrompts);
  }

  // Export/Import Event Listeners
  if (exportBtn) {
    exportBtn.addEventListener("click", exportData);
  }

  if (importBtn && importFileInput) {
    importBtn.addEventListener("click", () => {
      importFileInput.click();
    });

    importFileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        if (file.type !== "application/json" && !file.name.endsWith(".json")) {
          showNotification("Please select a JSON file", "error");
          return;
        }
        importData(file);
        // Clear the input so the same file can be selected again
        e.target.value = "";
      }
    });
  }

  function renderRatingComponent(containerEl, prompt) {
    containerEl.innerHTML = "";
    containerEl.className = "rating";
    containerEl.setAttribute("role", "radiogroup");
    containerEl.setAttribute("aria-label", `Rate ${prompt.title}`);
    containerEl.setAttribute("data-rating-prompt-id", prompt.id);

    const current = getUserRating(prompt.id);

    for (let i = 1; i <= 5; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "star";
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-label", `${i} star${i > 1 ? "s" : ""}`);
      btn.setAttribute("aria-checked", String(i === Math.round(current)));
      btn.dataset.value = String(i);

      btn.addEventListener("mouseenter", () => paintStars(containerEl, i));
      btn.addEventListener("mouseleave", () => {
        const r =
          Number(containerEl.getAttribute("data-current-rating")) || current;
        paintStars(containerEl, r);
      });
      btn.addEventListener("click", () => setRating(prompt.id, i));

      containerEl.appendChild(btn);
    }

    containerEl.tabIndex = 0;
    containerEl.addEventListener("keydown", (e) => {
      const id = containerEl.getAttribute("data-rating-prompt-id");
      if (!id) return;
      const currentVal = getUserRating(id);
      if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        e.preventDefault();
        setRating(id, Math.min(5, currentVal + 1));
      } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        e.preventDefault();
        setRating(id, Math.max(0, currentVal - 1));
      } else if (e.key === "0" || e.key === "Delete") {
        e.preventDefault();
        setRating(id, 0);
      }
    });

    containerEl.setAttribute("data-current-rating", String(current));
    paintStars(containerEl, current);
  }

  function paintStars(containerEl, value) {
    const children = Array.from(containerEl.children);
    children.forEach((el, idx) => {
      const filled = idx < value;
      el.classList.toggle("filled", filled);
      el.setAttribute("aria-checked", String(idx + 1 === Math.round(value)));
    });
  }

  document.addEventListener("DOMContentLoaded", renderPrompts);

  // Initial paint (in case DOMContentLoaded already fired)
  renderPrompts();
})();

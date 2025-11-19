(function () {
  const STORAGE_KEY = "promptLibrary.prompts.v1";
  const USER_RATINGS_KEY = "promptLibrary.userRatings.v1";
  const NOTES_KEY = "promptLibrary.notes.v1";

  // Security utilities
  function sanitizeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function validateString(input, maxLength = 1000) {
    if (typeof input !== "string") {
      throw new Error("Input must be a string");
    }
    if (input.length > maxLength) {
      throw new Error(
        `Input exceeds maximum length of ${maxLength} characters`
      );
    }
    return input.trim();
  }

  function validateFileSize(file, maxSizeMB = 10) {
    const maxBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new Error(`File size exceeds ${maxSizeMB}MB limit`);
    }
  }

  // Performance utilities
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func.apply(this, args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  function throttle(func, limit) {
    let lastRun = 0;
    return function executedFunction(...args) {
      if (Date.now() - lastRun >= limit) {
        func.apply(this, args);
        lastRun = Date.now();
      }
    };
  }

  // Simple encryption utilities (base64 encoding for basic obfuscation)
  function encryptData(data) {
    try {
      const jsonString = JSON.stringify(data);
      return btoa(unescape(encodeURIComponent(jsonString)));
    } catch (error) {
      console.warn("Encryption failed, storing as plain text:", error);
      return JSON.stringify(data);
    }
  }

  function decryptData(encryptedData, fallback) {
    try {
      // Try to decrypt (base64 decode)
      const decoded = decodeURIComponent(escape(atob(encryptedData)));
      return JSON.parse(decoded);
    } catch (error) {
      // Fallback to plain JSON parse for backward compatibility
      try {
        return JSON.parse(encryptedData);
      } catch (parseError) {
        console.warn("Decryption and parse failed:", error, parseError);
        return fallback;
      }
    }
  }

  // Cache for rendered elements
  const renderCache = new Map();
  let currentRenderKey = null;

  // Metadata tracking functions
  function trackModel(modelName, content) {
    // Enhanced validation
    const sanitizedModel = validateString(modelName, 100);
    const sanitizedContent = validateString(content, 50000); // 50KB content limit

    if (!sanitizedModel) {
      throw new Error("Model name must be a non-empty string");
    }

    if (!sanitizedContent) {
      throw new Error("Content cannot be empty");
    }

    const now = new Date().toISOString();
    const tokenEstimate = estimateTokens(sanitizedContent, false);

    return {
      model: sanitizedModel,
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

    const dialogContent = document.createElement("div");
    dialogContent.className = "merge-dialog";

    const title = document.createElement("h3");
    title.textContent = "Import Conflicts Detected";

    const description = document.createElement("p");
    description.textContent = `Found ${duplicates.length} prompt(s) with IDs that already exist:`;

    const conflictList = document.createElement("ul");
    conflictList.className = "conflict-list";

    duplicates.forEach((p) => {
      const li = document.createElement("li");
      const strong = document.createElement("strong");
      strong.textContent = validateString(p.title, 120);
      li.appendChild(strong);
      li.appendChild(document.createTextNode(` (ID: ${sanitizeHTML(p.id)})`));
      conflictList.appendChild(li);
    });

    const question = document.createElement("p");
    question.textContent = "How would you like to handle these conflicts?";

    const actions = document.createElement("div");
    actions.className = "merge-actions";

    const buttons = [
      {
        text: "Replace Existing",
        action: "replace",
        className: "btn btn-primary",
      },
      {
        text: "Skip Duplicates",
        action: "skip",
        className: "btn btn-secondary",
      },
      {
        text: "Rename Imports",
        action: "rename",
        className: "btn btn-secondary",
      },
      { text: "Cancel Import", action: "cancel", className: "btn btn-danger" },
    ];

    buttons.forEach((btnConfig) => {
      const btn = document.createElement("button");
      btn.className = btnConfig.className;
      btn.textContent = btnConfig.text;
      btn.dataset.action = btnConfig.action;
      actions.appendChild(btn);
    });

    dialogContent.appendChild(title);
    dialogContent.appendChild(description);
    dialogContent.appendChild(conflictList);
    dialogContent.appendChild(question);
    dialogContent.appendChild(actions);
    dialog.appendChild(dialogContent);

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
    try {
      // Validate file
      validateFileSize(file, 10); // 10MB limit

      if (
        !file.type.includes("json") &&
        !file.name.toLowerCase().endsWith(".json")
      ) {
        throw new Error("Only JSON files are allowed");
      }

      const backup = createBackup();

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const jsonString = e.target.result;

          // Validate JSON string size
          if (jsonString.length > 50 * 1024 * 1024) {
            // 50MB text limit
            throw new Error("JSON content too large");
          }

          const importData = JSON.parse(jsonString);
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
    } catch (error) {
      console.error("File validation failed:", error);
      showNotification(`Import failed: ${error.message}`, "error");
    }
  }

  function showNotification(message, type = "info") {
    // Remove any existing notifications
    const existing = document.querySelector(".notification");
    if (existing) {
      existing.remove();
    }

    const notification = document.createElement("div");
    notification.className = `notification notification-${sanitizeHTML(type)}`;

    const messageSpan = document.createElement("span");
    messageSpan.className = "notification-message";
    messageSpan.textContent = validateString(message, 500);

    const closeButton = document.createElement("button");
    closeButton.className = "notification-close";
    closeButton.setAttribute("aria-label", "Close notification");
    closeButton.textContent = "×";

    notification.appendChild(messageSpan);
    notification.appendChild(closeButton);

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
      const parsed = JSON.parse(json);
      return validateDataIntegrity(parsed, fallback);
    } catch (error) {
      console.warn("JSON parse error, using fallback:", error);
      return fallback;
    }
  }

  function validateDataIntegrity(data, fallback) {
    // Basic structure validation
    if (data === null || data === undefined) {
      return fallback;
    }

    // Array validation
    if (Array.isArray(fallback)) {
      if (!Array.isArray(data)) {
        console.warn("Expected array, got:", typeof data);
        return fallback;
      }

      // Validate array items if it's a prompts array
      if (fallback.length === 0 && data.length > 0 && data[0].id) {
        return data.filter((item) => {
          return (
            item &&
            typeof item.id === "string" &&
            typeof item.title === "string" &&
            typeof item.content === "string" &&
            item.title.length <= 120 &&
            item.content.length <= 50000
          );
        });
      }
    }

    // Object validation
    if (typeof fallback === "object" && !Array.isArray(fallback)) {
      if (typeof data !== "object" || Array.isArray(data)) {
        console.warn("Expected object, got:", typeof data);
        return fallback;
      }

      // Validate object values
      const validated = {};
      for (const [key, value] of Object.entries(data)) {
        if (typeof key === "string" && key.length <= 50) {
          if (typeof value === "number" && value >= 0 && value <= 5) {
            // Rating validation
            validated[key] = value;
          } else if (
            typeof value === "object" &&
            value.content &&
            value.lastModified
          ) {
            // Notes validation
            if (
              typeof value.content === "string" &&
              value.content.length <= 500
            ) {
              validated[key] = {
                content: value.content,
                lastModified: value.lastModified,
                characterCount: value.content.length,
              };
            }
          }
        }
      }
      return validated;
    }

    return data;
  }

  function getPrompts() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];

      const arr = decryptData(raw, []);
      const validated = validateDataIntegrity(arr, []);
      if (!Array.isArray(validated)) {
        console.warn("Prompts data is not an array, resetting to empty array");
        return [];
      }
      return validated;
    } catch (error) {
      console.error("Error loading prompts:", error);
      return [];
    }
  }

  function setPrompts(arr) {
    try {
      if (!Array.isArray(arr)) {
        throw new Error("Prompts must be an array");
      }

      // Validate array size
      if (arr.length > 2000) {
        throw new Error("Too many prompts to store");
      }

      const encryptedData = encryptData(arr);

      // Check localStorage quota
      if (encryptedData.length > 5 * 1024 * 1024) {
        // 5MB limit
        throw new Error("Data too large to store");
      }

      localStorage.setItem(STORAGE_KEY, encryptedData);
    } catch (error) {
      console.error("Error saving prompts:", error);
      showNotification("Failed to save prompts: " + error.message, "error");
      throw error;
    }
  }

  function loadUserRatings() {
    try {
      const raw = localStorage.getItem(USER_RATINGS_KEY);
      if (!raw) return {};

      const obj = decryptData(raw, {});
      const validated = validateDataIntegrity(obj, {});
      return validated && typeof validated === "object" ? validated : {};
    } catch (error) {
      console.warn("Error loading ratings:", error);
      return {};
    }
  }

  function saveUserRatings(map) {
    try {
      const encryptedData = encryptData(map || {});
      localStorage.setItem(USER_RATINGS_KEY, encryptedData);
    } catch (error) {
      console.error("Failed to save ratings:", error);
      showNotification("Failed to save ratings: " + error.message, "error");
    }
  }

  function loadNotes() {
    try {
      const raw = localStorage.getItem(NOTES_KEY);
      if (!raw) return {};

      const obj = decryptData(raw, {});
      const validated = validateDataIntegrity(obj, {});
      return validated && typeof validated === "object" ? validated : {};
    } catch (error) {
      console.warn("Error loading notes:", error);
      return {};
    }
  }

  function saveNotes(notes) {
    try {
      if (typeof notes !== "object" || notes === null) {
        throw new Error("Notes must be a valid object");
      }

      const encryptedData = encryptData(notes);

      if (encryptedData.length > 1024 * 1024) {
        // 1MB limit for notes
        throw new Error("Notes data too large");
      }

      localStorage.setItem(NOTES_KEY, encryptedData);
    } catch (error) {
      console.error("Failed to save notes:", error);
      showNotification("Failed to save notes: " + error.message, "error");
    }
  }

  function getNotes(promptId) {
    const notes = promptNotes[promptId];
    return notes && typeof notes === "object" ? notes : null;
  }

  function setNotes(promptId, content) {
    try {
      const sanitizedId = validateString(promptId, 50);
      const sanitizedContent = validateString(content, 500);

      if (!sanitizedContent || sanitizedContent === "") {
        delete promptNotes[sanitizedId];
      } else {
        promptNotes[sanitizedId] = {
          content: sanitizedContent,
          lastModified: Date.now(),
          characterCount: sanitizedContent.length,
        };
      }
      saveNotes(promptNotes);
    } catch (error) {
      console.error("Error setting notes:", error);
      throw error;
    }
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

    // Generate cache key based on current state
    const renderKey = JSON.stringify({
      prompts: prompts.map((p) => ({
        id: p.id,
        title: p.title,
        updatedAt: p.metadata?.updatedAt,
      })),
      filter: getCurrentFilterMin(),
      sort: getCurrentSort(),
      ratings: Object.keys(userRatings).length,
      notes: Object.keys(promptNotes).length,
    });

    // Return cached result if nothing changed
    if (currentRenderKey === renderKey && renderCache.has(renderKey)) {
      return;
    }

    currentRenderKey = renderKey;

    if (countEl) {
      countEl.textContent = prompts.length
        ? `${prompts.length} saved`
        : "No prompts yet";
    }

    // Use document fragment for better performance
    const fragment = document.createDocumentFragment();

    if (!prompts.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.style.padding = "6px 2px 10px";
      empty.textContent = "No prompts saved yet. Create one above.";
      fragment.appendChild(empty);
    } else {
      // Limit rendering for performance (virtual scrolling preparation)
      const maxRender = Math.min(prompts.length, 100);

      for (let i = 0; i < maxRender; i++) {
        const p = prompts[i];
        const card = createPromptCard(p);
        fragment.appendChild(card);
      }

      // Show load more button if there are more items
      if (prompts.length > maxRender) {
        const loadMore = document.createElement("div");
        loadMore.className = "load-more-container";
        const button = document.createElement("button");
        button.className = "btn btn-secondary";
        button.textContent = `Load ${Math.min(
          50,
          prompts.length - maxRender
        )} more prompts`;
        button.onclick = () => renderMorePrompts(maxRender);
        loadMore.appendChild(button);
        fragment.appendChild(loadMore);
      }
    }

    // Clear and append all at once
    cardsEl.innerHTML = "";
    cardsEl.appendChild(fragment);

    // Cache the result
    renderCache.set(renderKey, true);

    // Clean old cache entries
    if (renderCache.size > 10) {
      const firstKey = renderCache.keys().next().value;
      renderCache.delete(firstKey);
    }
  }

  function renderMorePrompts(startIndex) {
    const prompts = getFilteredSortedPrompts();
    const endIndex = Math.min(startIndex + 50, prompts.length);

    const fragment = document.createDocumentFragment();

    for (let i = startIndex; i < endIndex; i++) {
      const p = prompts[i];
      const card = createPromptCard(p);
      fragment.appendChild(card);
    }

    // Remove load more button
    const loadMoreContainer = cardsEl.querySelector(".load-more-container");
    if (loadMoreContainer) {
      loadMoreContainer.remove();
    }

    cardsEl.appendChild(fragment);

    // Add new load more button if needed
    if (endIndex < prompts.length) {
      const loadMore = document.createElement("div");
      loadMore.className = "load-more-container";
      const button = document.createElement("button");
      button.className = "btn btn-secondary";
      button.textContent = `Load ${Math.min(
        50,
        prompts.length - endIndex
      )} more prompts`;
      button.onclick = () => renderMorePrompts(endIndex);
      loadMore.appendChild(button);
      cardsEl.appendChild(loadMore);
    }
  }

  function createPromptCard(p) {
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.id = p.id;

    const h3 = document.createElement("h3");
    h3.className = "card-title";
    h3.textContent = validateString(p.title, 120);

    const prev = document.createElement("p");
    prev.className = "card-preview";
    prev.textContent = createPreview(p.content);

    // Metadata display
    const metadataEl = createMetadataElement(p);
    const ratingWrap = document.createElement("div");
    renderRatingComponent(ratingWrap, p);
    const actions = createActionsElement(p);
    const notesSection = createNotesSection(p);

    card.appendChild(h3);
    card.appendChild(prev);
    card.appendChild(metadataEl);
    card.appendChild(ratingWrap);
    card.appendChild(actions);
    card.appendChild(notesSection);

    return card;
  }

  function createMetadataElement(p) {
    const metadataEl = document.createElement("div");
    metadataEl.className = "card-metadata";

    if (p.metadata) {
      const modelEl = document.createElement("div");
      modelEl.className = "metadata-model";

      const modelLabel = document.createElement("span");
      modelLabel.className = "metadata-label";
      modelLabel.textContent = "Model:";

      modelEl.appendChild(modelLabel);
      modelEl.appendChild(
        document.createTextNode(" " + sanitizeHTML(p.metadata.model))
      );

      const timestampEl = document.createElement("div");
      timestampEl.className = "metadata-timestamp";

      const timestampLabel = document.createElement("span");
      timestampLabel.className = "metadata-label";
      timestampLabel.textContent = "Created:";

      timestampEl.appendChild(timestampLabel);
      timestampEl.appendChild(
        document.createTextNode(" " + formatTimestamp(p.metadata.createdAt))
      );

      const tokensEl = document.createElement("div");
      tokensEl.className = "metadata-tokens";
      const { min, max, confidence } = p.metadata.tokenEstimate;

      const tokensLabel = document.createElement("span");
      tokensLabel.className = "metadata-label";
      tokensLabel.textContent = "Tokens:";

      const tokenEstimate = document.createElement("span");
      tokenEstimate.className = `token-estimate token-confidence-${confidence}`;
      tokenEstimate.textContent = `${min}-${max} (${confidence})`;

      tokensEl.appendChild(tokensLabel);
      tokensEl.appendChild(document.createTextNode(" "));
      tokensEl.appendChild(tokenEstimate);

      metadataEl.appendChild(modelEl);
      metadataEl.appendChild(timestampEl);
      metadataEl.appendChild(tokensEl);
    } else {
      const fallbackEl = document.createElement("div");
      fallbackEl.className = "metadata-fallback";
      fallbackEl.textContent = "Legacy prompt (no metadata)";
      metadataEl.appendChild(fallbackEl);
    }

    return metadataEl;
  }

  function createActionsElement(p) {
    const actions = document.createElement("div");
    actions.className = "card-actions";

    const notesBtn = document.createElement("button");
    notesBtn.type = "button";
    notesBtn.className = "btn btn-notes";
    notesBtn.setAttribute(
      "aria-label",
      `Toggle notes for ${validateString(p.title, 120)}`
    );
    notesBtn.dataset.action = "toggle-notes";
    notesBtn.dataset.id = p.id;

    const hasNotes = getNotes(p.id);
    notesBtn.textContent = hasNotes ? "📝" : "📄";
    notesBtn.setAttribute("aria-expanded", "false");

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-danger";
    del.setAttribute("aria-label", `Delete ${validateString(p.title, 120)}`);
    del.textContent = "Delete";
    del.dataset.action = "delete";
    del.dataset.id = p.id;

    actions.appendChild(notesBtn);
    actions.appendChild(del);

    return actions;
  }

  function createNotesSection(p) {
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

    return notesSection;
  }

  function addPrompt(title, content, modelName = "Default Model") {
    try {
      // Validate and sanitize inputs
      const sanitizedTitle = validateString(title, 120);
      const sanitizedContent = validateString(content, 50000);
      const sanitizedModel = validateString(modelName, 100);

      if (!sanitizedTitle) {
        throw new Error("Title cannot be empty");
      }

      if (!sanitizedContent) {
        throw new Error("Content cannot be empty");
      }

      const prompts = getPrompts();

      // Limit total number of prompts
      if (prompts.length >= 1000) {
        throw new Error("Maximum number of prompts (1000) reached");
      }

      const metadata = trackModel(sanitizedModel, sanitizedContent);

      prompts.unshift({
        id: makeId(),
        title: sanitizedTitle,
        content: sanitizedContent,
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

    try {
      const title = (titleInput.value || "").trim();
      const content = (contentInput.value || "").trim();
      const modelInput = document.getElementById("model");
      const model = modelInput
        ? (modelInput.value || "").trim()
        : "Default Model";

      // Client-side validation with user feedback
      if (!title) {
        titleInput.focus();
        titleInput.setCustomValidity("Title is required");
        titleInput.reportValidity();
        return;
      }

      if (!content) {
        contentInput.focus();
        contentInput.setCustomValidity("Content is required");
        contentInput.reportValidity();
        return;
      }

      // Clear any previous validation messages
      titleInput.setCustomValidity("");
      contentInput.setCustomValidity("");

      addPrompt(title, content, model || "Default Model");
      form.reset();
      titleInput.focus();
      renderPrompts();
      showNotification("Prompt saved successfully", "success");
    } catch (error) {
      console.error("Form submission error:", error);
      showNotification(`Error saving prompt: ${error.message}`, "error");
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

  // Debounced render function for filter/sort changes
  const debouncedRender = debounce(renderPrompts, 150);

  if (ratingFilterEl) {
    ratingFilterEl.addEventListener("change", debouncedRender);
  }
  if (sortByEl) {
    sortByEl.addEventListener("change", debouncedRender);
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

  // Global error handler
  window.addEventListener("error", (event) => {
    console.error("Global error caught:", event.error);
    showNotification(
      "An unexpected error occurred. Please refresh the page.",
      "error"
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    console.error("Unhandled promise rejection:", event.reason);
    showNotification(
      "An error occurred while processing your request.",
      "error"
    );
  });

  // Initial paint (in case DOMContentLoaded already fired)
  renderPrompts();
})();

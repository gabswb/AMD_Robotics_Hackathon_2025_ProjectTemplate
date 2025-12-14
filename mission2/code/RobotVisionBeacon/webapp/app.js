const STORAGE_KEY = "santas_happiness_warehouse_v1";
const deepClone = (obj) =>
  globalThis.structuredClone ? globalThis.structuredClone(obj) : JSON.parse(JSON.stringify(obj));

const DEFAULT_STATE = {
  screen: "welcome",
  columns: {
    warehouse: { title: "Warehouse Storage", emoji: "🧸", color: "var(--warehouse)" },
    kid1: { title: "Kid 1 wish list", emoji: "🙂", color: "var(--kid1)" },
    kid2: { title: "Kid 2 wish list", emoji: "🙂", color: "var(--kid2)" },
  },
  recordedItems: {},
  cards: {},
  order: { warehouse: [], kid1: [], kid2: [] },
  wsUrl: "ws://localhost:8765",
  console: {
    interactiveMode: "passive", // passive | any_key_red (effective 'stopped' is derived from WS disconnected)
  },
};

const Status = {
  IN_WAREHOUSE: "in_warehouse",
  PUTTING_AWAY: "putting_away",
  COLLECTED: "collected",
};

const FALLBACK_IMG =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ff6b6b" stop-opacity="0.35"/>
          <stop offset="1" stop-color="#66a8ff" stop-opacity="0.25"/>
        </linearGradient>
      </defs>
      <rect width="240" height="240" rx="28" fill="url(#g)"/>
      <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" font-size="92">🎁</text>
    </svg>`
  );

/** @type {ReturnType<typeof loadState>} */
let state = loadState();
/** @type {WebSocket | null} */
let ws = null;
let activePuttingAwayBarcode = null;
let finishTimer = null;
let draggingBarcode = null;
let suppressDrag = false;

const KidSignal = {
  kid1: "GREEN",
  kid2: "BLUE",
};

const $ = (sel) => /** @type {HTMLElement} */ (document.querySelector(sel));
const els = {
  welcomeScreen: $("#welcome-screen"),
  kanbanScreen: $("#kanban-screen"),
  finishScreen: $("#finish-screen"),
  enterBtn: $("#enter-btn"),
  returnBtn: $("#return-btn"),
  columns: $("#columns"),
  consoleInferStartBtn: $("#console-infer-start-btn"),
  consoleInferPauseBtn: $("#console-infer-pause-btn"),
  consoleScanBtn: $("#console-scan-btn"),
  drawer: $("#drawer"),
  recordedItemsBtn: $("#recorded-items-btn"),
  closeDrawerBtn: $("#close-drawer-btn"),
  recordedItemsList: $("#recorded-items-list"),
  addItemBtn: $("#add-item-btn"),
  modalOverlay: $("#modal-overlay"),
  itemModal: $("#item-modal"),
  itemModalTitle: $("#item-modal-title"),
  itemModalClose: $("#item-modal-close"),
  itemForm: /** @type {HTMLFormElement} */ ($("#item-form")),
  itemEditingBarcode: /** @type {HTMLInputElement} */ ($("#item-editing-barcode")),
  itemImage: /** @type {HTMLInputElement} */ ($("#item-image")),
  itemImagePreview: /** @type {HTMLImageElement} */ ($("#item-image-preview")),
  itemName: /** @type {HTMLInputElement} */ ($("#item-name")),
  itemId: /** @type {HTMLInputElement} */ ($("#item-id")),
  itemBarcode: /** @type {HTMLInputElement} */ ($("#item-barcode")),
  itemCancelBtn: $("#item-cancel-btn"),
  cardModal: $("#card-modal"),
  cardModalClose: $("#card-modal-close"),
  cardCreateList: $("#card-create-list"),
  cardCancelBtn: $("#card-cancel-btn"),
  toast: $("#toast"),
  wsDot: $("#ws-dot"),
  wsLabel: $("#ws-label"),
  wsUrl: /** @type {HTMLInputElement} */ ($("#ws-url")),
  wsConnectBtn: $("#ws-connect-btn"),
  wsDisconnectBtn: $("#ws-disconnect-btn"),
};

init();

function init() {
  els.wsUrl.value = state.wsUrl || DEFAULT_STATE.wsUrl;

  els.enterBtn.addEventListener("click", () => navigate("kanban"));
  els.returnBtn.addEventListener("click", () => {
    navigate("welcome");
  });

  els.consoleInferStartBtn?.addEventListener("click", () => {
    toast("Robot inference: start (reserved).");
  });
  els.consoleInferPauseBtn?.addEventListener("click", () => {
    toast("Robot inference: pause (reserved).");
  });
  els.consoleScanBtn?.addEventListener("click", onScanConsoleClick);
  window.addEventListener("keydown", onConsoleKeyDown, true);

  els.recordedItemsBtn.addEventListener("click", toggleDrawer);
  els.closeDrawerBtn.addEventListener("click", closeDrawer);
  els.addItemBtn.addEventListener("click", () => openItemModal({ mode: "create" }));

  els.modalOverlay.addEventListener("click", () => {
    closeItemModal();
    closeCardModal();
  });

  els.itemModalClose.addEventListener("click", closeItemModal);
  els.itemCancelBtn.addEventListener("click", closeItemModal);
  els.itemImage.addEventListener("change", async () => {
    const file = els.itemImage.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    els.itemImagePreview.src = dataUrl;
    els.itemImagePreview.alt = "Selected item image";
  });

  els.itemForm.addEventListener("submit", (e) => {
    e.preventDefault();
    saveItemFromForm();
  });

  els.cardModalClose.addEventListener("click", closeCardModal);
  els.cardCancelBtn.addEventListener("click", closeCardModal);

  els.wsConnectBtn.addEventListener("click", () => connectWs(true));
  els.wsDisconnectBtn.addEventListener("click", () => disconnectWs(true));

  els.columns.addEventListener("click", onCardActionClick, true);
  els.columns.addEventListener("pointerdown", onCardDeletePointerDown, true);
  els.columns.addEventListener(
    "pointerup",
    () => {
      suppressDrag = false;
    },
    true
  );
  els.columns.addEventListener(
    "pointercancel",
    () => {
      suppressDrag = false;
    },
    true
  );
  els.columns.addEventListener("click", onColumnsClick);
  els.columns.addEventListener("dblclick", onColumnsDblClick);
  els.columns.addEventListener("keydown", onColumnsKeyDown);
  setupDnD();

  els.recordedItemsList.addEventListener("click", onRecordedListClick);
  els.cardCreateList.addEventListener("click", onCardCreateListClick);

  render();
  if (state.screen === "kanban") connectWs(false);
}

function navigate(screen) {
  state.screen = screen;
  saveState();
  renderScreens();
  if (screen === "kanban") connectWs(false);
  if (screen !== "kanban") disconnectWs(false);
}

function render() {
  renderScreens();
  renderBoard();
  renderDrawer();
  updateWsIndicator();
  renderConsole();
}

function renderConsole() {
  if (!els.consoleScanBtn) return;
  const connected = ws?.readyState === WebSocket.OPEN;
  const mode = connected ? state.console?.interactiveMode || "passive" : "stopped";
  els.consoleScanBtn.classList.toggle("is-off", mode === "stopped");
  els.consoleScanBtn.classList.toggle("is-running", mode === "passive");
  els.consoleScanBtn.classList.toggle("is-anykey", mode === "any_key_red");

  const title =
    mode === "stopped"
      ? "Interactive: not running (connect host)"
      : mode === "passive"
        ? "Interactive: running (keys do nothing)"
        : "Interactive: running (any key = RED)";
  els.consoleScanBtn.title = title;
  els.consoleScanBtn.setAttribute("aria-label", title);
}

function renderScreens() {
  els.welcomeScreen.classList.toggle("screen--active", state.screen === "welcome");
  els.kanbanScreen.classList.toggle("screen--active", state.screen === "kanban");
  els.finishScreen.classList.toggle("screen--active", state.screen === "finish");
  if (state.screen === "finish") {
    els.returnBtn.hidden = true;
    window.setTimeout(() => {
      if (state.screen !== "finish") return;
      els.returnBtn.hidden = false;
    }, 650);
  }
}

function renderBoard() {
  if (state.screen !== "kanban") return;
  els.columns.innerHTML = ["warehouse", "kid1", "kid2"].map(renderColumn).join("");
}

function renderColumn(colKey) {
  const col = state.columns[colKey];
  const isWarehouse = colKey === "warehouse";
  const bodyClass = `column__body column__body--${colKey}`;
  const cards = state.order[colKey]
    .map((barcode) => renderCard(barcode, colKey))
    .filter(Boolean)
    .join("");
  const empty = state.order[colKey].length === 0 ? `<div class="empty">Drop cards here.</div>` : "";

  const actions = isWarehouse
    ? `
      <button class="icon-btn" type="button" data-action="open-card-modal" title="Create card">＋</button>
      <button class="btn btn--ghost" type="button" data-action="randomize" title="Randomly place warehouse cards">
        random
      </button>
    `
    : "";

  const title = escapeHtml(col.title);
  const titleHtml = isWarehouse
    ? `<div class="column__title">${title}</div>`
    : `<div class="column__title" data-editable-title="true" data-col="${colKey}" title="Double click to edit">${title}</div>`;

  return `
    <div class="column" data-col="${colKey}">
      <div class="column__header">
        <div class="column__titleWrap">
          <span class="column__emoji" aria-hidden="true">${col.emoji}</span>
          ${titleHtml}
        </div>
        <div class="column__actions">
          ${actions}
        </div>
      </div>
      <div class="${bodyClass}" data-dropzone="true" data-col="${colKey}">
        <div class="stack">
          ${cards || empty}
        </div>
      </div>
    </div>
  `;
}

function renderCard(barcode, colKey) {
  const card = state.cards[barcode];
  if (!card) return "";

  const item = state.recordedItems[barcode];
  const img = item?.imageDataUrl || card.imageDataUrl || FALLBACK_IMG;

  const isWishlist = colKey !== "warehouse";
  const status = card.status;
  const draggable = status === Status.IN_WAREHOUSE ? "true" : "false";

  const classes = [
    "card",
    isWishlist ? "card--wishlist" : "card--warehouse",
    status === Status.IN_WAREHOUSE ? "card--in-warehouse" : "",
    status === Status.PUTTING_AWAY ? "card--putting-away" : "",
    status === Status.COLLECTED ? "card--collected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const accent = isWishlist ? `style="--accent: ${state.columns[colKey].color}"` : "";

  return `
    <div class="${classes}" ${accent} draggable="${draggable}" data-card="${escapeAttr(barcode)}">
      <img class="card__img" src="${escapeAttr(img)}" alt="" />
      <div>
        <div class="card__title">${escapeHtml(card.itemName)} - ${escapeHtml(card.itemId)}</div>
        <div class="card__meta">
          <div>barcode: <span class="mono">${escapeHtml(card.barcode)}</span></div>
          <div>${renderStatusTag(colKey, status)}</div>
        </div>
      </div>
      <button
        class="card__delete"
        type="button"
        data-action="delete-card"
        data-card="${escapeAttr(barcode)}"
        aria-label="Delete card"
        title="Delete card"
        draggable="false"
      >
        🗑
      </button>
    </div>
  `;
}

function renderStatusTag(colKey, status) {
  if (colKey === "warehouse") return `<span class="tag"><span class="dot"></span>In warehouse</span>`;
  if (status === Status.IN_WAREHOUSE) return `<span class="tag"><span class="dot"></span>In warehouse</span>`;
  if (status === Status.PUTTING_AWAY)
    return `<span class="tag"><span class="dot"></span>Putting away…</span>`;
  return `<span class="tag"><span class="dot"></span>Collected</span>`;
}

function onCardActionClick(e) {
  const target = eventTargetElement(e);
  if (!target) return;
  const btn = target.closest("[data-action='delete-card']");
  if (!btn) return;
  const cardEl = btn.closest("[data-card]");
  const barcode = (btn.getAttribute("data-card") || cardEl?.getAttribute?.("data-card") || "").trim();
  if (!barcode) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  deleteCardFromBoard(barcode);
}

function onCardDeletePointerDown(e) {
  const target = eventTargetElement(e);
  if (!target) return;
  const btn = target.closest("[data-action='delete-card']");
  if (!btn) return;
  const cardEl = btn.closest("[data-card]");
  const barcode = (btn.getAttribute("data-card") || cardEl?.getAttribute?.("data-card") || "").trim();
  if (!barcode) return;

  // In some browsers, clicks inside draggable elements can get swallowed by drag logic.
  // Handle delete on pointerdown to make it reliable.
  suppressDrag = true;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (btn instanceof HTMLElement) btn.blur();
  deleteCardFromBoard(barcode);
}

function deleteCardFromBoard(barcode) {
  if (!state.cards[barcode]) return;
  if (activePuttingAwayBarcode === barcode) activePuttingAwayBarcode = null;
  if (draggingBarcode === barcode) draggingBarcode = null;
  if (finishTimer) {
    window.clearTimeout(finishTimer);
    finishTimer = null;
  }
  // Unassign before removal so the host can remove this barcode from its map.
  syncAssignmentForBarcode(barcode);
  removeCard(barcode);
  saveState();
  toast("Card deleted.");
  render();
}

function setupDnD() {
  // Use event delegation so dropping works even when the cursor is over child nodes.
  els.columns.addEventListener(
    "dragstart",
    (e) => {
      if (suppressDrag) {
        e.preventDefault();
        return;
      }
      const target = eventTargetElement(e);
      if (!target) return;
      const cardEl = target.closest("[data-card]");
      if (!cardEl) return;
      const barcode = cardEl.getAttribute("data-card") || "";
      draggingBarcode = barcode;
      try {
        e.dataTransfer?.setData("text/plain", barcode);
        e.dataTransfer?.setDragImage(cardEl, 30, 30);
      } catch {
        // ignore
      }
    },
    true
  );

  els.columns.addEventListener(
    "dragend",
    () => {
      draggingBarcode = null;
      clearDropHighlights();
    },
    true
  );

  els.columns.addEventListener(
    "dragover",
    (e) => {
      const dropzone = getDropzoneFromEvent(e);
      if (!dropzone) return;
      const barcode = getDraggedBarcode(e);
      if (!barcode) return;
      if (state.cards[barcode]?.status !== Status.IN_WAREHOUSE) return;
      e.preventDefault();
      highlightDropzone(dropzone);
    },
    true
  );

  els.columns.addEventListener(
    "drop",
    (e) => {
      const dropzone = getDropzoneFromEvent(e);
      if (!dropzone) return;
      const barcode = getDraggedBarcode(e);
      if (!barcode) return;
      e.preventDefault();
      clearDropHighlights();
      const targetCol = dropzone.getAttribute("data-col");
      if (!targetCol) return;
      moveCard(barcode, targetCol);
      draggingBarcode = null;
    },
    true
  );
}

function getDropzoneFromEvent(e) {
  const target = eventTargetElement(e);
  return target?.closest?.("[data-dropzone='true']") || null;
}

function getDraggedBarcode(e) {
  const fromTransfer = e.dataTransfer?.getData("text/plain")?.trim();
  return fromTransfer || draggingBarcode || null;
}

function highlightDropzone(zone) {
  clearDropHighlights();
  zone.classList.add("is-drop-target");
}

function clearDropHighlights() {
  for (const zone of els.columns.querySelectorAll(".is-drop-target")) zone.classList.remove("is-drop-target");
}

function onColumnsClick(e) {
  const target = eventTargetElement(e);
  if (!target) return;
  const action = target.closest("[data-action]")?.getAttribute("data-action");
  if (!action) return;
  if (action === "open-card-modal") {
    openCardModal();
    return;
  }
  if (action === "randomize") {
    randomizeWarehouseCards();
  }
}

function onColumnsDblClick(e) {
  const target = eventTargetElement(e);
  if (!target) return;
  const titleEl = target.closest("[data-editable-title='true']");
  if (!titleEl) return;
  const colKey = titleEl.getAttribute("data-col");
  if (!colKey || colKey === "warehouse") return;
  startEditColumnTitle(colKey, /** @type {HTMLElement} */ (titleEl));
}

function onColumnsKeyDown(e) {
  const target = /** @type {HTMLElement} */ (e.target);
  if (!(target instanceof HTMLInputElement)) return;
  if (target.classList.contains("title-input")) {
    if (e.key === "Enter") {
      target.blur();
    }
    if (e.key === "Escape") {
      renderBoard();
    }
  }
}

function startEditColumnTitle(colKey, titleEl) {
  const currentTitle = state.columns[colKey].title;
  const input = document.createElement("input");
  input.type = "text";
  input.value = currentTitle;
  input.className = "title-input";
  input.setAttribute("aria-label", "Edit column name");
  input.addEventListener("blur", () => {
    const next = input.value.trim() || currentTitle;
    state.columns[colKey].title = next;
    saveState();
    renderBoard();
  });
  titleEl.replaceWith(input);
  input.focus();
  input.select();
}

function openDrawer() {
  els.drawer.classList.add("drawer--open");
  els.drawer.setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  els.drawer.classList.remove("drawer--open");
  els.drawer.setAttribute("aria-hidden", "true");
}

function toggleDrawer() {
  if (els.drawer.classList.contains("drawer--open")) closeDrawer();
  else openDrawer();
}

function renderDrawer() {
  els.wsUrl.value = state.wsUrl || DEFAULT_STATE.wsUrl;
  const items = Object.values(state.recordedItems);
  if (items.length === 0) {
    els.recordedItemsList.innerHTML = `<div class="empty">No recorded items yet. Click “+ Item”.</div>`;
  } else {
    items.sort((a, b) => a.itemName.localeCompare(b.itemName));
    els.recordedItemsList.innerHTML = items.map(renderRecordedItemRow).join("");
  }
}

function renderRecordedItemRow(item) {
  const inBoard = Boolean(state.cards[item.barcode]);
  return `
    <div class="recorded" data-item="${escapeAttr(item.barcode)}">
      <img class="recorded__img" src="${escapeAttr(item.imageDataUrl || "")}" alt="" />
      <div>
        <div class="recorded__title">${escapeHtml(item.itemName)} - ${escapeHtml(item.itemId)}</div>
        <div class="recorded__meta">barcode: ${escapeHtml(item.barcode)}</div>
      </div>
      <div class="recorded__actions">
        <button class="btn btn--ghost" type="button" data-action="create-card" ${inBoard ? "disabled" : ""}>
          + card
        </button>
        <button class="btn btn--ghost" type="button" data-action="edit-item">edit</button>
        <button class="btn btn--ghost" type="button" data-action="delete-item">del</button>
      </div>
    </div>
  `;
}

function onRecordedListClick(e) {
  const target = /** @type {HTMLElement} */ (e.target);
  const row = target.closest("[data-item]");
  if (!row) return;
  const barcode = row.getAttribute("data-item");
  if (!barcode) return;

  const action = target.closest("[data-action]")?.getAttribute("data-action");
  if (!action) return;

  if (action === "create-card") {
    createCardFromRecordedItem(barcode);
    render();
    return;
  }

  if (action === "edit-item") {
    openItemModal({ mode: "edit", barcode });
    return;
  }

  if (action === "delete-item") {
    if (!confirm("Delete this recorded item?")) return;
    delete state.recordedItems[barcode];
    if (state.cards[barcode]) removeCard(barcode);
    saveState();
    toast("Deleted recorded item.");
    render();
  }
}

function openItemModal({ mode, barcode }) {
  openModal();
  els.itemModal.hidden = false;
  els.itemModalTitle.textContent = mode === "edit" ? "Edit item" : "New item";
  els.itemEditingBarcode.value = barcode || "";

  if (mode === "edit" && barcode) {
    const item = state.recordedItems[barcode];
    if (!item) return;
    els.itemName.value = item.itemName;
    els.itemId.value = item.itemId;
    els.itemBarcode.value = item.barcode;
    els.itemBarcode.disabled = true;
    els.itemImage.value = "";
    els.itemImagePreview.src = item.imageDataUrl || "";
    els.itemImagePreview.alt = item.imageDataUrl ? "Item image" : "";
  } else {
    els.itemName.value = "";
    els.itemId.value = "";
    els.itemBarcode.value = "";
    els.itemBarcode.disabled = false;
    els.itemImage.value = "";
    els.itemImagePreview.src = "";
    els.itemImagePreview.alt = "";
  }
}

function closeItemModal() {
  if (els.itemModal.hidden) return;
  els.itemModal.hidden = true;
  closeModalIfNoneOpen();
}

function saveItemFromForm() {
  const itemName = els.itemName.value.trim();
  const itemId = els.itemId.value.trim();
  const barcode = els.itemBarcode.value.trim();
  const imageDataUrl = els.itemImagePreview.src || "";
  const editingBarcode = els.itemEditingBarcode.value.trim();

  if (!itemName || !itemId || !barcode) {
    toast("Please fill in all fields.");
    return;
  }

  if (!imageDataUrl) {
    toast("Please choose a picture.");
    return;
  }

  if (!editingBarcode && state.recordedItems[barcode]) {
    toast("Barcode already exists.");
    return;
  }

  state.recordedItems[barcode] = { itemName, itemId, barcode, imageDataUrl };

  if (state.cards[barcode]) {
    state.cards[barcode] = { ...state.cards[barcode], itemName, itemId, barcode, imageDataUrl };
  }

  saveState();
  closeItemModal();
  toast(editingBarcode ? "Item updated." : "Item created.");
  render();
}

function openCardModal() {
  const items = Object.values(state.recordedItems);
  if (items.length === 0) {
    toast("No recorded items yet. Create an item first.");
    openDrawer();
    return;
  }
  openModal();
  els.cardModal.hidden = false;
  items.sort((a, b) => a.itemName.localeCompare(b.itemName));
  els.cardCreateList.innerHTML = items.map(renderRecordedItemRowForCardCreate).join("");
}

function renderRecordedItemRowForCardCreate(item) {
  const inBoard = Boolean(state.cards[item.barcode]);
  return `
    <div class="recorded" data-item="${escapeAttr(item.barcode)}">
      <img class="recorded__img" src="${escapeAttr(item.imageDataUrl || "")}" alt="" />
      <div>
        <div class="recorded__title">${escapeHtml(item.itemName)} - ${escapeHtml(item.itemId)}</div>
        <div class="recorded__meta">barcode: ${escapeHtml(item.barcode)}</div>
      </div>
      <div class="recorded__actions">
        <button class="btn btn--primary" type="button" data-action="create-card" ${inBoard ? "disabled" : ""}>
          + create
        </button>
      </div>
    </div>
  `;
}

function onCardCreateListClick(e) {
  const target = /** @type {HTMLElement} */ (e.target);
  const row = target.closest("[data-item]");
  if (!row) return;
  const barcode = row.getAttribute("data-item");
  if (!barcode) return;
  const action = target.closest("[data-action]")?.getAttribute("data-action");
  if (action !== "create-card") return;
  createCardFromRecordedItem(barcode);
  closeCardModal();
  render();
}

function closeCardModal() {
  if (els.cardModal.hidden) return;
  els.cardModal.hidden = true;
  closeModalIfNoneOpen();
}

function openModal() {
  els.modalOverlay.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeModalIfNoneOpen() {
  if (!els.itemModal.hidden || !els.cardModal.hidden) return;
  els.modalOverlay.hidden = true;
  document.body.style.overflow = "";
}

function createCardFromRecordedItem(barcode) {
  if (state.cards[barcode]) {
    toast("Card already exists for this barcode.");
    return;
  }
  const item = state.recordedItems[barcode];
  if (!item) {
    toast("Recorded item not found.");
    return;
  }
  state.cards[barcode] = {
    barcode: item.barcode,
    itemName: item.itemName,
    itemId: item.itemId,
    imageDataUrl: item.imageDataUrl,
    status: Status.IN_WAREHOUSE,
    location: "warehouse",
    puttingAwayAt: null,
  };
  state.order.warehouse.push(barcode);
  saveState();
  syncAssignmentForBarcode(barcode);
  toast("Card created in Warehouse Storage.");
}

function removeCard(barcode) {
  delete state.cards[barcode];
  for (const colKey of Object.keys(state.order)) {
    state.order[colKey] = state.order[colKey].filter((b) => b !== barcode);
  }
}

function moveCard(barcode, targetCol) {
  const card = state.cards[barcode];
  if (!card) return;
  if (card.status !== Status.IN_WAREHOUSE) {
    toast("Only “in warehouse” cards can be moved.");
    return;
  }

  if (!["warehouse", "kid1", "kid2"].includes(targetCol)) return;
  const fromCol = card.location;
  if (fromCol === targetCol) return;

  // Remove from old column.
  state.order[fromCol] = state.order[fromCol].filter((b) => b !== barcode);
  // Add to new column.
  state.order[targetCol].push(barcode);
  card.location = targetCol;
  if (targetCol === "warehouse") {
    card.status = Status.IN_WAREHOUSE;
  }
  saveState();
  syncAssignmentForBarcode(barcode);
  renderBoard();
  maybeTriggerFinish();
}

function randomizeWarehouseCards() {
  const warehouseCards = [...state.order.warehouse];
  if (warehouseCards.length === 0) {
    toast("No cards in Warehouse Storage.");
    return;
  }
  for (const barcode of warehouseCards) {
    const target = Math.random() < 0.5 ? "kid1" : "kid2";
    moveCard(barcode, target);
  }
  toast("Randomly placed warehouse cards into wish lists.");
}

function connectWs(showToasts) {
  const url = (els.wsUrl.value || "").trim() || DEFAULT_STATE.wsUrl;
  state.wsUrl = url;
  saveState();
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    updateWsIndicator();
    return;
  }

  try {
    ws = new WebSocket(url);
  } catch (err) {
    if (showToasts) toast("Invalid WebSocket URL.");
    ws = null;
    updateWsIndicator();
    return;
  }

  ws.addEventListener("open", () => {
    if (showToasts) toast("Scanner connected.");
    syncAssignmentsToHost();
    syncInteractiveToHost();
    updateWsIndicator();
  });
  ws.addEventListener("close", () => {
    if (showToasts) toast("Scanner disconnected.");
    updateWsIndicator();
  });
  ws.addEventListener("error", () => {
    if (showToasts) toast("Scanner connection error.");
    updateWsIndicator();
  });
  ws.addEventListener("message", (ev) => {
    handleWsMessage(ev.data);
  });

  updateWsIndicator();
}

function sendWs(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function desiredHostSignalForBarcode(barcode) {
  const card = state.cards[barcode];
  if (!card) return null;
  if (card.location === "kid1") return KidSignal.kid1;
  if (card.location === "kid2") return KidSignal.kid2;
  return null;
}

function syncAssignmentForBarcode(barcode) {
  const signal = desiredHostSignalForBarcode(barcode);
  sendWs({
    type: "assignment_update",
    source: "webapp",
    code: barcode,
    state: signal, // null/undefined => unassign
  });
}

function syncAssignmentsToHost() {
  const targets = {};
  for (const [barcode, card] of Object.entries(state.cards)) {
    if (!card) continue;
    if (card.location === "kid1") targets[barcode] = KidSignal.kid1;
    if (card.location === "kid2") targets[barcode] = KidSignal.kid2;
  }
  sendWs({ type: "assignment_sync", source: "webapp", targets });
}

function disconnectWs(showToasts) {
  if (!ws) return;
  try {
    ws.close();
  } catch {
    // ignore
  }
  ws = null;
  if (showToasts) toast("Scanner disconnected.");
  updateWsIndicator();
}

function updateWsIndicator() {
  const connected = ws?.readyState === WebSocket.OPEN;
  els.wsDot.classList.toggle("ws__dot--ok", Boolean(connected));
  els.wsLabel.textContent = connected ? "scanner: connected" : "scanner: disconnected";
  renderConsole();
}

function syncInteractiveToHost() {
  const connected = ws?.readyState === WebSocket.OPEN;
  if (!connected) return;
  const mode = state.console?.interactiveMode || "passive";
  sendWs({ type: "interactive_control", source: "webapp", mode });
}

function setInteractiveMode(mode, { didEnableAnyKey } = {}) {
  state.console = state.console || { interactiveMode: "passive" };
  state.console.interactiveMode = mode;
  saveState();
  renderConsole();
  sendWs({ type: "interactive_control", source: "webapp", mode });
}

async function ensureWsConnected() {
  if (ws?.readyState === WebSocket.OPEN) return true;
  connectWs(true);
  await waitForWsOpen(1200);
  return ws?.readyState === WebSocket.OPEN;
}

function waitForWsOpen(timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (ws?.readyState === WebSocket.OPEN) return resolve(true);
      if (Date.now() - start > timeoutMs) return resolve(false);
      window.setTimeout(tick, 50);
    };
    tick();
  });
}

async function onScanConsoleClick() {
  const connected = ws?.readyState === WebSocket.OPEN;
  if (!connected) {
    toast("Host not reachable. Start `python host/interactive_demo.py --any-key-red` first.");
    return;
  }
  state.console = state.console || { interactiveMode: "passive" };
  const mode = state.console.interactiveMode || "passive";
  if (mode === "passive") {
    setInteractiveMode("any_key_red");
    toast("Interactive any-key RED enabled.");
  } else {
    setInteractiveMode("passive");
    toast("Interactive any-key RED disabled.");
  }
}

function onConsoleKeyDown(e) {
  if (state.screen !== "kanban") return;
  const connected = ws?.readyState === WebSocket.OPEN;
  if (!connected) return;
  const mode = state.console?.interactiveMode || "passive";
  if (mode !== "any_key_red") return;
  if (isTypingContext()) return;
  // Any key triggers RED.
  sendWs({ type: "interactive_key", source: "webapp", key: e.key || "" });
}

function isTypingContext() {
  const el = document.activeElement;
  if (!el) return false;
  if (el instanceof HTMLInputElement) return true;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

function handleWsMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(String(raw));
  } catch {
    return;
  }

  if (msg?.type === "hello" && typeof msg.state === "string") {
    // Optional: host may include interactive mode.
    if (typeof msg.interactive_mode === "string") {
      const m = String(msg.interactive_mode);
      if (m === "stopped" || m === "passive" || m === "any_key_red") {
        state.console = state.console || { interactiveMode: "passive" };
        if (m === "any_key_red") state.console.interactiveMode = "any_key_red";
        if (m === "passive") state.console.interactiveMode = "passive";
        saveState();
        renderConsole();
      }
    }
  }

  if (msg?.type === "interactive_status" && typeof msg.mode === "string") {
    const m = String(msg.mode);
    if (m === "stopped" || m === "passive" || m === "any_key_red") {
      state.console = state.console || { interactiveMode: "passive" };
      if (m === "any_key_red") state.console.interactiveMode = "any_key_red";
      if (m === "passive") state.console.interactiveMode = "passive";
      saveState();
      renderConsole();
    }
  }

  if (msg?.type === "barcode_result" && typeof msg.code === "string") {
    const barcode = msg.code.trim();
    onBarcodeScanned(barcode);
    return;
  }

  if (msg?.type === "state_update" && typeof msg.state === "string") {
    const stateValue = msg.state.trim().toUpperCase();
    if (stateValue === "RED") onRedSignal();
  }
}

function onBarcodeScanned(barcode) {
  const card = state.cards[barcode];
  if (!card) return;
  if (card.location === "warehouse") return;
  if (card.status !== Status.IN_WAREHOUSE) return;
  card.status = Status.PUTTING_AWAY;
  card.puttingAwayAt = Date.now();
  activePuttingAwayBarcode = barcode;
  saveState();
  toast(`Scanned: ${barcode} → putting away…`);
  renderBoard();
}

function onRedSignal() {
  const barcode = pickPuttingAwayBarcode();
  if (!barcode) return;
  const card = state.cards[barcode];
  if (!card || card.status !== Status.PUTTING_AWAY) return;
  card.status = Status.COLLECTED;
  card.puttingAwayAt = null;
  if (activePuttingAwayBarcode === barcode) activePuttingAwayBarcode = null;
  saveState();
  toast(`Collected: ${barcode}`);
  renderBoard();
  maybeTriggerFinish();
}

function pickPuttingAwayBarcode() {
  const active = activePuttingAwayBarcode && state.cards[activePuttingAwayBarcode] ? activePuttingAwayBarcode : null;
  if (active && state.cards[active]?.status === Status.PUTTING_AWAY) return active;

  const candidates = Object.values(state.cards)
    .filter((c) => c && c.status === Status.PUTTING_AWAY && c.location !== "warehouse")
    .sort((a, b) => (Number(b.puttingAwayAt) || 0) - (Number(a.puttingAwayAt) || 0));
  return candidates[0]?.barcode || null;
}

function maybeTriggerFinish() {
  if (finishTimer) return;
  const barcodes = Object.keys(state.cards);
  if (barcodes.length === 0) return;

  const allPlaced = state.order.warehouse.length === 0;
  if (!allPlaced) return;

  const allCollected = barcodes.every((b) => state.cards[b]?.status === Status.COLLECTED);
  if (!allCollected) return;

  finishTimer = window.setTimeout(() => {
    finishTimer = null;
    navigate("finish");
  }, 900);
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  window.clearTimeout(els.toast.__t);
  // @ts-ignore
  els.toast.__t = window.setTimeout(() => {
    els.toast.hidden = true;
  }, 1700);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return deepClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    const next = deepClone(DEFAULT_STATE);
    next.screen = typeof parsed.screen === "string" ? parsed.screen : "welcome";
    if (parsed.columns && typeof parsed.columns === "object") {
      for (const key of ["warehouse", "kid1", "kid2"]) {
        next.columns[key] = { ...next.columns[key], ...(parsed.columns[key] || {}) };
      }
    }
    next.recordedItems = parsed.recordedItems || {};
    next.cards = parsed.cards || {};
    next.order = parsed.order || { warehouse: [], kid1: [], kid2: [] };
    next.wsUrl = typeof parsed.wsUrl === "string" ? parsed.wsUrl : DEFAULT_STATE.wsUrl;
    next.console =
      parsed.console && typeof parsed.console === "object"
        ? { ...next.console, ...parsed.console }
        : next.console;
    normalize(next);
    return next;
  } catch {
    return deepClone(DEFAULT_STATE);
  }
}

function normalize(s) {
  for (const colKey of ["warehouse", "kid1", "kid2"]) {
    if (!Array.isArray(s.order[colKey])) s.order[colKey] = [];
    s.order[colKey] = s.order[colKey].filter((b) => typeof b === "string" && s.cards[b]);
  }
  for (const barcode of Object.keys(s.cards)) {
    const card = s.cards[barcode];
    if (!card.location || !["warehouse", "kid1", "kid2"].includes(card.location)) card.location = "warehouse";
    if (!card.status || !Object.values(Status).includes(card.status)) card.status = Status.IN_WAREHOUSE;
    if (!("puttingAwayAt" in card)) card.puttingAwayAt = null;
    if (card.location === "warehouse") card.status = Status.IN_WAREHOUSE;
  }
  // Rebuild order arrays to include any missing cards.
  const seen = new Set(s.order.warehouse.concat(s.order.kid1, s.order.kid2));
  for (const barcode of Object.keys(s.cards)) {
    if (seen.has(barcode)) continue;
    const loc = s.cards[barcode].location || "warehouse";
    s.order[loc].push(barcode);
  }
}

function saveState() {
  const persist = {
    screen: state.screen,
    columns: state.columns,
    recordedItems: state.recordedItems,
    cards: state.cards,
    order: state.order,
    wsUrl: state.wsUrl,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persist));
  } catch {
    // Likely quota exceeded (base64 images). Keep the board state even if images can't persist.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stripImagesForStorage(persist)));
      toast("Storage full: saved board without images. Use smaller pictures.");
    } catch {
      // ignore
    }
  }
}

function stripImagesForStorage(persist) {
  const recordedItems = {};
  for (const [barcode, item] of Object.entries(persist.recordedItems || {})) {
    recordedItems[barcode] = { ...item, imageDataUrl: "" };
  }
  const cards = {};
  for (const [barcode, card] of Object.entries(persist.cards || {})) {
    cards[barcode] = { ...card, imageDataUrl: "" };
  }
  return { ...persist, recordedItems, cards };
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(s) {
  return escapeHtml(s).replaceAll("\n", " ");
}

function eventTargetElement(e) {
  const t = e?.target;
  if (t instanceof Element) return t;
  if (t instanceof Node) return t.parentElement;
  return null;
}

async function readFileAsDataUrl(file) {
  // Compress to reduce localStorage usage.
  const raw = await readFileAsDataUrlRaw(file);
  try {
    const compressed = await compressDataUrl(raw, { maxSize: 640, quality: 0.82 });
    return compressed || raw;
  } catch {
    return raw;
  }
}

function readFileAsDataUrlRaw(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

function compressDataUrl(dataUrl, { maxSize, quality }) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const { width, height } = img;
      if (!width || !height) return resolve("");
      const scale = Math.min(1, maxSize / Math.max(width, height));
      const outW = Math.max(1, Math.round(width * scale));
      const outH = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve("");
      ctx.drawImage(img, 0, 0, outW, outH);
      try {
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch {
        resolve("");
      }
    };
    img.onerror = () => resolve("");
    img.src = dataUrl;
  });
}

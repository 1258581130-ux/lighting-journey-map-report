(function () {
  "use strict";

  const STORAGE_PREFIX = "lightingJourneyMap:v1:";
  const REGISTRY_KEY = `${STORAGE_PREFIX}registry`;
  const JOURNEY_PREFIX = `${STORAGE_PREFIX}journey:`;
  const EVIDENCE_DB_NAME = "lightingJourneyMapEvidence:v1";
  const DASHBOARD_DB_NAME = "lightingJourneyDashboardDB";
  const DASHBOARD_SESSION_KEY = "lightingJourneyDashboard:lastSessionId";
  const DASHBOARD_STORE_SESSIONS = "dashboardSessions";
  const DASHBOARD_STORE_JOURNEYS = "journeys";
  const DASHBOARD_STORE_EVIDENCE = "evidenceFiles";
  const PUBLISHED_MANIFEST_PATH = "./data/published-manifest.json";
  const LEGACY_PEOPLE = ["张西珈", "戚日莲", "谢珊珊", "李娜"];
  const STAGES = [
    { id: 1, name: "第一次了解灯光设计服务", description: "从小红书、店铺、朋友、客服等渠道知道这个服务。" },
    { id: 2, name: "发起咨询", description: "主动问客服或设计师，想知道怎么做。" },
    { id: 3, name: "明确服务内容与价格", description: "了解服务包含什么、多少钱、是否返现、是否要买灯。" },
    { id: 4, name: "提交基础信息", description: "填问卷、说户型、说需求、说装修阶段。" },
    { id: 5, name: "准备并提交资料", description: "户型图、CAD、效果图、吊顶图、尺寸、现场照片等。" },
    { id: 6, name: "需求沟通与确认", description: "和客服 / 设计师进一步确认风格、区域、预算、功能。" },
    { id: 7, name: "等待方案", description: "等设计师出点位、参数、灯具建议或方案文件。" },
    { id: 8, name: "查看并理解方案", description: "看点位图、参数、灯具配置，判断自己能不能看懂。" },
    { id: 9, name: "修改确认 / 下单 / 施工衔接", description: "反馈修改、确认方案、买灯、和施工方对接。" }
  ];
  const EMOTIONS = {
    "-3": { emoji: "😫", label: "卡住了，想放弃" },
    "-2": { emoji: "😟", label: "有点焦虑 / 费劲" },
    "-1": { emoji: "😕", label: "有点疑惑" },
    "0": { emoji: "😐", label: "无明显感受" },
    "1": { emoji: "🙂", label: "还可以，没明显问题" },
    "2": { emoji: "😊", label: "顺畅，比较安心" },
    "3": { emoji: "🤩", label: "超预期，很惊喜" }
  };
  const REASON_BUCKETS = [
    { label: "资料准备不清楚", pattern: /资料|CAD|图纸|户型|效果图|吊顶|尺寸|照片/ },
    { label: "价格与服务边界不清楚", pattern: /价格|费用|收费|返现|买灯|包含|服务内容/ },
    { label: "沟通节奏或话术不清楚", pattern: /客服|回复|沟通|设计师|说明|问|话术/ },
    { label: "等待时间不确定", pattern: /等|等待|时间|多久|进度|什么时候/ },
    { label: "方案理解成本高", pattern: /方案|点位|参数|看不懂|理解|配置|符号/ },
    { label: "施工落地衔接不安", pattern: /施工|电工|落地|安装|确认|修改|下单/ }
  ];

  const state = {
    records: [],
    view: "summary",
    selectedJourneyId: "",
    pendingDeepLink: parseDashboardDeepLink(),
    deepLinkApplied: false,
    filters: {
      sampleType: "全部",
      dateRange: "全部",
      tag: "全部",
      completion: "全部"
    },
    individualMapMode: "overview",
    detailStageId: "",
    toastTimer: null,
    sessionId: localStorage.getItem(DASHBOARD_SESSION_KEY) || "",
    restoredSession: false,
    isRestoring: false,
    persistTimer: null,
    cloudSubscription: null,
    cloudRefreshTimer: null,
    cloudStatus: "",
    viewer: {
      evidenceItems: [],
      currentIndex: 0,
      objectUrl: "",
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      isDragging: false,
      dragStartX: 0,
      dragStartY: 0
    },
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches
  };

  const $ = (selector) => document.querySelector(selector);

  function defaultStage(stage) {
    return {
      id: stage.id,
      name: stage.name,
      description: stage.description,
      status: "已体验",
      goal: "",
      actions: "",
      touchpoints: [],
      thoughts: "",
      emotionScore: 0,
      emotionLabel: EMOTIONS[0].label,
      emotionReason: "",
      painSeverity: "没有",
      painPoint: "",
      opportunity: "",
      contentOpportunity: "",
      evidenceText: "",
      evidenceFiles: []
    };
  }

  function normalizeRecord(data) {
    const personName = data.personName || "未命名";
    const personId = data.personId || createId("person");
    return {
      version: 1,
      journeyId: data.journeyId || createId("journey"),
      personId,
      personName,
      experienceDate: data.experienceDate || "",
      personaRole: data.personaRole || "内部体验用户",
      sampleType: data.sampleType || "内部体验者",
      tags: Array.isArray(data.tags) ? data.tags : parseTags(data.tags),
      updatedAt: data.updatedAt || "",
      stages: STAGES.map((stage, index) => {
        const input = data.stages && data.stages[index] ? data.stages[index] : {};
        const score = Number(input.emotionScore || 0);
        return {
          ...defaultStage(stage),
          ...input,
          id: stage.id,
          name: stage.name,
          description: stage.description,
          emotionScore: score,
          emotionLabel: input.emotionLabel || EMOTIONS[String(Math.round(score))].label,
          emotionReason: input.emotionReason || "",
          touchpoints: Array.isArray(input.touchpoints) ? input.touchpoints : [],
          evidenceFiles: Array.isArray(input.evidenceFiles) ? input.evidenceFiles : []
        };
      })
    };
  }

  function getImportMode() {
    return document.querySelector("input[name='importMode']:checked").value;
  }

  function createId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function parseTags(value) {
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
    return String(value || "")
      .split(/[、,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function recordKey(record) {
    return record._dashboardKey || record.journeyId || `${record.personId || ""}:${record.personName}`;
  }

  function parseDashboardDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const link = {
      view: params.get("view") || "",
      journeyId: params.get("journeyId") || "",
      personName: params.get("personName") || "",
      stage: params.get("stage") || ""
    };
    return link.view || link.journeyId || link.personName || link.stage ? link : null;
  }

  function recordMatchesDeepLink(record, link) {
    if (!record || !link) return false;
    if (link.journeyId && (record.journeyId === link.journeyId || recordKey(record) === link.journeyId)) return true;
    if (link.personName && record.personName === link.personName) return true;
    return Boolean(link.personName && record.personName && record.personName.includes(link.personName));
  }

  function applyPendingDeepLink() {
    const link = state.pendingDeepLink;
    if (!link || state.deepLinkApplied || !state.records.length) return false;
    const record = state.records.find((item) => recordMatchesDeepLink(item, link));
    state.deepLinkApplied = true;
    if (!record) {
      showToast("没有找到链接指定的样本，请确认已导入对应 JSON / ZIP");
      return false;
    }
    state.view = link.view || "individual";
    if (link.personName || link.journeyId || link.stage) state.view = "individual";
    state.selectedJourneyId = recordKey(record);
    updateTabState();
    render();
    if (link.stage) {
      window.setTimeout(() => openStageDetail(link.stage), 80);
    }
    showToast(`已打开 ${record.personName}${link.stage ? ` · Stage ${String(link.stage).padStart(2, "0")}` : ""}`);
    return true;
  }

  function stableDuplicateKey(record) {
    return `${record.personName || ""}::${record.experienceDate || ""}`;
  }

  function readRegistry() {
    const raw = localStorage.getItem(REGISTRY_KEY);
    if (!raw) return { people: [] };
    try {
      const parsed = JSON.parse(raw);
      return { people: Array.isArray(parsed.people) ? parsed.people : [] };
    } catch {
      return { people: [] };
    }
  }

  function openEvidenceDb() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("当前浏览器不支持 IndexedDB"));
        return;
      }
      const request = indexedDB.open(EVIDENCE_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("evidenceFiles")) {
          db.createObjectStore("evidenceFiles", { keyPath: "storageKey" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function getEvidenceBlob(storageKey) {
    if (!storageKey) return Promise.resolve(null);
    return new Promise((resolve) => {
      openEvidenceDb().then((db) => {
        const transaction = db.transaction("evidenceFiles", "readonly");
        const store = transaction.objectStore("evidenceFiles");
        const request = store.get(storageKey);
        request.onsuccess = () => {
          db.close();
          resolve(request.result && request.result.blob ? request.result.blob : null);
        };
        request.onerror = () => {
          db.close();
          resolve(null);
        };
      }).catch(() => resolve(null));
    });
  }

  function openDashboardDb() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("当前浏览器不支持 IndexedDB"));
        return;
      }
      const request = indexedDB.open(DASHBOARD_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DASHBOARD_STORE_SESSIONS)) {
          db.createObjectStore(DASHBOARD_STORE_SESSIONS, { keyPath: "sessionId" });
        }
        if (!db.objectStoreNames.contains(DASHBOARD_STORE_JOURNEYS)) {
          db.createObjectStore(DASHBOARD_STORE_JOURNEYS, { keyPath: "dashboardJourneyKey" });
        }
        if (!db.objectStoreNames.contains(DASHBOARD_STORE_EVIDENCE)) {
          db.createObjectStore(DASHBOARD_STORE_EVIDENCE, { keyPath: "dashboardFileKey" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    });
  }

  function getDashboardFileKey(record, stage, file) {
    if (file.dashboardFileKey) return file.dashboardFileKey;
    const journeyKey = recordKey(record);
    const evidenceId = file.id || createId("evidence");
    file.id = evidenceId;
    file.dashboardFileKey = `${journeyKey}:stage-${stage.id}:${evidenceId}`;
    return file.dashboardFileKey;
  }

  function cloneRecordForSession(record) {
    const clone = structuredCloneSafe(record);
    delete clone._dashboardKey;
    delete clone.sourcePackageName;
    clone.dashboardJourneyKey = recordKey(record);
    clone.stages.forEach((stage) => {
      (stage.evidenceFiles || []).forEach((file) => {
        delete file._blob;
        delete file.viewerObjectUrl;
      });
    });
    return clone;
  }

  function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value, (key, item) => {
      if (key === "_blob" || key === "viewerObjectUrl") return undefined;
      return item;
    }));
  }

  async function saveDashboardSession() {
    if (state.isRestoring) return;
    if (!state.sessionId) {
      state.sessionId = createId("dashboard_session");
    }
    localStorage.setItem(DASHBOARD_SESSION_KEY, state.sessionId);
    const db = await openDashboardDb();
    try {
      const transaction = db.transaction([DASHBOARD_STORE_SESSIONS, DASHBOARD_STORE_JOURNEYS, DASHBOARD_STORE_EVIDENCE], "readwrite");
      const sessionStore = transaction.objectStore(DASHBOARD_STORE_SESSIONS);
      const journeyStore = transaction.objectStore(DASHBOARD_STORE_JOURNEYS);
      const evidenceStore = transaction.objectStore(DASHBOARD_STORE_EVIDENCE);
      const journeyIds = [];

      sessionStore.clear();
      journeyStore.clear();
      evidenceStore.clear();

      for (const record of state.records) {
        const key = recordKey(record);
        journeyIds.push(key);
        for (const stage of record.stages || []) {
          for (const file of stage.evidenceFiles || []) {
            if (!file._blob) continue;
            const dashboardFileKey = getDashboardFileKey(record, stage, file);
            file.hasOriginalFile = true;
            evidenceStore.put({
              dashboardFileKey,
              journeyId: record.journeyId || key,
              dashboardJourneyKey: key,
              stageId: stage.id,
              evidenceId: file.id,
              name: file.name || "evidence-file",
              type: file.type || file._blob.type || "application/octet-stream",
              size: file.size || file._blob.size || 0,
              category: file.category || categorizeEvidence(file),
              note: file.note || "",
              zipPath: file.zipPath || "",
              relativePath: file.zipPath || "",
              blob: normalizeEvidenceBlob(file, file._blob),
              updatedAt: new Date().toISOString()
            });
          }
        }
        journeyStore.put(cloneRecordForSession(record));
      }

      sessionStore.put({
        sessionId: state.sessionId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        journeyIds,
        activeView: state.view,
        selectedJourneyId: state.selectedJourneyId,
        importedCount: state.records.length
      });
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  }

  function scheduleDashboardSessionSave() {
    if (state.isRestoring) return;
    clearTimeout(state.persistTimer);
    state.persistTimer = window.setTimeout(() => {
      saveDashboardSession().catch((error) => showToast(`展示会话保存失败：${error.message}`));
    }, 180);
  }

  async function restoreDashboardSession() {
    const sessionId = localStorage.getItem(DASHBOARD_SESSION_KEY);
    if (!sessionId) {
      renderImportedList();
      renderFilters();
      return;
    }
    state.isRestoring = true;
    const db = await openDashboardDb();
    try {
      const sessionTransaction = db.transaction([DASHBOARD_STORE_SESSIONS, DASHBOARD_STORE_JOURNEYS, DASHBOARD_STORE_EVIDENCE], "readonly");
      const session = await requestToPromise(sessionTransaction.objectStore(DASHBOARD_STORE_SESSIONS).get(sessionId));
      if (!session || !Array.isArray(session.journeyIds) || !session.journeyIds.length) {
        state.isRestoring = false;
        renderImportedList();
        renderFilters();
        return;
      }
      const journeyStore = sessionTransaction.objectStore(DASHBOARD_STORE_JOURNEYS);
      const evidenceStore = sessionTransaction.objectStore(DASHBOARD_STORE_EVIDENCE);
      const records = [];
      for (const journeyKey of session.journeyIds) {
        const stored = await requestToPromise(journeyStore.get(journeyKey));
        if (!stored) continue;
        const record = normalizeRecord(stored);
        record._dashboardKey = stored.dashboardJourneyKey || journeyKey;
        await hydrateRecordEvidenceFromDashboardStore(record, evidenceStore);
        records.push(record);
      }
      await transactionDone(sessionTransaction);
      state.records = sortRecords(records);
      state.view = session.activeView || "summary";
      state.selectedJourneyId = session.selectedJourneyId && state.records.some((record) => recordKey(record) === session.selectedJourneyId)
        ? session.selectedJourneyId
        : (state.records[0] ? recordKey(state.records[0]) : "");
      state.sessionId = session.sessionId;
      state.restoredSession = Boolean(state.records.length);
      if (!applyPendingDeepLink()) {
        updateTabState();
        render();
      }
      if (state.records.length) {
        showToast("已恢复上次导入的展示数据");
      }
    } finally {
      state.isRestoring = false;
      db.close();
    }
  }

  async function hydrateRecordEvidenceFromDashboardStore(record, evidenceStore) {
    for (const stage of record.stages || []) {
      for (const file of stage.evidenceFiles || []) {
        if (!file.dashboardFileKey) continue;
        const storedFile = await requestToPromise(evidenceStore.get(file.dashboardFileKey));
        if (!storedFile || !storedFile.blob) continue;
        file._blob = normalizeEvidenceBlob(file, storedFile.blob);
        file.hasOriginalFile = true;
        file.sourcePackageName = storedFile.sourcePackageName || file.sourcePackageName || "";
      }
    }
  }

  async function clearDashboardSessionOnly() {
    await deleteDashboardDatabase();
    localStorage.removeItem(DASHBOARD_SESSION_KEY);
    state.sessionId = "";
    state.restoredSession = false;
  }

  function deleteDashboardDatabase() {
    return new Promise((resolve) => {
      if (!("indexedDB" in window)) {
        resolve();
        return;
      }
      const request = indexedDB.deleteDatabase(DASHBOARD_DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }

  async function getDashboardEvidenceBlob(dashboardFileKey) {
    if (!dashboardFileKey) return null;
    const db = await openDashboardDb();
    try {
      const transaction = db.transaction(DASHBOARD_STORE_EVIDENCE, "readonly");
      const storedFile = await requestToPromise(transaction.objectStore(DASHBOARD_STORE_EVIDENCE).get(dashboardFileKey));
      await transactionDone(transaction);
      return storedFile && storedFile.blob ? storedFile.blob : null;
    } catch {
      return null;
    } finally {
      db.close();
    }
  }

  function visibleRecords() {
    return state.records.filter((record) => {
      if (state.filters.sampleType !== "全部" && record.sampleType !== state.filters.sampleType) return false;
      if (state.filters.tag !== "全部" && !(record.tags || []).includes(state.filters.tag)) return false;
      if (state.filters.completion === "完整" && completionCount(record) < STAGES.length) return false;
      if (state.filters.completion === "未完整" && completionCount(record) >= STAGES.length) return false;
      if (state.filters.dateRange !== "全部" && record.experienceDate) {
        const days = state.filters.dateRange === "近7天" ? 7 : 30;
        const date = new Date(record.experienceDate);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        if (Number.isNaN(date.getTime()) || date < cutoff) return false;
      }
      return true;
    });
  }

  function stageHasData(stage) {
    if (!stage) return false;
    return Boolean(
      stage.goal ||
      stage.actions ||
      stage.thoughts ||
      stage.emotionReason ||
      stage.painPoint ||
      stage.opportunity ||
      stage.contentOpportunity ||
      stage.evidenceText ||
      (Array.isArray(stage.evidenceFiles) && stage.evidenceFiles.length)
    );
  }

  function completionCount(record) {
    return record.stages.filter(stageHasData).length;
  }

  function sortRecords(records) {
    return records.sort((a, b) => {
      const aIndex = LEGACY_PEOPLE.indexOf(a.personName);
      const bIndex = LEGACY_PEOPLE.indexOf(b.personName);
      if (aIndex === -1 && bIndex === -1) return a.personName.localeCompare(b.personName, "zh-CN");
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
  }

  async function mergeRecords(records, mode = getImportMode(), options = {}) {
    document.body.classList.add("is-importing");
    if (mode === "replace") {
      await clearDashboardSessionOnly();
      state.records = [];
      state.selectedJourneyId = "";
    }

    const byPerson = new Map(state.records.map((record) => [recordKey(record), record]));
    let added = 0;
    let skipped = 0;

    for (const inputRecord of records) {
      const record = normalizeRecord(inputRecord);
      const duplicate = findDuplicateRecord(record, Array.from(byPerson.values()));
      let key = recordKey(record);

      if (duplicate) {
        const decision = options.duplicateStrategy || await askDuplicateAction(record, duplicate);
        if (decision === "cancel") {
          skipped += 1;
          continue;
        }
        if (decision === "overwrite") {
          byPerson.delete(recordKey(duplicate));
        }
        if (decision === "keep") {
          record._dashboardKey = createId("import");
          key = recordKey(record);
        }
      }

      byPerson.set(key, record);
      added += 1;
    }

    state.records = sortRecords(Array.from(byPerson.values()));
    if (!state.records.some((record) => recordKey(record) === state.selectedJourneyId)) {
      state.selectedJourneyId = state.records[0] ? recordKey(state.records[0]) : "";
    }
    if (!applyPendingDeepLink()) render();
    scheduleDashboardSessionSave();
    window.setTimeout(() => document.body.classList.remove("is-importing"), state.reducedMotion ? 0 : 720);
    if (!options.silent) {
      showToast(`已导入 ${added} 份数据${skipped ? `，跳过 ${skipped} 份` : ""}`);
    }
  }

  async function loadCloudRecords(options = {}) {
    if (!window.LightingCloud || !window.LightingCloud.isEnabled()) {
      state.cloudStatus = "Supabase 未启用。请先填写 assets/supabase-config.js。";
      renderCloudNotice();
      if (!options.silent) showToast("云端同步未启用，请先完成 Supabase 配置。");
      return;
    }
    state.cloudStatus = "正在读取云端旅程数据";
    renderCloudNotice();
    const records = await window.LightingCloud.fetchJourneys();
    await mergeRecords(records, "append", {
      duplicateStrategy: "overwrite",
      silent: true
    });
    state.cloudStatus = records.length
      ? `已连接云端，当前读取 ${records.length} 份样本。展示页会实时更新。`
      : "已连接云端，暂时还没有提交的样本。";
    renderCloudNotice();
    if (!options.silent) showToast(records.length ? `已读取 ${records.length} 份云端样本` : "云端暂时没有样本");
  }

  function initCloudSync() {
    renderCloudNotice();
    if (!window.LightingCloud || !window.LightingCloud.isEnabled()) return;
    loadCloudRecords({ silent: true }).catch((error) => {
      state.cloudStatus = `云端读取失败：${error.message}`;
      renderCloudNotice();
    });
    state.cloudSubscription = window.LightingCloud.subscribeToJourneys(() => {
      clearTimeout(state.cloudRefreshTimer);
      state.cloudRefreshTimer = window.setTimeout(() => {
        loadCloudRecords({ silent: true }).catch((error) => {
          state.cloudStatus = `云端更新失败：${error.message}`;
          renderCloudNotice();
        });
      }, 520);
    });
    state.cloudStatus = "云端实时同步已开启。";
    renderCloudNotice();
  }

  function findDuplicateRecord(record, records) {
    return records.find((item) => (
      (record.journeyId && item.journeyId && record.journeyId === item.journeyId)
      || (record.personName && record.experienceDate && stableDuplicateKey(record) === stableDuplicateKey(item))
    ));
  }

  function askDuplicateAction(record, duplicate) {
    const dialog = $("#duplicateDialog");
    const message = $("#duplicateMessage");
    if (!dialog || !message || typeof dialog.showModal !== "function") {
      const overwrite = window.confirm(`检测到可能重复的样本「${record.personName}」。确定覆盖旧版本吗？取消则保留两个版本。`);
      return Promise.resolve(overwrite ? "overwrite" : "keep");
    }
    message.textContent = `「${record.personName}」与已导入的「${duplicate.personName}」可能是同一份样本。默认建议保留两个版本，避免误删测试数据。`;
    return new Promise((resolve) => {
      const form = dialog.querySelector("form");
      const finish = () => {
        dialog.removeEventListener("close", finish);
        resolve(dialog.returnValue || "keep");
      };
      dialog.addEventListener("close", finish, { once: true });
      dialog.showModal();
      form.querySelector("[value='keep']").focus();
    });
  }

  function askSoftConfirm({ title, message, confirmLabel = "确认" }) {
    const dialog = $("#confirmDialog");
    const titleElement = $("#confirmTitle");
    const messageElement = $("#confirmMessage");
    const acceptButton = $("#confirmAcceptButton");
    if (!dialog || !titleElement || !messageElement || !acceptButton || typeof dialog.showModal !== "function") {
      return Promise.resolve(window.confirm(message));
    }
    titleElement.textContent = title;
    messageElement.textContent = message;
    acceptButton.textContent = confirmLabel;
    return new Promise((resolve) => {
      const finish = () => {
        dialog.removeEventListener("close", finish);
        resolve(dialog.returnValue === "confirm");
      };
      dialog.addEventListener("close", finish, { once: true });
      dialog.showModal();
      dialog.querySelector("[value='cancel']").focus();
    });
  }

  async function loadLocalRecords() {
    const records = [];
    const registry = readRegistry();
    registry.people.forEach((person) => {
      const raw = localStorage.getItem(`${JOURNEY_PREFIX}${person.journeyId}`);
      if (!raw) return;
      try {
        records.push(JSON.parse(raw));
      } catch {
        // skip broken cache entries
      }
    });
    LEGACY_PEOPLE.forEach((name) => {
      const raw = localStorage.getItem(`${STORAGE_PREFIX}${name}`);
      if (!raw) return;
      try {
        records.push(JSON.parse(raw));
      } catch {
        // skip broken legacy entries
      }
    });
    if (!records.length) {
      showToast("本机缓存里暂时没有填写记录");
      return;
    }
    await mergeRecords(records);
  }

  async function readFiles(files) {
    const records = [];
    for (const file of files) {
      const name = String(file.name || "").toLowerCase();
      if (name.endsWith(".zip") || file.type.includes("zip")) {
        records.push(await readZipPackage(file));
      } else {
        const text = await file.text();
        records.push(JSON.parse(text));
      }
    }
    await mergeRecords(records);
    $("#jsonInput").value = "";
  }

  async function loadPublishedPackagesIfNeeded() {
    if (state.records.length) return;
    let manifest;
    try {
      const response = await fetch(PUBLISHED_MANIFEST_PATH, { cache: "no-store" });
      if (!response.ok) return;
      manifest = await response.json();
    } catch {
      return;
    }
    const packages = Array.isArray(manifest.packages) ? manifest.packages : [];
    if (!packages.length) return;
    showToast("正在加载发布版旅程数据，请稍候…");
    const records = [];
    for (const item of packages) {
      const response = await fetch(item.url);
      if (!response.ok) throw new Error(`无法读取 ${item.name || item.url}`);
      const blob = await response.blob();
      const file = new File([blob], item.url.split("/").pop() || `${item.name || "journey"}.zip`, { type: "application/zip" });
      records.push(await readZipPackage(file));
    }
    await mergeRecords(records, "append", { silent: true });
    state.restoredSession = true;
    showToast(`已加载 ${records.length} 份发布版旅程数据`);
  }

  async function readZipPackage(file) {
    if (!window.JSZip) throw new Error("证据包组件未加载，请刷新页面后再试。");
    const zip = await window.JSZip.loadAsync(file);
    const journeyEntry = Object.values(zip.files).find((entry) => !entry.dir && entry.name.split("/").pop() === "journey.json");
    if (!journeyEntry) throw new Error(`${file.name} 中没有找到 journey.json`);
    const journey = JSON.parse(await journeyEntry.async("text"));
    const record = normalizeRecord(journey);
    record.sourcePackageName = file.name;
    await hydrateRecordEvidenceFromZip(record, zip, file.name);
    return record;
  }

  async function hydrateRecordEvidenceFromZip(record, zip, packageName) {
    const entries = Object.values(zip.files).filter((entry) => !entry.dir);
    for (const stage of record.stages) {
      const files = Array.isArray(stage.evidenceFiles) ? stage.evidenceFiles : [];
      for (const evidence of files) {
        const entry = findEvidenceEntry(evidence, entries);
        if (!entry) continue;
        const blob = await entry.async("blob");
        evidence.hasOriginalFile = true;
        evidence.zipPath = evidence.zipPath || entry.name;
        evidence.sourcePackageName = packageName;
        evidence._blob = blob;
      }
    }
  }

  function findEvidenceEntry(evidence, entries) {
    const zipPath = normalizeZipPath(evidence.zipPath);
    if (zipPath) {
      const exact = entries.find((entry) => normalizeZipPath(entry.name) === zipPath);
      if (exact) return exact;
    }
    const name = String(evidence.name || "").toLowerCase();
    if (!name) return null;
    return entries.find((entry) => entry.name.toLowerCase().endsWith(`/${name}`) || entry.name.toLowerCase() === name) || null;
  }

  function normalizeZipPath(value) {
    return String(value || "").replace(/^\/+/, "").replaceAll("\\", "/");
  }

  async function clearCurrentData() {
    if (!state.records.length) {
      showToast("当前没有导入数据");
      return;
    }
    const confirmed = await askSoftConfirm({
      title: "清空当前展示数据？",
      message: "这只会清空展示页已经导入的 JSON / ZIP 数据，不会删除填写页草稿，也不会删除你电脑上的 JSON / ZIP 文件。",
      confirmLabel: "清空展示"
    });
    if (!confirmed) return;
    document.body.classList.add("is-clearing");
    clearTimeout(state.persistTimer);
    window.setTimeout(async () => {
      state.records = [];
      state.selectedJourneyId = "";
      try {
        await clearDashboardSessionOnly();
        $("#jsonInput").value = "";
        render();
        showToast("当前展示数据已清空，可以重新导入新的 JSON");
      } catch (error) {
        showToast(`展示缓存清理失败：${error.message}`);
      } finally {
        document.body.classList.remove("is-clearing");
      }
    }, state.reducedMotion ? 0 : 260);
  }

  function deleteEvidenceDatabase() {
    return new Promise((resolve) => {
      if (!("indexedDB" in window)) {
        resolve();
        return;
      }
      const request = indexedDB.deleteDatabase(EVIDENCE_DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }

  async function clearDraftCache() {
    const confirmed = await askSoftConfirm({
      title: "清空填写缓存？",
      message: "这会删除填写器自动保存的草稿和填写页证据文件，但不会删除展示页已经导入的会话，也不会删除你电脑上的 JSON / ZIP 文件。",
      confirmLabel: "清空填写缓存"
    });
    if (!confirmed) return;
    const registry = readRegistry();
    registry.people.forEach((person) => localStorage.removeItem(`${JOURNEY_PREFIX}${person.journeyId}`));
    LEGACY_PEOPLE.forEach((name) => localStorage.removeItem(`${STORAGE_PREFIX}${name}`));
    localStorage.removeItem(REGISTRY_KEY);
    await deleteEvidenceDatabase();
    showToast("填写缓存已清空");
  }

  async function clearAllLocalCache() {
    const confirmed = await askSoftConfirm({
      title: "清空全部本地缓存？",
      message: "这会清空浏览器本地保存的填写草稿和展示页导入记录，但不会删除你电脑上已经下载的 JSON / ZIP 文件。",
      confirmLabel: "清空全部缓存"
    });
    if (!confirmed) return;
    await clearDashboardSessionOnly();
    const registry = readRegistry();
    registry.people.forEach((person) => localStorage.removeItem(`${JOURNEY_PREFIX}${person.journeyId}`));
    LEGACY_PEOPLE.forEach((name) => localStorage.removeItem(`${STORAGE_PREFIX}${name}`));
    localStorage.removeItem(REGISTRY_KEY);
    await deleteEvidenceDatabase();
    state.records = [];
    state.selectedJourneyId = "";
    render();
    showToast("全部本地缓存已清空");
  }

  function removePerson(key) {
    const removed = state.records.find((record) => recordKey(record) === key);
    state.records = state.records.filter((record) => recordKey(record) !== key);
    if (removed && state.selectedJourneyId === recordKey(removed)) {
      state.selectedJourneyId = state.records[0] ? recordKey(state.records[0]) : "";
    }
    render();
    if (state.records.length) {
      scheduleDashboardSessionSave();
    } else {
      clearDashboardSessionOnly().catch((error) => showToast(`展示缓存清理失败：${error.message}`));
    }
    showToast(`已移除 ${removed ? removed.personName : "该样本"}`);
  }

  function setView(view) {
    state.view = view;
    if (view !== "individual") closeStageDetail({ silent: true });
    updateTabState();
    render();
    scheduleDashboardSessionSave();
  }

  function updateTabState() {
    document.querySelectorAll(".tab-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === state.view);
    });
  }

  function render() {
    renderImportedList();
    renderFilters();
    renderRestoreNotice();
    renderCloudNotice();
    if (!state.records.length) {
      $("#reportSurface").innerHTML = `
        <div class="empty-state report-reveal">
          <p class="eyebrow">Waiting For Data</p>
          <h2>还没有导入旅程数据</h2>
          <p>先在填写器导出个人 JSON，再回到这里导入；也可以直接读取本机缓存。</p>
        </div>
      `;
      return;
    }
    if (!visibleRecords().length) {
      $("#reportSurface").innerHTML = `
        <div class="empty-state report-reveal">
          <p class="eyebrow">No Matched Samples</p>
          <h2>当前筛选下没有样本</h2>
          <p>可以放宽样本类型、标签或完整度筛选，汇总会基于筛选后的样本重新计算。</p>
        </div>
      `;
      return;
    }
    $("#reportSurface").innerHTML = state.view === "summary" ? renderSummary() : renderIndividual();
    requestAnimationFrame(() => {
      $("#reportSurface").classList.remove("report-ready");
      void $("#reportSurface").offsetWidth;
      $("#reportSurface").classList.add("report-ready");
    });
    bindPersonSwitcher();
    bindJourneyMapControls();
    bindEvidenceCards();
  }

  function renderImportedList() {
    const summary = $("#importedSummary");
    const list = $("#importedList");
    if (!state.records.length) {
      summary.textContent = "暂无数据";
      list.innerHTML = "";
      return;
    }
    summary.textContent = "";
    list.innerHTML = state.records.map((record) => `
      <span class="person-chip">
        <span class="chip-name">${escapeHtml(record.personName)}</span>
        <span class="chip-meta">${escapeHtml([record.sampleType, ...(record.tags || []).slice(0, 2)].filter(Boolean).join(" · "))}</span>
        <button type="button" data-remove-person="${escapeHtml(recordKey(record))}" aria-label="移除 ${escapeHtml(record.personName)}">×</button>
      </span>
    `).join("");
    list.querySelectorAll("[data-remove-person]").forEach((button) => {
      button.addEventListener("click", () => removePerson(button.dataset.removePerson));
    });
  }

  function renderRestoreNotice() {
    const notice = $("#sessionRestoreNotice");
    const names = $("#restoredSampleNames");
    if (!notice || !names) return;
    if (!state.restoredSession || !state.records.length) {
      notice.hidden = true;
      names.textContent = "";
      return;
    }
    notice.hidden = false;
    const sampleNames = state.records.map((record) => record.personName).filter(Boolean);
    names.textContent = sampleNames.length
      ? `${sampleNames.join("、")}（共 ${state.records.length} 份）`
      : `共 ${state.records.length} 份旅程数据`;
  }

  function renderCloudNotice() {
    const notice = $("#cloudSyncNotice");
    const status = $("#cloudSyncStatus");
    if (!notice || !status) return;
    const enabled = Boolean(window.LightingCloud && window.LightingCloud.isEnabled());
    if (!enabled && !state.cloudStatus) {
      notice.hidden = true;
      return;
    }
    notice.hidden = false;
    status.textContent = state.cloudStatus || "Supabase 已配置，展示页会读取云端旅程数据。";
  }

  function renderFilters() {
    const sampleTypes = uniqueValues(state.records.map((record) => record.sampleType).filter(Boolean));
    const tags = uniqueValues(state.records.flatMap((record) => record.tags || []));
    fillFilter("#sampleTypeFilter", ["全部", ...sampleTypes], state.filters.sampleType);
    fillFilter("#tagFilter", ["全部", ...tags], state.filters.tag);
    $("#dateFilter").value = state.filters.dateRange;
    $("#completionFilter").value = state.filters.completion;
  }

  function fillFilter(selector, options, value) {
    const select = $(selector);
    if (!select) return;
    select.innerHTML = options.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
    select.value = options.includes(value) ? value : "全部";
  }

  function uniqueValues(values) {
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "zh-CN"));
  }

  function renderSummary() {
    const summary = buildSummary();
    const records = visibleRecords();
    return `
      <article id="captureTarget">
        <header class="report-header">
          <div>
            <p class="eyebrow">Sample Summary</p>
            <h2>多人汇总旅程地图</h2>
            <p class="notice">当前统计 ${records.length} / ${state.records.length} 份样本：${records.map((record) => escapeHtml(record.personName)).join("、")}</p>
          </div>
        </header>

        <div class="metric-grid sequence-group">
          <div class="metric"><span>最低谷阶段</span><strong>${escapeHtml(summary.lowest.name)}</strong></div>
          <div class="metric"><span>最高峰阶段</span><strong>${escapeHtml(summary.highest.name)}</strong></div>
          <div class="metric"><span>平均情绪</span><strong>${formatScore(summary.overallAverage)}</strong></div>
          <div class="metric"><span>明显及严重痛点</span><strong>${summary.totalPain}</strong></div>
        </div>

        <div class="report-chart sequence-item">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Average Emotion</p>
              <h2>样本平均情绪曲线</h2>
            </div>
          </div>
          ${renderCurve(summary.stageStats, "summary")}
          ${renderReasonSummary(summary.stageStats)}
        </div>

        <table class="stage-table sequence-item">
          <thead>
            <tr><th>阶段</th><th>情绪均值</th><th>参与统计</th><th>痛点数量</th><th>证据数量</th><th>主要信号</th></tr>
          </thead>
          <tbody>
            ${summary.stageStats.map((item) => `
              <tr>
                <td>${escapeHtml(item.name)}</td>
                <td>${formatScore(item.average)}</td>
                <td>${item.participantCount} / ${records.length}</td>
                <td>${item.painCount}</td>
                <td>${item.evidenceCount}</td>
                <td>${escapeHtml(item.signal)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>

        <div class="insight-grid sequence-group">
          ${renderInsight("高频痛点", summary.painKeywords)}
          ${renderInsight("高频机会点", summary.opportunityKeywords)}
          ${renderInsight("内容选题机会", summary.contentKeywords)}
          ${renderInsight("服务流程优化建议", summary.serviceSuggestions)}
          ${renderInsight("内容 SOP 沉淀建议", summary.sopSuggestions)}
          ${renderInsight("信息缺口", summary.gaps)}
          ${renderInsight("证据统计", summary.evidenceStats)}
        </div>
      </article>
    `;
  }

  function renderIndividual() {
    const records = visibleRecords();
    const record = records.find((item) => recordKey(item) === state.selectedJourneyId) || records[0];
    state.selectedJourneyId = recordKey(record);
    const completed = completionCount(record);
    return `
      <article id="captureTarget">
        <header class="report-header">
          <div>
            <p class="eyebrow">Individual Journey Map</p>
            <h2>${escapeHtml(record.personName)}的用户旅程地图</h2>
            <p class="notice">体验日期：${escapeHtml(record.experienceDate || "未填写")} · 体验身份：${escapeHtml(record.personaRole || "未填写")} · 样本类型：${escapeHtml(record.sampleType || "未填写")} · 标签：${escapeHtml((record.tags || []).join("、") || "无")} · 完成进度：${completed} / 9</p>
          </div>
        </header>
        <div class="person-switcher sequence-item" aria-label="样本列表">
          ${records.map((item) => `<button type="button" data-journey="${escapeHtml(recordKey(item))}" class="${recordKey(item) === recordKey(record) ? "active" : ""}">${escapeHtml(item.personName)}<span>${escapeHtml(item.sampleType || "样本")}</span></button>`).join("")}
        </div>
        <div class="report-chart sequence-item">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Emotion Curve</p>
              <h2>个人情绪曲线</h2>
            </div>
          </div>
          ${renderCurve(record.stages, "individual")}
        </div>
        <div class="section-heading sequence-item journey-map-toolbar">
          <div>
            <p class="eyebrow">Journey Map Grid</p>
            <h2>横向旅程地图</h2>
          </div>
          <div class="map-mode-toggle" aria-label="个人地图视图">
            <button type="button" data-map-mode="overview" class="${state.individualMapMode === "overview" ? "active" : ""}">汇报总览</button>
            <button type="button" data-map-mode="detail" class="${state.individualMapMode === "detail" ? "active" : ""}">详细查看</button>
          </div>
        </div>
        ${renderJourneyMapGrid(record)}
      </article>
    `;
  }

  function renderJourneyMapGrid(record) {
    const stages = record.stages || [];
    const rows = [
      { key: "goal", label: "用户目标", className: "text-row", render: (stage) => renderTextCell(stage.goal || stage.status, 4, stage) },
      { key: "actions", label: "关键行为", className: "text-row", render: (stage) => renderTextCell(stage.actions, 4, stage) },
      { key: "touchpoints", label: "接触点", className: "touchpoint-row", render: renderTouchpointCell },
      { key: "thoughts", label: "真实想法", className: "text-row", render: (stage) => renderTextCell(stage.thoughts, 4, stage) },
      { key: "emotion", label: "情绪", className: "emotion-row", render: renderEmotionMapCell },
      { key: "pain", label: "痛点", className: "compact-row", render: renderPainMapCell },
      { key: "opportunity", label: "机会 / 内容机会", className: "compact-row", render: renderOpportunityMapCell },
      { key: "evidence", label: "证据", className: "evidence-row", render: renderEvidenceSummary }
    ];
    return `
      <div class="journey-map-shell sequence-item">
        <div class="journey-map-scroll-hint">横向滚动查看完整 9 个阶段，点击任意单元格查看完整阶段详情。</div>
        <div class="journey-map-grid ${state.individualMapMode === "detail" ? "detail-mode" : "overview-mode"}" style="--stage-count: ${stages.length}">
          <div class="journey-cell row-label stage-header map-corner">字段</div>
          ${stages.map(renderStageHeaderCell).join("")}
          ${rows.map((row) => `
            <div class="journey-cell row-label ${row.className}">${escapeHtml(row.label)}</div>
            ${stages.map((stage) => `
              <div class="journey-cell map-cell ${row.className}" data-open-stage-detail="${escapeHtml(stage.id)}" role="button" tabindex="0">
                ${row.render(stage)}
              </div>
            `).join("")}
          `).join("")}
        </div>
      </div>
    `;
  }

  function renderStageHeaderCell(stage) {
    return `
      <div class="journey-cell stage-header map-cell" data-open-stage-detail="${escapeHtml(stage.id)}" role="button" tabindex="0">
        <span class="cell-label">Stage ${String(stage.id).padStart(2, "0")}</span>
        <strong>${escapeHtml(stage.name)}</strong>
        <small>${escapeHtml(stage.description || "")}</small>
      </div>
    `;
  }

  function renderTextCell(value, lines = 4, stage = null) {
    const text = String(value || "").trim();
    return `
      <div class="cell-text clamp-${lines}">${escapeHtml(text || "未填写").replace(/\n/g, "<br>")}</div>
      ${stage && text.length > (lines === 4 ? 72 : 48) ? `<button class="detail-link" type="button" data-open-stage-detail="${escapeHtml(stage.id)}">查看详情</button>` : ""}
    `;
  }

  function renderTouchpointCell(stage) {
    return `<div class="cell-tags">${renderTags(stage.touchpoints)}</div>`;
  }

  function renderEmotionMapCell(stage) {
    const score = Number(stage.emotionScore);
    const rounded = clampScore(Math.round(score));
    const emotion = EMOTIONS[String(rounded)];
    return `
      <div class="map-emotion">
        <strong>${formatScore(score)}</strong>
        <span>${emotion.emoji} ${escapeHtml(stage.emotionLabel || emotion.label)}</span>
        <p class="cell-text reason clamp-2">${escapeHtml(stage.emotionReason || "暂无情绪原因")}</p>
      </div>
    `;
  }

  function renderPainMapCell(stage) {
    const severity = stage.painSeverity || "没有";
    const pain = stage.painPoint || (severity === "没有" ? "无" : "未填写具体痛点");
    return `
      <div class="cell-stack">
        <span class="mini-label">${escapeHtml(severity)}</span>
        <p class="cell-text compact clamp-3">${escapeHtml(pain).replace(/\n/g, "<br>")}</p>
      </div>
    `;
  }

  function renderOpportunityMapCell(stage) {
    const opportunity = stage.opportunity || "未填写";
    const content = stage.contentOpportunity || "";
    return `
      <div class="cell-stack">
        <p class="cell-text compact clamp-3">${escapeHtml(opportunity).replace(/\n/g, "<br>")}</p>
        ${content ? `<p class="cell-text subtle clamp-2">${escapeHtml(content).replace(/\n/g, "<br>")}</p>` : ""}
      </div>
    `;
  }

  function renderEvidenceSummary(stage) {
    const files = Array.isArray(stage.evidenceFiles) ? stage.evidenceFiles : [];
    const evidenceText = String(stage.evidenceText || "").trim();
    if (!files.length && !evidenceText) return "未填写";
    const imageFiles = files.filter((file) => (file.category || categorizeEvidence(file)) === "image").slice(0, 2);
    const fileCard = files.find((file) => (file.category || categorizeEvidence(file)) !== "image");
    const visibleIds = new Set([...imageFiles, fileCard].filter(Boolean).map((file) => file.id));
    const hiddenCount = files.filter((file) => !visibleIds.has(file.id)).length + (evidenceText ? 1 : 0);
    return `
      <div class="journey-evidence summary">
        ${evidenceText ? `<p class="cell-text clamp-2">${escapeHtml(truncateText(evidenceText, 48))}</p>` : ""}
        <div class="evidence-summary-grid">
          ${imageFiles.map((file) => renderEvidenceMini(file, stage)).join("")}
          ${fileCard ? renderEvidenceMini(fileCard, stage) : ""}
        </div>
        ${hiddenCount || files.length > visibleIds.size ? `<button class="detail-link" type="button" data-open-stage-detail="${escapeHtml(stage.id)}">查看全部证据，共 ${files.length + (evidenceText ? 1 : 0)} 份</button>` : ""}
      </div>
    `;
  }

  function renderJourneyEvidence(stage) {
    const files = Array.isArray(stage.evidenceFiles) ? stage.evidenceFiles : [];
    const evidenceText = String(stage.evidenceText || "").trim();
    if (!files.length && !evidenceText) return "未填写";
    const visibleFiles = files.slice(0, 3);
    const extraFiles = files.slice(3);
    return `
      <div class="journey-evidence">
        ${evidenceText ? `<p>${escapeHtml(truncateText(evidenceText, 56))}</p>` : ""}
        ${visibleFiles.map((file) => renderEvidenceMini(file, stage)).join("")}
        ${extraFiles.length ? `
          <details class="evidence-more">
            <summary>查看全部证据（另有 ${extraFiles.length} 份）</summary>
            ${extraFiles.map((file) => renderEvidenceMini(file, stage)).join("")}
          </details>
        ` : ""}
      </div>
    `;
  }

  function renderEvidenceMini(file, stage) {
    const label = fileTypeLabel(file);
    const thumbnail = file.thumbnailDataUrl || file.previewDataUrl || "";
    const category = file.category || categorizeEvidence(file);
    const hasBody = hasFileBody(file);
    if (category === "image" && thumbnail) {
      return `
        <button class="evidence-mini evidence-open-card image" type="button" data-stage-id="${escapeHtml(stage.id)}" data-evidence-id="${escapeHtml(file.id)}">
          <img src="${escapeHtml(thumbnail)}" alt="${escapeHtml(file.name)}">
          <figcaption>${escapeHtml(file.note || file.name)}</figcaption>
          <small>查看</small>
        </button>
      `;
    }
    return `
      <button class="evidence-mini evidence-open-card file" type="button" data-stage-id="${escapeHtml(stage.id)}" data-evidence-id="${escapeHtml(file.id)}">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(file.name || "未命名文件")}</strong>
        <small>${hasBody || file.hasOriginalFile ? "查看信息 / 下载" : "导入 ZIP 后下载"}</small>
        ${file.note ? `<em>${escapeHtml(file.note)}</em>` : ""}
      </button>
    `;
  }

  function renderStageDetailDrawer(record, stageId = state.detailStageId) {
    const stage = record.stages.find((item) => String(item.id) === String(stageId));
    if (!stage) return "";
    const score = Number(stage.emotionScore);
    const rounded = clampScore(Math.round(score));
    const emotion = EMOTIONS[String(rounded)];
    return `
      <button class="stage-detail-backdrop open" type="button" data-close-stage-detail aria-label="关闭阶段详情"></button>
      <aside class="stage-detail-drawer open" aria-label="${escapeHtml(stage.name)} 阶段详情">
        <header>
          <div>
            <p class="eyebrow">Stage ${String(stage.id).padStart(2, "0")}</p>
            <h2>${escapeHtml(stage.name)}</h2>
            <p>${escapeHtml(stage.description || "")}</p>
          </div>
          <button class="ghost-button" type="button" data-close-stage-detail>关闭</button>
        </header>
        <div class="stage-detail-content">
          ${renderDetailBlock("用户目标", stage.goal || stage.status)}
          ${renderDetailBlock("关键行为", stage.actions)}
          ${renderDetailBlock("接触点", renderTags(stage.touchpoints), true)}
          ${renderDetailBlock("真实想法", stage.thoughts)}
          ${renderDetailBlock("情绪", `<div class="detail-emotion"><strong>${formatScore(score)}</strong><span>${emotion.emoji} ${escapeHtml(stage.emotionLabel || emotion.label)}</span><p>${escapeHtml(stage.emotionReason || "暂无情绪原因")}</p></div>`, true)}
          ${renderDetailBlock("痛点", `${stage.painSeverity || "没有"}：${stage.painPoint || "无"}`)}
          ${renderDetailBlock("机会点", stage.opportunity)}
          ${renderDetailBlock("内容机会", stage.contentOpportunity)}
          ${renderDetailBlock("证据", renderDetailEvidence(stage), true)}
        </div>
      </aside>
    `;
  }

  function renderDetailBlock(label, value, html = false) {
    const content = html ? value : escapeHtml(value || "未填写").replace(/\n/g, "<br>");
    return `
      <section class="stage-detail-block">
        <h3>${escapeHtml(label)}</h3>
        <div>${content}</div>
      </section>
    `;
  }

  function renderDetailEvidence(stage) {
    const files = Array.isArray(stage.evidenceFiles) ? stage.evidenceFiles : [];
    const evidenceText = String(stage.evidenceText || "").trim();
    if (!files.length && !evidenceText) return `<p class="muted-copy">暂无证据。</p>`;
    return `
      <div class="detail-evidence-list">
        ${evidenceText ? `<p class="evidence-text-full">${escapeHtml(evidenceText).replace(/\n/g, "<br>")}</p>` : ""}
        ${files.map((file) => renderEvidenceMini(file, stage)).join("")}
      </div>
    `;
  }

  function renderTags(items) {
    if (!items || !items.length) return "未填写";
    return `<div class="tag-list">${items.map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}</div>`;
  }

  function renderCurve(items, mode) {
    const width = 1180;
    const height = 380;
    const padX = 70;
    const top = 132;
    const bottom = 64;
    const chartHeight = height - top - bottom;
    const points = items.map((item, index) => {
      const score = Number(mode === "summary" ? item.average : item.emotionScore || 0);
      const x = padX + index * ((width - padX * 2) / (STAGES.length - 1));
      const y = top + ((3 - score) / 6) * chartHeight;
      return { x, y, score, item, index };
    });
    const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
    const area = `${padX},${height - bottom} ${polyline} ${width - padX},${height - bottom}`;
    const axes = [-3, 0, 3].map((score) => {
      const y = top + ((3 - score) / 6) * chartHeight;
      return `<line class="curve-axis" x1="${padX}" y1="${y}" x2="${width - padX}" y2="${y}"></line>`;
    }).join("");
    const annotationLines = points.map((point) => renderAnnotationLine(point, width)).join("");
    const annotations = points.map((point) => renderCurveAnnotation(point, mode, width)).join("");
    const nodes = points.map((point) => {
      const label = point.item.name.replace("灯光设计服务", "").replace("修改确认 / 下单 / 施工衔接", "修改确认").slice(0, 7);
      return `
        <circle class="curve-node" cx="${point.x}" cy="${point.y}" r="6" style="--node-delay: ${point.index * 55}ms"></circle>
        <text class="curve-score" x="${point.x}" y="${point.y + 24}">${formatScore(point.score)}</text>
        <text class="curve-label" x="${point.x}" y="${height - 24}">${escapeHtml(label)}</text>
      `;
    }).join("");
    return `
      <div class="curve-preview">
        <div class="curve-frame">
          <svg class="curve-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="情绪曲线">
            ${axes}
            <polygon class="curve-area" points="${area}"></polygon>
            <polyline class="curve-line draw-line" points="${polyline}"></polyline>
            ${annotationLines}
            ${nodes}
          </svg>
          <div class="curve-annotation-layer">${annotations}</div>
        </div>
      </div>
    `;
  }

  function annotationBox(point, width) {
    const isTop = point.index % 2 === 0;
    const boxWidth = 150;
    const boxHeight = 82;
    const rawX = point.x - boxWidth / 2;
    const x = Math.max(10, Math.min(width - boxWidth - 10, rawX));
    const y = isTop ? 18 : 42;
    return { x, y, boxWidth, boxHeight, linkY: isTop ? y + boxHeight : y + boxHeight - 8 };
  }

  function renderAnnotationLine(point, width) {
    const box = annotationBox(point, width);
    return `<line class="annotation-link" x1="${point.x}" y1="${point.y}" x2="${point.x}" y2="${box.linkY}"></line>`;
  }

  function renderCurveAnnotation(point, mode, width) {
    const rounded = clampScore(Math.round(point.score));
    const emotion = EMOTIONS[String(rounded)];
    const box = annotationBox(point, width);
    const title = mode === "summary" ? point.item.judgment : point.item.emotionLabel || emotion.label;
    const reason = mode === "summary" ? point.item.reasonSummary : point.item.emotionReason || "暂无填写";
    const full = mode === "summary" ? `${point.item.name}：${title}。${reason}` : `${point.item.name}：${title}。${reason}`;
    return `
      <div class="annotation-card" style="left: ${box.x}px; top: ${box.y}px;" title="${escapeHtml(full)}">
        <strong><span class="emoji">${emotion.emoji}</span> ${escapeHtml(title)}</strong>
        <span class="reason">${escapeHtml(reason)}</span>
      </div>
    `;
  }

  function renderReasonSummary(stageStats) {
    return `
      <section class="reason-summary">
        <h3>阶段情绪原因汇总</h3>
        <div class="reason-grid">
          ${stageStats.map((stage) => `
            <article class="reason-card">
              <h4>${stage.id}. ${escapeHtml(stage.name)}</h4>
              <dl>
                ${stage.reasonsByPerson.map((item) => `
                  <dt>${escapeHtml(item.personName)}</dt>
                  <dd>${escapeHtml(item.reason || "暂无填写")}</dd>
                `).join("")}
              </dl>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  function buildSummary() {
    const records = visibleRecords();
    const stageStats = STAGES.map((stage, index) => {
      const participants = records.filter((record) => stageHasData(record.stages[index]));
      const scores = participants.map((record) => Number(record.stages[index].emotionScore || 0));
      const average = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
      const painCount = participants.filter((record) => ["明显", "严重"].includes(record.stages[index].painSeverity)).length;
      const reasonsByPerson = records.map((record) => ({
        personName: record.personName,
        reason: record.stages[index].emotionReason || ""
      }));
      const evidenceTextCount = records.filter((record) => String(record.stages[index].evidenceText || "").trim()).length;
      const evidenceFiles = records.flatMap((record) => Array.isArray(record.stages[index].evidenceFiles) ? record.stages[index].evidenceFiles : []);
      const reasonSummary = summarizeReasons(reasonsByPerson.map((item) => item.reason));
      return {
        ...stage,
        emotionScore: average,
        average,
        participantCount: participants.length,
        painCount,
        evidenceCount: evidenceTextCount + evidenceFiles.length,
        imageEvidenceCount: evidenceFiles.filter((file) => file.category === "image").length,
        fileEvidenceCount: evidenceFiles.filter((file) => file.category !== "image").length,
        textEvidenceCount: evidenceTextCount,
        reasonsByPerson,
        reasonSummary,
        judgment: makeJudgment(average, painCount),
        signal: makeSignal(stage.name, average, painCount)
      };
    });
    const lowest = [...stageStats].sort((a, b) => a.average - b.average)[0];
    const highest = [...stageStats].sort((a, b) => b.average - a.average)[0];
    const overallAverage = stageStats.reduce((sum, item) => sum + item.average, 0) / stageStats.length;
    const totalPain = stageStats.reduce((sum, item) => sum + item.painCount, 0);
    return {
      stageStats,
      lowest,
      highest,
      overallAverage,
      totalPain,
      painKeywords: topText("painPoint"),
      opportunityKeywords: topText("opportunity"),
      contentKeywords: topText("contentOpportunity"),
      gaps: buildGapList(stageStats),
      evidenceStats: buildEvidenceStats(stageStats),
      serviceSuggestions: buildServiceSuggestions(lowest),
      sopSuggestions: buildSopSuggestions(stageStats)
    };
  }

  function buildEvidenceStats(stageStats) {
    const withEvidence = stageStats.filter((stage) => stage.evidenceCount > 0);
    if (!withEvidence.length) return ["暂未收集到附件证据，后续可以补充截图、点位图和方案文件。"];
    return withEvidence
      .sort((a, b) => b.evidenceCount - a.evidenceCount)
      .slice(0, 6)
      .map((stage) => `${stage.name}：共 ${stage.evidenceCount} 条证据，图片 ${stage.imageEvidenceCount} 张，文件 ${stage.fileEvidenceCount} 份，文字 ${stage.textEvidenceCount} 条。`);
  }

  function makeJudgment(average, painCount) {
    if (average <= -1 || painCount >= Math.ceil(visibleRecords().length / 2)) return "共同低谷";
    if (average >= 1) return "信任高峰";
    if (average < 0) return "轻微信息缺口";
    return "情绪平稳";
  }

  function summarizeReasons(reasons) {
    const clean = reasons.map((reason) => String(reason || "").trim()).filter(Boolean);
    if (!clean.length) return "暂无填写";
    const matches = REASON_BUCKETS.map((bucket) => ({
      label: bucket.label,
      count: clean.filter((reason) => bucket.pattern.test(reason)).length
    })).filter((item) => item.count > 0).sort((a, b) => b.count - a.count);
    if (matches.length) {
      const top = matches.slice(0, 2).map((item) => `${item.count} 人提到：${item.label}`);
      return top.join("；");
    }
    return `${clean.length} 人提到：${truncateText(clean[0], 20)}`;
  }

  function makeSignal(stageName, average, painCount) {
    if (painCount >= Math.ceil(state.records.length / 2)) return "多人出现明显卡点，需要优先优化";
    if (average <= -1) return "情绪偏低，说明存在信息缺口或等待焦虑";
    if (average >= 1) return "情绪较高，可沉淀为信任建立动作";
    return `${stageName}反馈相对平稳，适合补充说明材料`;
  }

  function buildGapList(stageStats) {
    return stageStats
      .filter((item) => item.average < 0 || item.painCount > 0)
      .slice(0, 5)
      .map((item) => `${item.name}：${item.reasonSummary === "暂无填写" ? "补充小白说明、必要资料和下一步预期" : item.reasonSummary}`);
  }

  function buildServiceSuggestions(lowest) {
    return [
      `${lowest.name}前置一份小白版说明，降低用户不知道该准备什么的压力。`,
      "把资料、价格、交付物和下一步动作拆成清单，不让用户靠反复问客服推进。",
      "在每次沟通结束时明确下一步、负责人和预计等待时间。"
    ];
  }

  function buildSopSuggestions(stageStats) {
    const lowStages = stageStats.filter((item) => item.average <= 0).slice(0, 3);
    const base = lowStages.map((item) => `${item.name}沉淀标准话术、示例截图和常见问答。`);
    return base.length ? base : ["把高频问题整理为选题库、客服话术和交付说明模板。"];
  }

  function topText(field) {
    const values = [];
    visibleRecords().forEach((record) => {
      record.stages.forEach((stage) => {
        const text = String(stage[field] || "").trim();
        if (text) values.push(text);
      });
    });
    return values.slice(0, 8);
  }

  function renderInsight(title, items) {
    const list = items && items.length ? items : ["暂未形成明显信号，继续补充样本后再判断。"];
    return `
      <section class="insight-block">
        <span>${escapeHtml(title)}</span>
        <ul>${list.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </section>
    `;
  }

  function exportCsv() {
    if (!state.records.length) {
      showToast("没有可导出的数据");
      return;
    }
    const headers = ["journeyId", "personId", "personName", "personaRole", "sampleType", "experienceDate", "tags", "stageId", "stageName", "状态", "用户目标", "关键行为", "接触点", "真实想法", "emotionScore", "emotionLabel", "emotionReason", "痛点严重程度", "painPoint", "opportunity", "contentOpportunity", "evidenceText", "附件证据"];
    const rows = [headers];
    state.records.forEach((record) => {
      record.stages.forEach((stage) => {
        rows.push([
          record.journeyId,
          record.personId,
          record.personName,
          record.personaRole,
          record.sampleType,
          record.experienceDate,
          (record.tags || []).join("、"),
          stage.id,
          stage.name,
          stage.status,
          stage.goal,
          stage.actions,
          stage.touchpoints.join("、"),
          stage.thoughts,
          stage.emotionScore,
          stage.emotionLabel,
          stage.emotionReason,
          stage.painSeverity,
          stage.painPoint,
          stage.opportunity,
          stage.contentOpportunity,
          stage.evidenceText,
          summarizeEvidenceFiles(stage.evidenceFiles)
        ]);
      });
    });
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
    downloadBlob(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }), "灯光设计旅程地图汇总数据.csv");
  }

  async function exportPng() {
    const target = $("#captureTarget");
    if (!target) {
      showToast("没有可导出的地图");
      return;
    }
    if (!window.html2canvas) {
      alert("PNG 导出组件未加载。可以先使用浏览器打印为 PDF。");
      return;
    }
    const canvas = await window.html2canvas(target, {
      backgroundColor: "#fafaf9",
      scale: 2,
      useCORS: true
    });
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, state.view === "summary" ? "多人汇总旅程地图.png" : "个人旅程地图.png");
    });
  }

  function csvCell(value) {
    return `"${String(value || "").replaceAll('"', '""')}"`;
  }

  function summarizeEvidenceFiles(files) {
    if (!Array.isArray(files) || !files.length) return "";
    return files.map((file) => `${file.name || "未命名文件"}（${fileTypeLabel(file)}${file.note ? `：${file.note}` : ""}）`).join("；");
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function formatScore(value) {
    const number = Number(value || 0);
    return `${number > 0 ? "+" : ""}${Number.isInteger(number) ? number : number.toFixed(1)}`;
  }

  function clampScore(value) {
    return Math.max(-3, Math.min(3, Number(value || 0)));
  }

  function truncateText(value, max) {
    const text = String(value || "").trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function formatFileSize(size) {
    const value = Number(size || 0);
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
    if (value >= 1024) return `${Math.round(value / 1024)} KB`;
    return `${value} B`;
  }

  function fileTypeLabel(file) {
    const category = file.category || categorizeEvidence(file);
    if (category === "image") return "IMG";
    if (category === "pdf") return "PDF";
    if (category === "spreadsheet") return file.name && file.name.toLowerCase().endsWith(".csv") ? "CSV" : "XLSX";
    if (category === "document") return "DOC";
    if (category === "drawing") return file.name && file.name.toLowerCase().endsWith(".dxf") ? "DXF" : "DWG";
    const ext = String(file.name || "").split(".").pop();
    return ext && ext.length <= 5 ? ext.toUpperCase() : "FILE";
  }

  function categorizeEvidence(file) {
    const type = String(file.type || "").toLowerCase();
    const name = String(file.name || "").toLowerCase();
    if (type.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic)$/.test(name)) return "image";
    if (type.includes("pdf") || name.endsWith(".pdf")) return "pdf";
    if (/\.(xlsx?|csv|numbers)$/.test(name)) return "spreadsheet";
    if (/\.(docx?|txt|pages)$/.test(name)) return "document";
    if (/\.(dwg|dxf|cad)$/.test(name)) return "drawing";
    return "file";
  }

  function bindEvidenceCards() {
    document.querySelectorAll("[data-evidence-id][data-stage-id]").forEach((button) => {
      if (button.dataset.evidenceBound === "true") return;
      button.dataset.evidenceBound = "true";
      button.addEventListener("click", () => {
        openEvidenceFromCard(Number(button.dataset.stageId), button.dataset.evidenceId)
          .catch((error) => showToast(`证据打开失败：${error.message}`));
      });
    });
  }

  function currentIndividualRecord() {
    const records = visibleRecords();
    return records.find((record) => recordKey(record) === state.selectedJourneyId) || records[0] || null;
  }

  async function openEvidenceFromCard(stageId, evidenceId) {
    const record = currentIndividualRecord();
    if (!record) return;
    const stage = record.stages.find((item) => Number(item.id) === Number(stageId));
    if (!stage) return;
    const file = (stage.evidenceFiles || []).find((item) => item.id === evidenceId);
    if (!file) return;
    const category = file.category || categorizeEvidence(file);
    file.category = category;
    if (category === "image") {
      const images = (stage.evidenceFiles || []).filter((item) => (item.category || categorizeEvidence(item)) === "image");
      state.viewer.evidenceItems = images.map((item) => ({ record, stage, file: item }));
      state.viewer.currentIndex = Math.max(0, images.findIndex((item) => item.id === evidenceId));
      await openImageViewer();
      return;
    }
    await ensureFileBody(file);
    if (category === "pdf" && hasFileBody(file)) {
      openPdfViewer({ record, stage, file });
      return;
    }
    if (category === "pdf" && !hasFileBody(file)) {
      openMissingFileDialog({ stage, file });
      return;
    }
    if (category === "spreadsheet" && hasFileBody(file) && canPreviewSpreadsheet(file)) {
      await openSpreadsheetViewer({ record, stage, file });
      return;
    }
    openFileInfoViewer({ stage, file });
  }

  function hasFileBody(file) {
    return Boolean(file && (file._blob || file.previewDataUrl || file.thumbnailDataUrl));
  }

  async function ensureFileBody(file) {
    if (!file || file._blob) return;
    let blob = null;
    if (file.dashboardFileKey) {
      blob = await getDashboardEvidenceBlob(file.dashboardFileKey);
    }
    if (!blob && file.storageKey) {
      blob = await getEvidenceBlob(file.storageKey);
    }
    if (!blob && window.LightingCloud && window.LightingCloud.isEnabled() && (file.cloudStoragePath || file.storagePath)) {
      blob = await window.LightingCloud.downloadEvidence(file).catch(() => null);
    }
    if (!blob) return;
    file._blob = normalizeEvidenceBlob(file, blob);
    file.hasOriginalFile = true;
  }

  function normalizeEvidenceBlob(file, blob) {
    if (file.category === "pdf" && blob.type !== "application/pdf") {
      return new Blob([blob], { type: "application/pdf" });
    }
    if (file.type && blob.type !== file.type && blob.type === "application/octet-stream") {
      return new Blob([blob], { type: file.type });
    }
    return blob;
  }

  function releaseViewerObjectUrl() {
    if (state.viewer.objectUrl) {
      URL.revokeObjectURL(state.viewer.objectUrl);
      state.viewer.objectUrl = "";
    }
  }

  function getFileUrl(file) {
    releaseViewerObjectUrl();
    if (file._blob) {
      state.viewer.objectUrl = URL.createObjectURL(normalizeEvidenceBlob(file, file._blob));
      return state.viewer.objectUrl;
    }
    if (file.previewDataUrl) return file.previewDataUrl;
    if (file.thumbnailDataUrl) return file.thumbnailDataUrl;
    return "";
  }

  function openViewerShell({ title, stageName, body, mode, downloadable = true }) {
    const dialog = $("#evidenceViewer");
    $("#viewerTitle").textContent = title;
    $("#viewerStage").textContent = stageName || "Evidence";
    $("#viewerBody").innerHTML = body;
    dialog.dataset.mode = mode;
    dialog.classList.remove("closing");
    const imageTools = dialog.querySelectorAll(".viewer-image-tool");
    imageTools.forEach((item) => {
      item.hidden = mode !== "image";
    });
    $("#viewerDownload").hidden = !downloadable;
    if (!dialog.open) dialog.showModal();
  }

  async function openImageViewer() {
    const item = state.viewer.evidenceItems[state.viewer.currentIndex];
    if (!item) return;
    await ensureFileBody(item.file);
    if (!hasFileBody(item.file)) {
      openMissingFileDialog(item);
      return;
    }
    state.viewer.scale = 1;
    state.viewer.offsetX = 0;
    state.viewer.offsetY = 0;
    const url = getFileUrl(item.file);
    openViewerShell({
      title: item.file.name || "图片证据",
      stageName: item.stage.name,
      mode: "image",
      body: `
        <div class="image-viewer-canvas">
          <img id="viewerImage" src="${escapeHtml(url)}" alt="${escapeHtml(item.file.name || "图片证据")}" draggable="false">
        </div>
        ${item.file.note ? `<p class="viewer-note">${escapeHtml(item.file.note)}</p>` : ""}
      `
    });
    updateViewerImageTransform();
    updateViewerCounter();
  }

  function openPdfViewer(item) {
    const url = getFileUrl(item.file);
    openViewerShell({
      title: item.file.name || "PDF 证据",
      stageName: item.stage.name,
      mode: "pdf",
      body: `
        <div class="pdf-viewer-frame">
          <iframe src="${escapeHtml(url)}" title="${escapeHtml(item.file.name || "PDF 证据")}"></iframe>
          <p class="pdf-fallback">如果当前浏览器没有显示 PDF，请点击右上角“下载”后查看。</p>
        </div>
        ${item.file.note ? `<p class="viewer-note">${escapeHtml(item.file.note)}</p>` : ""}
      `
    });
    state.viewer.evidenceItems = [item];
    state.viewer.currentIndex = 0;
    updateViewerCounter();
  }

  async function openSpreadsheetViewer(item) {
    const result = await parseSpreadsheetPreview(item.file);
    const rowCount = result.rows.length;
    openViewerShell({
      title: item.file.name || "表格证据",
      stageName: item.stage.name,
      mode: "spreadsheet",
      body: `
        <div class="spreadsheet-viewer">
          <div class="spreadsheet-viewer-header">
            <span>${escapeHtml(result.sheetName || "Sheet 1")}</span>
            <p>${rowCount ? `预览 ${rowCount} 行 · 如需编辑请下载后打开` : "这份表格暂时没有可预览内容"}</p>
          </div>
          ${rowCount ? renderSpreadsheetTable(result.rows) : `<div class="spreadsheet-empty">没有读取到表格内容。</div>`}
        </div>
        ${item.file.note ? `<p class="viewer-note">${escapeHtml(item.file.note)}</p>` : ""}
      `
    });
    state.viewer.evidenceItems = [item];
    state.viewer.currentIndex = 0;
    updateViewerCounter();
  }

  function canPreviewSpreadsheet(file) {
    const name = String(file.name || "").toLowerCase();
    return name.endsWith(".xlsx") || name.endsWith(".csv");
  }

  async function parseSpreadsheetPreview(file) {
    const name = String(file.name || "").toLowerCase();
    const blob = normalizeEvidenceBlob(file, file._blob);
    if (name.endsWith(".csv")) {
      const text = await blob.text();
      return { sheetName: "CSV", rows: parseCsvRows(text).slice(0, 80) };
    }
    if (!window.JSZip) {
      throw new Error("表格预览组件未加载，请刷新页面后再试。");
    }
    const zip = await window.JSZip.loadAsync(blob);
    const workbookXml = await readZipText(zip, "xl/workbook.xml");
    const relsXml = await readZipText(zip, "xl/_rels/workbook.xml.rels");
    const sheetInfo = getFirstSheetInfo(workbookXml, relsXml);
    const sharedStrings = await readSharedStrings(zip);
    const sheetXml = await readZipText(zip, sheetInfo.path);
    return {
      sheetName: sheetInfo.name,
      rows: parseWorksheetRows(sheetXml, sharedStrings).slice(0, 80)
    };
  }

  async function readZipText(zip, path) {
    const entry = zip.file(path);
    if (!entry) throw new Error(`表格文件缺少 ${path}`);
    return entry.async("text");
  }

  async function readSharedStrings(zip) {
    const entry = zip.file("xl/sharedStrings.xml");
    if (!entry) return [];
    const xml = await entry.async("text");
    const doc = parseXml(xml);
    return Array.from(doc.getElementsByTagName("si")).map((item) => {
      const texts = Array.from(item.getElementsByTagName("t")).map((node) => node.textContent || "");
      return texts.join("");
    });
  }

  function getFirstSheetInfo(workbookXml, relsXml) {
    const workbook = parseXml(workbookXml);
    const rels = parseXml(relsXml);
    const sheet = workbook.getElementsByTagName("sheet")[0];
    if (!sheet) throw new Error("表格文件里没有工作表");
    const relId = sheet.getAttribute("r:id") || sheet.getAttribute("id");
    const rel = Array.from(rels.getElementsByTagName("Relationship")).find((item) => item.getAttribute("Id") === relId);
    const target = rel ? rel.getAttribute("Target") : "worksheets/sheet1.xml";
    const path = target.startsWith("/") ? target.replace(/^\/+/, "") : `xl/${target.replace(/^\.\.\//, "")}`;
    return {
      name: sheet.getAttribute("name") || "Sheet 1",
      path
    };
  }

  function parseXml(xml) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) {
      throw new Error("表格 XML 解析失败");
    }
    return doc;
  }

  function parseWorksheetRows(sheetXml, sharedStrings) {
    const doc = parseXml(sheetXml);
    const rows = Array.from(doc.getElementsByTagName("row")).slice(0, 80);
    return rows.map((row) => {
      const cells = Array.from(row.getElementsByTagName("c"));
      const values = [];
      cells.forEach((cell) => {
        const ref = cell.getAttribute("r") || "";
        const columnIndex = columnNameToIndex(ref.replace(/[0-9]/g, ""));
        while (values.length < columnIndex) values.push("");
        values[columnIndex] = readCellValue(cell, sharedStrings);
      });
      return values;
    }).filter((row) => row.some((value) => String(value || "").trim()));
  }

  function readCellValue(cell, sharedStrings) {
    const type = cell.getAttribute("t");
    if (type === "inlineStr") {
      return Array.from(cell.getElementsByTagName("t")).map((node) => node.textContent || "").join("");
    }
    const value = cell.getElementsByTagName("v")[0]?.textContent || "";
    if (type === "s") return sharedStrings[Number(value)] || "";
    if (type === "b") return value === "1" ? "TRUE" : "FALSE";
    return value;
  }

  function columnNameToIndex(name) {
    const letters = String(name || "A").toUpperCase();
    let index = 0;
    for (let i = 0; i < letters.length; i += 1) {
      index = index * 26 + (letters.charCodeAt(i) - 64);
    }
    return Math.max(0, index - 1);
  }

  function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let value = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const next = text[index + 1];
      if (char === "\"" && quoted && next === "\"") {
        value += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = !quoted;
      } else if (char === "," && !quoted) {
        row.push(value);
        value = "";
      } else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && next === "\n") index += 1;
        row.push(value);
        rows.push(row);
        row = [];
        value = "";
      } else {
        value += char;
      }
    }
    row.push(value);
    rows.push(row);
    return rows.filter((item) => item.some((cell) => String(cell || "").trim()));
  }

  function renderSpreadsheetTable(rows) {
    const maxColumns = Math.min(12, Math.max(...rows.map((row) => row.length), 1));
    return `
      <div class="spreadsheet-table-wrap">
        <table class="spreadsheet-table">
          <tbody>
            ${rows.map((row, rowIndex) => `
              <tr>
                ${Array.from({ length: maxColumns }, (_, index) => `
                  <${rowIndex === 0 ? "th" : "td"}>${escapeHtml(row[index] || "")}</${rowIndex === 0 ? "th" : "td"}>
                `).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function openFileInfoViewer(item) {
    const category = item.file.category || categorizeEvidence(item.file);
    item.file.category = category;
    const hasBody = hasFileBody(item.file);
    const isCad = category === "drawing";
    const isSpreadsheet = category === "spreadsheet";
    const isDocument = category === "document";
    openViewerShell({
      title: item.file.name || "文件证据",
      stageName: item.stage.name,
      mode: "file",
      downloadable: true,
      body: `
        <div class="file-info-viewer">
          <span>${escapeHtml(fileTypeLabel(item.file))}</span>
          <dl>
            <div><dt>文件名</dt><dd>${escapeHtml(item.file.name || "未命名文件")}</dd></div>
            <div><dt>文件类型</dt><dd>${escapeHtml(item.file.type || fileTypeLabel(item.file))}</dd></div>
            <div><dt>文件大小</dt><dd>${escapeHtml(formatFileSize(item.file.size))}</dd></div>
            <div><dt>所属阶段</dt><dd>${escapeHtml(item.stage.name)}</dd></div>
            <div><dt>证据说明</dt><dd>${escapeHtml(item.file.note || "暂无说明")}</dd></div>
          </dl>
          ${isCad ? `<p>该格式通常需要 CAD 软件打开，网页内仅支持文件信息查看和下载。</p>` : ""}
          ${isSpreadsheet ? `<p>Excel / CSV 文件不在网页内展开表格内容，可通过右上角“下载”后用表格软件查看。</p>` : ""}
          ${isDocument ? `<p>Word / 文档类文件不在网页内展开正文，可通过右上角“下载”后查看。</p>` : ""}
          ${!hasBody ? `<p>当前导入的是 JSON 元信息，未包含真实文件本体。请导入完整证据包 ZIP 后下载或查看该文件。</p>` : ""}
        </div>
      `
    });
    state.viewer.evidenceItems = [item];
    state.viewer.currentIndex = 0;
    updateViewerCounter();
  }

  function openMissingFileDialog(item) {
    releaseViewerObjectUrl();
    openViewerShell({
      title: "无法预览该文件",
      stageName: item.stage ? item.stage.name : "Evidence",
      mode: "missing",
      downloadable: false,
      body: `
        <div class="file-info-viewer missing">
          <span>${escapeHtml(fileTypeLabel(item.file || {}))}</span>
          <h3>${escapeHtml(item.file && item.file.name ? item.file.name : "文件未随 JSON 一起导入")}</h3>
          <p>当前导入的是 JSON，它只包含文件名称和说明，没有包含真实文件本体。请导入完整证据包 ZIP 后查看截图、点位图或交付文件。</p>
        </div>
      `
    });
    state.viewer.evidenceItems = [];
    updateViewerCounter();
  }

  function closeViewer() {
    const dialog = $("#evidenceViewer");
    if (!dialog.open) return;
    dialog.classList.add("closing");
    window.setTimeout(() => {
      dialog.close();
      dialog.classList.remove("closing");
      $("#viewerBody").innerHTML = "";
      releaseViewerObjectUrl();
    }, state.reducedMotion ? 0 : 180);
  }

  function updateViewerCounter() {
    const total = state.viewer.evidenceItems.length || 1;
    $("#viewerCount").textContent = `${Math.min(state.viewer.currentIndex + 1, total)} / ${total}`;
    $("#viewerPrev").disabled = total <= 1;
    $("#viewerNext").disabled = total <= 1;
  }

  function stepImageViewer(step) {
    const total = state.viewer.evidenceItems.length;
    if (total <= 1) return;
    state.viewer.currentIndex = (state.viewer.currentIndex + step + total) % total;
    openImageViewer().catch((error) => showToast(`图片切换失败：${error.message}`));
  }

  function updateViewerImageTransform() {
    const image = $("#viewerImage");
    if (!image) return;
    image.style.transform = `translate(${state.viewer.offsetX}px, ${state.viewer.offsetY}px) scale(${state.viewer.scale})`;
  }

  function zoomViewer(delta) {
    state.viewer.scale = Math.max(0.4, Math.min(4, state.viewer.scale + delta));
    updateViewerImageTransform();
  }

  function resetViewerImage() {
    state.viewer.scale = 1;
    state.viewer.offsetX = 0;
    state.viewer.offsetY = 0;
    updateViewerImageTransform();
  }

  function downloadCurrentEvidence() {
    const item = state.viewer.evidenceItems[state.viewer.currentIndex];
    if (!item || !hasFileBody(item.file)) {
      showToast("当前没有可下载的文件本体，请导入完整证据包 ZIP。");
      return;
    }
    if (item.file._blob) {
      downloadBlob(normalizeEvidenceBlob(item.file, item.file._blob), item.file.name || "evidence-file");
      return;
    }
    if (item.file.previewDataUrl) {
      downloadBlob(dataUrlToBlob(item.file.previewDataUrl), item.file.name || "evidence-image.jpg");
    }
  }

  function dataUrlToBlob(dataUrl) {
    const [header, payload] = String(dataUrl || "").split(",");
    const mimeMatch = header.match(/data:([^;]+);base64/);
    const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
    const binary = atob(payload || "");
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mime });
  }

  function bindPersonSwitcher() {
    document.querySelectorAll("[data-journey]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedJourneyId = button.dataset.journey;
        state.detailStageId = "";
        closeStageDetail({ silent: true });
        render();
        scheduleDashboardSessionSave();
      });
    });
  }

  function bindJourneyMapControls() {
    const rerenderWithoutJump = () => {
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      const mapShell = document.querySelector(".journey-map-shell");
      const mapScrollLeft = mapShell ? mapShell.scrollLeft : 0;
      const mapScrollTop = mapShell ? mapShell.scrollTop : 0;
      render();
      requestAnimationFrame(() => {
        window.scrollTo(scrollX, scrollY);
        const nextMapShell = document.querySelector(".journey-map-shell");
        if (nextMapShell) {
          nextMapShell.scrollLeft = mapScrollLeft;
          nextMapShell.scrollTop = mapScrollTop;
        }
      });
    };

    document.querySelectorAll("[data-map-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        state.individualMapMode = button.dataset.mapMode || "overview";
        rerenderWithoutJump();
      });
    });

    document.querySelectorAll("[data-open-stage-detail]").forEach((element) => {
      element.addEventListener("click", (event) => {
        if (event.target.closest("[data-evidence-id]")) return;
        event.stopPropagation();
        openStageDetail(element.dataset.openStageDetail);
      });
      element.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openStageDetail(element.dataset.openStageDetail);
      });
    });

    document.querySelectorAll("[data-close-stage-detail]").forEach((button) => {
      button.addEventListener("click", () => {
        closeStageDetail();
      });
    });
  }

  function openStageDetail(stageId) {
    const record = currentIndividualRecord();
    if (!record) return;
    const markup = renderStageDetailDrawer(record, stageId);
    if (!markup) return;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    closeStageDetail({ silent: true });
    state.detailStageId = String(stageId);
    const layer = document.createElement("div");
    layer.id = "stageDetailLayer";
    layer.innerHTML = markup;
    document.body.append(layer);
    layer.querySelectorAll("[data-close-stage-detail]").forEach((button) => {
      button.addEventListener("click", () => closeStageDetail());
    });
    bindEvidenceCards();
    requestAnimationFrame(() => window.scrollTo(scrollX, scrollY));
  }

  function closeStageDetail({ silent = false } = {}) {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const layer = document.querySelector("#stageDetailLayer");
    if (layer) layer.remove();
    state.detailStageId = "";
    if (!silent) requestAnimationFrame(() => window.scrollTo(scrollX, scrollY));
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function init() {
    document.addEventListener("pointermove", (event) => {
      if (state.reducedMotion) return;
      document.body.style.setProperty("--glow-x", `${Math.round((event.clientX / window.innerWidth) * 100)}%`);
      document.body.style.setProperty("--glow-y", `${Math.round((event.clientY / window.innerHeight) * 100)}%`);
    }, { passive: true });

    $("#jsonInput").addEventListener("change", (event) => {
      readFiles(Array.from(event.target.files)).catch((error) => {
        $("#jsonInput").value = "";
        showToast(`文件读取失败：${error.message}`);
      });
    });
    $("#loadLocalButton").addEventListener("click", () => {
      loadLocalRecords().catch((error) => showToast(`缓存读取失败：${error.message}`));
    });
    $("#loadCloudButton").addEventListener("click", () => {
      loadCloudRecords().catch((error) => showToast(`云端读取失败：${error.message}`));
    });
    $("#refreshCloudButton").addEventListener("click", () => {
      loadCloudRecords().catch((error) => showToast(`云端刷新失败：${error.message}`));
    });
    $("#clearCurrentButton").addEventListener("click", () => {
      clearCurrentData().catch((error) => showToast(`清空展示失败：${error.message}`));
    });
    $("#clearRestoredButton").addEventListener("click", () => {
      clearCurrentData().catch((error) => showToast(`清空展示失败：${error.message}`));
    });
    $("#clearDraftCacheButton").addEventListener("click", () => {
      clearDraftCache().catch((error) => showToast(`清空填写缓存失败：${error.message}`));
    });
    $("#clearAllLocalButton").addEventListener("click", () => {
      clearAllLocalCache().catch((error) => showToast(`清空全部缓存失败：${error.message}`));
    });
    $("#exportCsvButton").addEventListener("click", exportCsv);
    $("#printButton").addEventListener("click", () => window.print());
    $("#exportPngButton").addEventListener("click", () => {
      exportPng().catch((error) => alert(`PNG 导出失败：${error.message}`));
    });
    $("#viewerClose").addEventListener("click", closeViewer);
    $("#viewerDownload").addEventListener("click", downloadCurrentEvidence);
    $("#viewerZoomIn").addEventListener("click", () => zoomViewer(0.2));
    $("#viewerZoomOut").addEventListener("click", () => zoomViewer(-0.2));
    $("#viewerReset").addEventListener("click", resetViewerImage);
    $("#viewerPrev").addEventListener("click", () => stepImageViewer(-1));
    $("#viewerNext").addEventListener("click", () => stepImageViewer(1));
    $("#evidenceViewer").addEventListener("click", (event) => {
      if (event.target === $("#evidenceViewer")) closeViewer();
    });
    $("#evidenceViewer").addEventListener("cancel", (event) => {
      event.preventDefault();
      closeViewer();
    });
    $("#viewerBody").addEventListener("dblclick", (event) => {
      if (event.target.closest("#viewerImage")) resetViewerImage();
    });
    $("#viewerBody").addEventListener("pointerdown", (event) => {
      if (!event.target.closest("#viewerImage")) return;
      state.viewer.isDragging = true;
      state.viewer.dragStartX = event.clientX - state.viewer.offsetX;
      state.viewer.dragStartY = event.clientY - state.viewer.offsetY;
      event.target.setPointerCapture(event.pointerId);
    });
    $("#viewerBody").addEventListener("pointermove", (event) => {
      if (!state.viewer.isDragging) return;
      state.viewer.offsetX = event.clientX - state.viewer.dragStartX;
      state.viewer.offsetY = event.clientY - state.viewer.dragStartY;
      updateViewerImageTransform();
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((type) => {
      $("#viewerBody").addEventListener(type, () => {
        state.viewer.isDragging = false;
      });
    });
    document.querySelectorAll(".tab-button").forEach((button) => {
      button.addEventListener("click", () => setView(button.dataset.view));
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && document.querySelector("#stageDetailLayer")) {
        closeStageDetail();
      }
    });
    $("#sampleTypeFilter").addEventListener("change", (event) => {
      state.filters.sampleType = event.target.value;
      render();
    });
    $("#dateFilter").addEventListener("change", (event) => {
      state.filters.dateRange = event.target.value;
      render();
    });
    $("#tagFilter").addEventListener("change", (event) => {
      state.filters.tag = event.target.value;
      render();
    });
    $("#completionFilter").addEventListener("change", (event) => {
      state.filters.completion = event.target.value;
      render();
    });
    restoreDashboardSession()
      .then(() => loadPublishedPackagesIfNeeded())
      .catch((error) => {
        showToast(`展示数据加载失败：${error.message}`);
        renderImportedList();
        renderFilters();
      })
      .finally(() => {
        initCloudSync();
      });
  }

  init();
})();

(function () {
  "use strict";

  const STORAGE_PREFIX = "lightingJourneyMap:v1:";
  const REGISTRY_KEY = `${STORAGE_PREFIX}registry`;
  const JOURNEY_PREFIX = `${STORAGE_PREFIX}journey:`;
  const EVIDENCE_DB_NAME = "lightingJourneyMapEvidence:v1";
  const EVIDENCE_STORE_NAME = "evidenceFiles";
  const DEFAULT_PEOPLE = [
    { personId: "person_default_zhang", personName: "张西珈" },
    { personId: "person_default_qi", personName: "戚日莲" },
    { personId: "person_default_xie", personName: "谢珊珊" },
    { personId: "person_default_li", personName: "李娜" }
  ];
  const TOUCHPOINTS = ["小红书", "淘宝/天猫", "微信", "客服", "灯光设计师", "问卷", "CAD 图", "户型图", "效果图", "吊顶图", "方案文件", "电话", "视频", "其他"];
  const MAX_EVIDENCE_FILES = 10;
  const LARGE_FILE_SIZE = 10 * 1024 * 1024;
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

  const state = {
    currentJourneyId: "",
    personId: DEFAULT_PEOPLE[0].personId,
    people: [],
    currentStageIndex: 0,
    data: null,
    saveTimer: null,
    toastTimer: null,
    fieldTimers: new WeakMap(),
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches
  };

  const $ = (selector) => document.querySelector(selector);
  const form = $("#stageForm");

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

  function createBlankData(person) {
    const today = new Date().toISOString().slice(0, 10);
    return {
      version: 1,
      journeyId: person.journeyId || createId("journey"),
      personId: person.personId,
      personName: person.personName,
      experienceDate: person.experienceDate || today,
      personaRole: person.personaRole || "内部体验用户",
      sampleType: person.sampleType || "内部体验者",
      tags: Array.isArray(person.tags) ? person.tags : [],
      updatedAt: new Date().toISOString(),
      stages: STAGES.map(defaultStage)
    };
  }

  function createId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function journeyStorageKey(journeyId) {
    return `${JOURNEY_PREFIX}${journeyId}`;
  }

  function legacyStorageKey(personName) {
    return `${STORAGE_PREFIX}${personName}`;
  }

  function createDefaultRegistry() {
    return {
      people: DEFAULT_PEOPLE.map((person) => ({
        ...person,
        journeyId: `journey_default_${person.personId.replace("person_default_", "")}`,
        personaRole: "内部体验用户",
        sampleType: "内部体验者",
        experienceDate: new Date().toISOString().slice(0, 10),
        tags: ["默认成员"]
      }))
    };
  }

  function loadRegistry() {
    const raw = localStorage.getItem(REGISTRY_KEY);
    let registry = null;
    if (raw) {
      try {
        registry = JSON.parse(raw);
      } catch {
        registry = null;
      }
    }
    if (!registry || !Array.isArray(registry.people)) {
      registry = createDefaultRegistry();
    }
    registry.people = registry.people.map((person) => ({
      personId: person.personId || createId("person"),
      journeyId: person.journeyId || createId("journey"),
      personName: person.personName || "未命名",
      personaRole: person.personaRole || "内部体验用户",
      sampleType: person.sampleType || "内部体验者",
      experienceDate: person.experienceDate || new Date().toISOString().slice(0, 10),
      tags: Array.isArray(person.tags) ? person.tags : parseTags(person.tags)
    }));
    DEFAULT_PEOPLE.forEach((defaultPerson) => {
      if (!registry.people.some((person) => person.personId === defaultPerson.personId || person.personName === defaultPerson.personName)) {
        registry.people.push({
          ...defaultPerson,
          journeyId: `journey_default_${defaultPerson.personId.replace("person_default_", "")}`,
          personaRole: "内部体验用户",
          sampleType: "内部体验者",
          experienceDate: new Date().toISOString().slice(0, 10),
          tags: ["默认成员"]
        });
      }
    });
    return registry;
  }

  function saveRegistry() {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify({ people: state.people }));
  }

  function currentPerson() {
    return state.people.find((person) => person.journeyId === state.currentJourneyId)
      || state.people.find((person) => person.personId === state.personId)
      || state.people[0];
  }

  function loadData(journeyId) {
    const person = state.people.find((item) => item.journeyId === journeyId) || state.people[0];
    const raw = localStorage.getItem(journeyStorageKey(person.journeyId)) || localStorage.getItem(legacyStorageKey(person.personName));
    if (!raw) return createBlankData(person);
    try {
      const parsed = JSON.parse(raw);
      return normalizeData(parsed, person);
    } catch {
      return createBlankData(person);
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
        if (!db.objectStoreNames.contains(EVIDENCE_STORE_NAME)) {
          db.createObjectStore(EVIDENCE_STORE_NAME, { keyPath: "storageKey" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function withEvidenceStore(mode, callback) {
    const db = await openEvidenceDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(EVIDENCE_STORE_NAME, mode);
      const store = transaction.objectStore(EVIDENCE_STORE_NAME);
      let result;
      transaction.oncomplete = () => {
        db.close();
        resolve(result);
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
      try {
        result = callback(store);
      } catch (error) {
        db.close();
        reject(error);
      }
    });
  }

  function putEvidenceBlob(record, blob) {
    return withEvidenceStore("readwrite", (store) => {
      store.put({
        storageKey: record.storageKey,
        journeyId: record.journeyId || (state.data && state.data.journeyId),
        stageId: record.stageId || (state.data && state.data.stages[state.currentStageIndex] && state.data.stages[state.currentStageIndex].id),
        name: record.name,
        type: record.type,
        category: record.category,
        size: record.size,
        lastModified: record.lastModified,
        uploadedAt: record.uploadedAt,
        blob
      });
    });
  }

  function getEvidenceBlob(storageKey) {
    if (!storageKey) return Promise.resolve(null);
    return withEvidenceStore("readonly", (store) => new Promise((resolve, reject) => {
      const request = store.get(storageKey);
      request.onsuccess = () => resolve(request.result && request.result.blob ? request.result.blob : null);
      request.onerror = () => reject(request.error);
    }));
  }

  function deleteEvidenceBlob(storageKey) {
    if (!storageKey) return Promise.resolve();
    return withEvidenceStore("readwrite", (store) => {
      store.delete(storageKey);
    });
  }

  function normalizeData(data, person) {
    const normalized = createBlankData({
      ...person,
      personId: person.personId || data.personId,
      journeyId: person.journeyId || data.journeyId,
      personName: data.personName || person.personName,
      personaRole: data.personaRole || person.personaRole,
      sampleType: data.sampleType || person.sampleType,
      experienceDate: data.experienceDate || person.experienceDate,
      tags: Array.isArray(data.tags) ? data.tags : person.tags
    });
    normalized.experienceDate = data.experienceDate || normalized.experienceDate;
    normalized.personName = data.personName || normalized.personName;
    normalized.personId = data.personId || normalized.personId;
    normalized.journeyId = data.journeyId || normalized.journeyId;
    normalized.personaRole = data.personaRole || normalized.personaRole;
    normalized.sampleType = data.sampleType || normalized.sampleType;
    normalized.tags = Array.isArray(data.tags) ? data.tags : normalized.tags;
    normalized.updatedAt = data.updatedAt || normalized.updatedAt;
    normalized.stages = STAGES.map((stage, index) => ({
      ...defaultStage(stage),
      ...(data.stages && data.stages[index] ? data.stages[index] : {}),
      id: stage.id,
      name: stage.name,
      description: stage.description,
      touchpoints: Array.isArray(data.stages && data.stages[index] && data.stages[index].touchpoints)
        ? data.stages[index].touchpoints
        : [],
      evidenceFiles: Array.isArray(data.stages && data.stages[index] && data.stages[index].evidenceFiles)
        ? data.stages[index].evidenceFiles
        : []
    }));
    return normalized;
  }

  function saveData() {
    const person = currentPerson();
    state.data.updatedAt = new Date().toISOString();
    syncPersonFromData(person);
    try {
      localStorage.setItem(journeyStorageKey(state.data.journeyId), JSON.stringify(compactDataForStorage(state.data)));
      saveRegistry();
    } catch {
      showToast("本机缓存空间不足：文字已保留在页面里，建议先导出 JSON。");
      return false;
    }
    $("#autosaveStatus").textContent = `已自动保存 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
    flashAutosave();
    return true;
  }

  function syncPersonFromData(person = currentPerson()) {
    if (!person || !state.data) return;
    person.personId = state.data.personId || person.personId;
    person.journeyId = state.data.journeyId || person.journeyId;
    person.personName = state.data.personName || person.personName || "未命名";
    person.experienceDate = state.data.experienceDate || person.experienceDate;
    person.sampleType = state.data.sampleType || person.sampleType;
    person.personaRole = state.data.personaRole || person.personaRole;
    person.tags = Array.isArray(state.data.tags) ? state.data.tags : person.tags;
    person.updatedAt = state.data.updatedAt || new Date().toISOString();
    state.personId = person.personId;
    state.currentJourneyId = person.journeyId;
  }

  function queueSave() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveData, 140);
  }

  function manualSave() {
    clearTimeout(state.saveTimer);
    readStageFromForm({ commitName: true });
    const saved = saveData();
    const button = $("#manualSaveButton");
    if (!button) return;
    button.classList.remove("saved", "failed");
    void button.offsetWidth;
    if (saved) {
      button.textContent = "已保存";
      button.classList.add("saved");
      showToast("当前填写内容已保存到本机");
      window.setTimeout(() => {
        button.textContent = "保存";
        button.classList.remove("saved");
      }, 1400);
    } else {
      button.textContent = "保存失败";
      button.classList.add("failed");
      window.setTimeout(() => {
        button.textContent = "保存";
        button.classList.remove("failed");
      }, 1800);
    }
  }

  async function submitCurrentJourneyToCloud() {
    const button = $("#cloudSubmitButton");
    if (!window.LightingCloud || !window.LightingCloud.isEnabled()) {
      showToast("云端同步未启用。请先填写 assets/supabase-config.js。");
      return;
    }
    clearTimeout(state.saveTimer);
    readStageFromForm({ commitName: true });
    saveData();
    const originalText = button ? button.textContent : "";
    if (button) {
      button.disabled = true;
      button.textContent = "提交中";
    }
    try {
      const uploadedJourney = await window.LightingCloud.saveJourney(state.data, {
        getBlob: async (file) => (file.storageKey ? getEvidenceBlob(file.storageKey) : null)
      });
      window.LightingCloud.mergeCloudFileFields(state.data, uploadedJourney);
      saveData();
      renderEvidenceFiles();
      showToast("已提交到云端，展示页会实时更新");
    } catch (error) {
      showToast(`云端提交失败：${error.message}`);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalText || "提交云端";
      }
    }
  }

  function compactDataForStorage(data) {
    const compact = JSON.parse(JSON.stringify(data));
    compact.stages.forEach((stage) => {
      stage.evidenceFiles = (stage.evidenceFiles || []).map((file) => {
        const next = { ...file };
        if (next.storageKey || next.thumbnailDataUrl) {
          delete next.previewDataUrl;
        }
        return next;
      });
    });
    return compact;
  }

  function stageComplete(stage) {
    if (stage.status === "跳过") return true;
    if (stage.status === "暂未体验") {
      return Boolean(stage.thoughts.trim() || stage.emotionReason.trim() || stage.painPoint.trim());
    }
    return Boolean(stage.goal.trim() && stage.actions.trim() && stage.thoughts.trim() && stage.emotionReason.trim());
  }

  function missingFields() {
    return state.data.stages
      .map((stage) => {
        if (stageComplete(stage)) return null;
        if (stage.status === "暂未体验") return `${stage.id}. ${stage.name}：请补充预期担心或情绪原因`;
        return `${stage.id}. ${stage.name}：请至少填写用户目标、关键行为、真实想法、情绪原因`;
      })
      .filter(Boolean);
  }

  function renderProfile() {
    if (!state.data) return;
    $("#personNameInput").value = state.data.personName || "";
    $("#experienceDate").value = state.data.experienceDate || "";
    $("#sampleType").value = state.data.sampleType || "内部体验者";
    $("#personaRole").value = state.data.personaRole || "";
    $("#sampleTags").value = (state.data.tags || []).join("、");
    const identity = $("#sampleIdentity");
    if (identity) {
      const done = state.data.stages ? state.data.stages.filter(stageComplete).length : 0;
      identity.textContent = `${done} / ${STAGES.length} · ${state.data.sampleType || "样本"}`;
    }
  }

  function renderSampleList() {
    const list = $("#sampleList");
    if (!list) return;
    if (!state.people.length) {
      list.innerHTML = `<p class="evidence-empty">当前浏览器里还没有保存样本。</p>`;
      return;
    }
    list.innerHTML = state.people.map((person) => {
      const data = loadData(person.journeyId);
      const completed = data.stages.filter(stageComplete).length;
      const meta = [
        data.sampleType || person.sampleType || "样本",
        data.experienceDate || person.experienceDate || "未填写日期",
        ...(data.tags || person.tags || []).slice(0, 2)
      ].filter(Boolean).join(" · ");
      return `
        <article class="sample-card ${person.journeyId === state.currentJourneyId ? "active" : ""}">
          <div>
            <strong>${escapeHtml(data.personName || person.personName || "未命名")}</strong>
            <span>${escapeHtml(meta)}</span>
            <small>完成 ${completed} / ${STAGES.length} · ${data.updatedAt ? `更新 ${escapeHtml(formatDateTime(data.updatedAt))}` : "尚未更新"}</small>
          </div>
          <div class="sample-card-actions">
            <button class="ghost-button small-button" type="button" data-open-journey="${escapeHtml(person.journeyId)}">打开</button>
            <button class="ghost-button small-button" type="button" data-rename-journey="${escapeHtml(person.journeyId)}">重命名</button>
            <button class="ghost-button small-button danger-subtle" type="button" data-delete-journey="${escapeHtml(person.journeyId)}">删除</button>
          </div>
        </article>
      `;
    }).join("");
  }

  function renderTouchpoints() {
    $("#touchpointGrid").innerHTML = TOUCHPOINTS.map((item) => `
      <label>
        <input type="checkbox" name="touchpoints" value="${escapeHtml(item)}">
        <span>${escapeHtml(item)}</span>
      </label>
    `).join("");
  }

  function renderStageNav() {
    $("#stageNav").innerHTML = state.data.stages.map((stage, index) => `
      <button type="button" data-index="${index}" class="${[
        index === state.currentStageIndex ? "active" : "",
        stageComplete(stage) ? "done" : "",
        hasPain(stage) ? "has-pain" : "",
        Number(stage.emotionScore) <= -2 ? "low-emotion" : ""
      ].filter(Boolean).join(" ")}" style="--nav-delay: ${index * 45}ms">
        <span class="stage-index">${String(stage.id).padStart(2, "0")}</span>
        <span class="stage-name">${escapeHtml(stage.name)}</span>
      </button>
    `).join("");
  }

  function renderProgress() {
    const done = state.data.stages.filter(stageComplete).length;
    $("#progressText").textContent = `${done} / ${STAGES.length}`;
    $("#progressBar").style.width = `${(done / STAGES.length) * 100}%`;
    const lights = $("#progressLights");
    if (lights) {
      lights.innerHTML = state.data.stages.map((stage, index) => `
        <span class="${stageComplete(stage) ? "lit" : ""} ${index === state.currentStageIndex ? "current" : ""}" style="--light-delay: ${index * 45}ms"></span>
      `).join("");
    }
    const hint = $("#completionHint");
    if (hint) {
      hint.textContent = done === STAGES.length ? "旅程已完整点亮，可以导出 JSON。" : "沿着 9 个阶段，把真实体验一点点点亮。";
      hint.classList.toggle("complete", done === STAGES.length);
      $("#progressBar").parentElement.classList.toggle("complete", done === STAGES.length);
    }
  }

  function renderStage() {
    const stage = state.data.stages[state.currentStageIndex];
    $("#stageEyebrow").textContent = `Stage ${String(stage.id).padStart(2, "0")}`;
    $("#stageTitle").textContent = stage.name;
    $("#stageDescription").textContent = stage.description;
    renderProfile();

    form.status.value = stage.status;
    form.goal.value = stage.goal;
    form.actions.value = stage.actions;
    form.thoughts.value = stage.thoughts;
    $("#emotionScore").value = stage.emotionScore;
    form.emotionReason.value = stage.emotionReason;
    form.painSeverity.value = stage.painSeverity;
    form.painPoint.value = stage.painPoint;
    form.opportunity.value = stage.opportunity;
    form.contentOpportunity.value = stage.contentOpportunity;
    form.evidenceText.value = stage.evidenceText;
    renderEvidenceFiles();

    document.querySelectorAll("input[name='touchpoints']").forEach((input) => {
      input.checked = stage.touchpoints.includes(input.value);
    });

    updateEmotionDisplay(stage.emotionScore);
    animateStagePanel();
    $("#prevButton").disabled = state.currentStageIndex === 0;
    $("#nextButton").textContent = state.currentStageIndex === STAGES.length - 1 ? "回到第一阶段" : "下一阶段";
    renderStageNav();
    renderProgress();
    renderCurve();
  }

  function readProfileFromForm({ commitName = false } = {}) {
    if (!state.data) return;
    if (commitName) {
      const name = $("#personNameInput").value.trim();
      state.data.personName = name || "未命名";
    }
    state.data.experienceDate = $("#experienceDate").value;
    state.data.sampleType = $("#sampleType").value;
    state.data.personaRole = $("#personaRole").value.trim();
    state.data.tags = parseTags($("#sampleTags").value);
  }

  function readStageFromForm(options = {}) {
    const stage = state.data.stages[state.currentStageIndex];
    const score = Number($("#emotionScore").value);
    stage.status = form.status.value;
    stage.goal = form.goal.value.trim();
    stage.actions = form.actions.value.trim();
    stage.thoughts = form.thoughts.value.trim();
    stage.touchpoints = Array.from(document.querySelectorAll("input[name='touchpoints']:checked")).map((input) => input.value);
    stage.emotionScore = score;
    stage.emotionLabel = EMOTIONS[String(score)].label;
    stage.emotionReason = form.emotionReason.value.trim();
    stage.painSeverity = form.painSeverity.value;
    stage.painPoint = form.painPoint.value.trim();
    stage.opportunity = form.opportunity.value.trim();
    stage.contentOpportunity = form.contentOpportunity.value.trim();
    stage.evidenceText = form.evidenceText.value.trim();
    readProfileFromForm(options);
  }

  function updateEmotionDisplay(score) {
    const emotion = EMOTIONS[String(score)];
    const emoji = $("#emotionEmoji");
    const label = $("#emotionLabel");
    if (emoji.textContent !== emotion.emoji) {
      emoji.classList.remove("pulse");
      void emoji.offsetWidth;
      emoji.classList.add("pulse");
    }
    emoji.textContent = emotion.emoji;
    label.textContent = `${score > 0 ? "+" : ""}${score} · ${emotion.label}`;
    label.classList.remove("soft-change");
    void label.offsetWidth;
    label.classList.add("soft-change");
    const editor = document.querySelector(".emotion-editor");
    if (editor) {
      editor.dataset.mood = Number(score) > 0 ? "positive" : Number(score) < 0 ? "negative" : "neutral";
    }
    const slider = $("#emotionScore");
    if (slider) slider.style.setProperty("--emotion-level", `${((Number(score) + 3) / 6) * 100}%`);
  }

  async function fillPending() {
    const stage = state.data.stages[state.currentStageIndex];
    const updates = [
      ["status", "暂未体验"],
      ["goal", "暂未体验，暂时没有实际目标。"],
      ["actions", "暂未体验，尚未发生实际行为。"],
      ["thoughts", "我预期会担心下一步要求是否清楚、资料是否准备齐、自己会不会看不懂。"],
      ["emotionScore", -1],
      ["emotionReason", "还没走到这一步，但预期会有一点不确定感。"],
      ["painSeverity", "轻微"],
      ["painPoint", "暂未体验，预期可能卡在资料准备、沟通成本或方案理解。"],
      ["opportunity", "提前给小白版说明、资料清单和下一步提醒。"],
      ["contentOpportunity", `《${stage.name}前用户最容易担心什么？》`],
      ["evidenceText", ""]
    ];
    stage.touchpoints = [];
    for (const [key, value] of updates) {
      stage[key] = value;
      if (key === "emotionScore") stage.emotionLabel = EMOTIONS[String(value)].label;
      renderStage();
      await wait(state.reducedMotion ? 0 : 70);
    }
    renderStage();
    queueSave();
    showToast("已按暂未体验整理好这一阶段");
  }

  function renderCurve() {
    const width = 940;
    const height = 300;
    const padX = 54;
    const top = 96;
    const bottom = 58;
    const chartHeight = height - top - bottom;
    const points = state.data.stages.map((stage, index) => {
      const x = padX + index * ((width - padX * 2) / (STAGES.length - 1));
      const y = top + ((3 - Number(stage.emotionScore)) / 6) * chartHeight;
      return { x, y, stage, index };
    });
    const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
    const area = `${padX},${height - bottom} ${polyline} ${width - padX},${height - bottom}`;
    const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
    const axisLines = [-3, 0, 3].map((score) => {
      const y = top + ((3 - score) / 6) * chartHeight;
      return `<line class="curve-axis" x1="${padX}" y1="${y}" x2="${width - padX}" y2="${y}"></line>`;
    }).join("");
    const annotationLines = points.map((point) => {
      const box = liveAnnotationBox(point, width);
      return `<line class="annotation-link" x1="${point.x}" y1="${point.y}" x2="${point.x}" y2="${box.linkY}"></line>`;
    }).join("");
    const nodes = points.map((point) => {
      const shortName = point.stage.name.replace("灯光设计服务", "").replace("修改确认 / 下单 / 施工衔接", "修改确认").slice(0, 6);
      const score = Number(point.stage.emotionScore);
      const emotion = EMOTIONS[String(score)];
      const box = liveAnnotationBox(point, width);
      const reason = truncateText(point.stage.emotionReason || "写下这一刻为什么有这个感受", 22);
      const full = `${point.stage.name}：${emotion.label}，${point.stage.emotionReason || "暂无情绪原因"}`;
      return `
        <g class="curve-node-group ${point.index === state.currentStageIndex ? "current" : ""}" data-curve-stage="${point.index}" tabindex="0" role="button" aria-label="跳转到${escapeHtml(point.stage.name)}" style="--node-delay: ${point.index * 45}ms">
          <title>${escapeHtml(full)}</title>
          <circle class="curve-node" cx="${point.x}" cy="${point.y}" r="6"></circle>
          <text class="curve-emoji" x="${point.x}" y="${point.y - 14}">${emotion.emoji}</text>
        </g>
        <foreignObject class="live-annotation" x="${box.x}" y="${box.y}" width="${box.width}" height="64">
          <div xmlns="http://www.w3.org/1999/xhtml" class="live-annotation-card" title="${escapeHtml(full)}">
            <strong>${emotion.emoji} ${escapeHtml(emotion.label)}</strong>
            <span>${escapeHtml(reason)}</span>
          </div>
        </foreignObject>
        <text class="curve-score" x="${point.x}" y="${point.y + 24}">${score > 0 ? "+" : ""}${score}</text>
        <text class="curve-label" x="${point.x}" y="${height - 18}">${escapeHtml(shortName)}</text>
      `;
    }).join("");

    $("#curvePreview").innerHTML = `
      <svg class="curve-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="实时情绪曲线">
        ${axisLines}
        <polygon class="curve-area" points="${area}"></polygon>
        <path class="curve-line draw-line" d="${path}"></path>
        ${annotationLines}
        ${nodes}
      </svg>
    `;
  }

  function liveAnnotationBox(point, width) {
    const isTop = point.index % 2 === 0;
    const boxWidth = 136;
    const rawX = point.x - boxWidth / 2;
    const x = Math.max(8, Math.min(width - boxWidth - 8, rawX));
    const y = isTop ? 16 : 34;
    return { x, y, width: boxWidth, linkY: isTop ? y + 58 : y + 8 };
  }

  async function addEvidenceFiles(fileList, source = "upload") {
    const stage = state.data.stages[state.currentStageIndex];
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;
    const availableSlots = MAX_EVIDENCE_FILES - stage.evidenceFiles.length;
    if (availableSlots <= 0) {
      showToast(`每个阶段最多保留 ${MAX_EVIDENCE_FILES} 份证据，请先整理或删除。`);
      return;
    }
    const accepted = files.slice(0, availableSlots);
    if (files.length > availableSlots) {
      showToast(`已添加前 ${availableSlots} 份证据，超过数量的文件没有加入。`);
    }
    for (const file of accepted) {
      const evidence = await buildEvidenceRecord(file, source);
      stage.evidenceFiles.push(evidence);
    }
    renderEvidenceFiles();
    renderStageNav();
    renderProgress();
    queueSave();
    showToast(`已添加 ${accepted.length} 份证据`);
  }

  async function buildEvidenceRecord(file, source) {
    const id = `evidence_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const category = categorizeFile(file);
    const storageKey = `${state.data.journeyId || "journey"}:stage-${state.data.stages[state.currentStageIndex].id}:${id}`;
    const record = {
      id,
      storageKey,
      stageId: state.data.stages[state.currentStageIndex].id,
      name: file.name || `粘贴截图-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`,
      type: file.type || inferMimeType(file.name),
      category,
      size: file.size,
      lastModified: file.lastModified || Date.now(),
      uploadedAt: new Date().toISOString(),
      source,
      note: "",
      hasOriginalFile: true,
      storedInJson: false,
      storedInIndexedDB: true,
      previewDataUrl: "",
      thumbnailDataUrl: ""
    };
    if (file.size > LARGE_FILE_SIZE) {
      record.largeFile = true;
      showToast("该文件较大，建议后续通过完整证据包 ZIP 导出，不建议塞入 JSON。");
    }
    if (category === "image") {
      try {
        record.thumbnailDataUrl = await compressImage(file, 360, 0.72);
      } catch {
        record.thumbnailDataUrl = "";
      }
    }
    try {
      await putEvidenceBlob(record, file);
    } catch {
      record.storedInIndexedDB = false;
      record.hasOriginalFile = false;
      showToast("文件本体保存失败，JSON 会保留文件信息；建议稍后导出备份。");
    }
    return record;
  }

  function renderEvidenceFiles() {
    const stage = state.data.stages[state.currentStageIndex];
    const list = $("#evidenceAttachmentList");
    if (!list) return;
    if (!stage.evidenceFiles.length) {
      list.innerHTML = `<p class="evidence-empty">还没有上传证据。截图、点位图、方案 PDF 都可以先放到这里。</p>`;
      return;
    }
    list.innerHTML = stage.evidenceFiles.map((file) => `
      <article class="evidence-card ${file.category === "image" ? "image" : ""}" data-evidence-id="${escapeHtml(file.id)}">
        <div class="evidence-preview">
          ${file.category === "image" && evidenceThumbnail(file)
            ? `<img src="${escapeHtml(evidenceThumbnail(file))}" alt="${escapeHtml(file.name)}">`
            : `<span>${escapeHtml(fileTypeLabel(file))}</span>`}
        </div>
        <div class="evidence-meta">
          <strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong>
          <span>${escapeHtml(fileTypeLabel(file))} · ${formatFileSize(file.size)} · ${formatDateTime(file.uploadedAt || file.lastModified)}</span>
          ${file.largeFile ? `<em>文件较大，请后续用完整证据包整理源文件</em>` : ""}
          ${file.storageKey ? `<em>源文件已保存在本机 IndexedDB</em>` : ""}
        </div>
        <div class="evidence-actions">
          ${file.category === "image" && evidenceThumbnail(file)
            ? `<button class="ghost-button evidence-preview-button" type="button" data-preview-evidence="${escapeHtml(file.id)}">预览</button>`
            : `<button class="ghost-button evidence-open-button" type="button" data-open-evidence="${escapeHtml(file.id)}"${file.storageKey ? "" : " disabled"}>${file.storageKey ? "打开" : "待证据包"}</button>`}
          <button class="ghost-button evidence-delete-button" type="button" data-delete-evidence="${escapeHtml(file.id)}">删除</button>
        </div>
        <label class="evidence-note">
          <span>证据说明</span>
          <textarea data-evidence-note="${escapeHtml(file.id)}" rows="2" placeholder="这份证据证明了什么？为什么影响这一阶段体验？">${escapeHtml(file.note || "")}</textarea>
        </label>
      </article>
    `).join("");
  }

  function evidenceThumbnail(file) {
    return file.thumbnailDataUrl || file.previewDataUrl || "";
  }

  async function migrateEvidenceFilesToIndexedDB() {
    if (!state.data || !Array.isArray(state.data.stages)) return;
    let migrated = false;
    for (const stage of state.data.stages) {
      const files = Array.isArray(stage.evidenceFiles) ? stage.evidenceFiles : [];
      for (const file of files) {
        if (file.category !== "image" || !file.previewDataUrl) continue;
        if (!file.thumbnailDataUrl) {
          file.thumbnailDataUrl = await createThumbnailFromDataUrl(file.previewDataUrl).catch(() => file.previewDataUrl);
          migrated = true;
        }
        if (!file.storageKey) {
          const storageKey = `${state.data.journeyId || "journey"}:stage-${stage.id}:${file.id || createId("evidence")}`;
          const blob = dataUrlToBlob(file.previewDataUrl);
          file.storageKey = storageKey;
          file.storedInIndexedDB = true;
          file.storedInJson = false;
          await putEvidenceBlob({
            ...file,
            storageKey,
            stageId: stage.id,
            type: file.type || blob.type || "image/jpeg",
            category: "image",
            size: file.size || blob.size,
            lastModified: file.lastModified || Date.now(),
            uploadedAt: file.uploadedAt || new Date().toISOString()
          }, blob).catch(() => {
            file.storedInIndexedDB = false;
          });
          migrated = true;
        }
        if (file.storageKey && file.thumbnailDataUrl) {
          delete file.previewDataUrl;
          migrated = true;
        }
      }
    }
    if (migrated) {
      saveData();
      renderEvidenceFiles();
      showToast("已把旧截图迁移到本机文件仓库，缓存占用会更轻。");
    }
  }

  async function createThumbnailFromDataUrl(dataUrl) {
    const blob = dataUrlToBlob(dataUrl);
    return compressImage(blob, 360, 0.72);
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

  function updateEvidenceNote(id, value) {
    const stage = state.data.stages[state.currentStageIndex];
    const file = stage.evidenceFiles.find((item) => item.id === id);
    if (!file) return;
    file.note = value.trim();
    queueSave();
  }

  function deleteEvidence(id) {
    const stage = state.data.stages[state.currentStageIndex];
    const file = stage.evidenceFiles.find((item) => item.id === id);
    stage.evidenceFiles = stage.evidenceFiles.filter((file) => file.id !== id);
    if (file && file.storageKey) {
      deleteEvidenceBlob(file.storageKey).catch(() => {});
    }
    renderEvidenceFiles();
    queueSave();
    showToast("证据已删除");
  }

  async function previewEvidence(id) {
    const stage = state.data.stages[state.currentStageIndex];
    const file = stage.evidenceFiles.find((item) => item.id === id);
    if (!file) return;
    let url = "";
    let revoke = false;
    if (file.storageKey) {
      try {
        const blob = await getEvidenceBlob(file.storageKey);
        if (blob) {
          url = URL.createObjectURL(blob);
          revoke = true;
        }
      } catch {
        url = "";
      }
    }
    if (!url) url = file.previewDataUrl || file.thumbnailDataUrl || "";
    if (!url) return;
    const viewer = window.open("", "_blank");
    if (!viewer) {
      showToast("浏览器阻止了预览窗口，可以先查看缩略图。");
      if (revoke) URL.revokeObjectURL(url);
      return;
    }
    viewer.document.write(`<title>${escapeHtml(file.name)}</title><img src="${url}" style="max-width:100%;height:auto;display:block;margin:0 auto;background:#f8fafc;">`);
    if (revoke) {
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  }

  async function openEvidence(id) {
    const stage = state.data.stages[state.currentStageIndex];
    const file = stage.evidenceFiles.find((item) => item.id === id);
    if (!file || !file.storageKey) {
      showToast("JSON 只保存文件信息。完整源文件请后续用证据包导出。");
      return;
    }
    try {
      const blob = await getEvidenceBlob(file.storageKey);
      if (!blob) {
        showToast("没有找到这个文件本体，可能是旧版导入的 JSON 元信息。");
        return;
      }
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch {
      showToast("文件打开失败，可以稍后导出证据包再整理。");
    }
  }

  async function compressImage(file, maxWidth = 1200, quality = 0.8) {
    const dataUrl = await readFileAsDataUrl(file);
    const image = await loadImage(dataUrl);
    const scale = Math.min(1, maxWidth / image.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
  }

  function categorizeFile(file) {
    const name = String(file.name || "").toLowerCase();
    const type = String(file.type || "").toLowerCase();
    if (type.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic)$/.test(name)) return "image";
    if (type.includes("pdf") || name.endsWith(".pdf")) return "pdf";
    if (/\.(xlsx?|csv)$/.test(name)) return "spreadsheet";
    if (/\.(docx?|txt)$/.test(name)) return "document";
    if (/\.(dwg|dxf)$/.test(name)) return "drawing";
    return "file";
  }

  function fileTypeLabel(file) {
    const category = file.category || "file";
    if (category === "image") return "IMG";
    if (category === "pdf") return "PDF";
    if (category === "spreadsheet") return file.name && file.name.toLowerCase().endsWith(".csv") ? "CSV" : "XLSX";
    if (category === "document") return "DOC";
    if (category === "drawing") return file.name && file.name.toLowerCase().endsWith(".dxf") ? "DXF" : "DWG";
    const ext = String(file.name || "").split(".").pop();
    return ext && ext.length <= 5 ? ext.toUpperCase() : "FILE";
  }

  function inferMimeType(name) {
    const lower = String(name || "").toLowerCase();
    if (lower.endsWith(".pdf")) return "application/pdf";
    if (lower.endsWith(".csv")) return "text/csv";
    if (lower.endsWith(".txt")) return "text/plain";
    return "application/octet-stream";
  }

  function formatFileSize(size) {
    const value = Number(size || 0);
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
    if (value >= 1024) return `${Math.round(value / 1024)} KB`;
    return `${value} B`;
  }

  function formatDateTime(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return "刚刚";
    return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function exportJson() {
    readStageFromForm({ commitName: true });
    saveData();
    const blob = new Blob([JSON.stringify(compactDataForStorage(state.data), null, 2)], { type: "application/json;charset=utf-8" });
    downloadBlob(blob, `${state.data.personName}-灯光旅程-${state.data.experienceDate || new Date().toISOString().slice(0, 10)}.json`);
    showToast("请把这个 JSON 文件发给西珈汇总");
  }

  async function exportEvidenceZip() {
    readStageFromForm({ commitName: true });
    saveData();
    if (!window.JSZip) {
      showToast("证据包组件未加载，请刷新页面后再试。");
      return;
    }

    const zip = new window.JSZip();
    const journey = compactDataForStorage(state.data);
    const usedPaths = new Set();
    let fileCount = 0;

    for (const stage of journey.stages) {
      const sourceStage = state.data.stages.find((item) => Number(item.id) === Number(stage.id)) || stage;
      const stageFolderName = `stage-${String(stage.id).padStart(2, "0")}-${safePathPart(stage.name)}`;
      const folder = zip.folder(`evidence/${stageFolderName}`);
      const files = Array.isArray(stage.evidenceFiles) ? stage.evidenceFiles : [];
      const sourceFiles = Array.isArray(sourceStage.evidenceFiles) ? sourceStage.evidenceFiles : [];

      for (const file of files) {
        const sourceFile = sourceFiles.find((item) => item.id === file.id) || file;
        let blob = null;
        if (sourceFile.storageKey) {
          blob = await getEvidenceBlob(sourceFile.storageKey).catch(() => null);
        }
        if (!blob && sourceFile.previewDataUrl) {
          blob = dataUrlToBlob(sourceFile.previewDataUrl);
        }
        if (!blob && sourceFile.thumbnailDataUrl && sourceFile.category === "image") {
          blob = dataUrlToBlob(sourceFile.thumbnailDataUrl);
        }

        file.hasOriginalFile = Boolean(blob);
        file.sourcePackageName = undefined;
        file.viewerObjectUrl = undefined;
        if (!blob || !folder) continue;

        const fileName = uniqueZipPath(`${stageFolderName}/${safeFileName(file.name || `evidence-${file.id}`)}`, usedPaths);
        const zipPath = `evidence/${fileName}`;
        file.zipPath = zipPath;
        folder.file(fileName.replace(`${stageFolderName}/`, ""), blob);
        fileCount += 1;
      }
    }

    zip.file("journey.json", JSON.stringify(journey, null, 2));
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
    downloadBlob(blob, `${state.data.personName}-灯光旅程证据包-${state.data.experienceDate || new Date().toISOString().slice(0, 10)}.zip`);
    showToast(`证据包已生成，包含 ${fileCount} 个附件和 journey.json`);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function safePathPart(value) {
    return String(value || "未命名")
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, "")
      .slice(0, 36) || "未命名";
  }

  function safeFileName(value) {
    return String(value || "evidence-file")
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/^\.+/, "")
      .slice(0, 120) || "evidence-file";
  }

  function uniqueZipPath(path, usedPaths) {
    if (!usedPaths.has(path)) {
      usedPaths.add(path);
      return path;
    }
    const dotIndex = path.lastIndexOf(".");
    const base = dotIndex > -1 ? path.slice(0, dotIndex) : path;
    const ext = dotIndex > -1 ? path.slice(dotIndex) : "";
    let index = 2;
    let next = `${base}-${index}${ext}`;
    while (usedPaths.has(next)) {
      index += 1;
      next = `${base}-${index}${ext}`;
    }
    usedPaths.add(next);
    return next;
  }

  function openExportDialog() {
    readStageFromForm({ commitName: true });
    const missing = missingFields();
    const dialog = $("#exportDialog");
    $("#exportMessage").textContent = missing.length
      ? "下面这些阶段还不够完整。你可以返回补充，也可以继续导出当前版本。"
      : "旅程数据已整理完成，可以下载个人 JSON。";
    const completed = state.data.stages.filter(stageComplete).length;
    const emotionCount = state.data.stages.filter((stage) => stage.emotionReason || Number.isFinite(Number(stage.emotionScore))).length;
    const painCount = state.data.stages.filter((stage) => stage.painPoint || ["明显", "严重"].includes(stage.painSeverity)).length;
    const opportunityCount = state.data.stages.filter((stage) => stage.opportunity || stage.contentOpportunity).length;
    const evidenceCount = state.data.stages.reduce((sum, stage) => sum + (stage.evidenceText ? 1 : 0) + (stage.evidenceFiles ? stage.evidenceFiles.length : 0), 0);
    $("#exportSummary").innerHTML = `
      <div><span>填写人</span><strong>${escapeHtml(state.data.personName)}</strong></div>
      <div><span>体验日期</span><strong>${escapeHtml(state.data.experienceDate || "未填写")}</strong></div>
      <div><span>已完成阶段</span><strong>${completed} / 9</strong></div>
      <div><span>情绪节点</span><strong>${emotionCount}</strong></div>
      <div><span>痛点记录</span><strong>${painCount}</strong></div>
      <div><span>机会记录</span><strong>${opportunityCount}</strong></div>
      <div><span>证据记录</span><strong>${evidenceCount}</strong></div>
    `;
    $("#missingList").innerHTML = missing.length
      ? missing.map((item) => `<div>${escapeHtml(item)}</div>`).join("")
      : "<div>没有缺项。</div>";
    dialog.showModal();
  }

  function hasPain(stage) {
    return ["轻微", "明显", "严重"].includes(stage.painSeverity) && Boolean(stage.painPoint || stage.emotionReason);
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function flashAutosave() {
    const status = $("#autosaveStatus");
    if (!status) return;
    status.classList.remove("show");
    void status.offsetWidth;
    status.classList.add("show");
    window.setTimeout(() => status.classList.remove("show"), 950);
  }

  function showToast(message) {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function animateStagePanel() {
    const panel = document.querySelector(".form-panel");
    if (!panel || state.reducedMotion) return;
    panel.classList.remove("stage-enter");
    void panel.offsetWidth;
    panel.classList.add("stage-enter");
  }

  function switchStage(index) {
    if (index === state.currentStageIndex) return;
    readStageFromForm();
    saveData();
    const panel = document.querySelector(".form-panel");
    if (!panel || state.reducedMotion) {
      state.currentStageIndex = index;
      renderStage();
      return;
    }
    panel.classList.add("stage-leave");
    window.setTimeout(() => {
      state.currentStageIndex = index;
      renderStage();
      panel.classList.remove("stage-leave");
    }, 150);
  }

  function markFieldSaved(target) {
    const group = target.closest(".field-group");
    if (!group || !target.value.trim()) return;
    group.classList.add("just-saved");
    clearTimeout(state.fieldTimers.get(group));
    const timer = window.setTimeout(() => group.classList.remove("just-saved"), 820);
    state.fieldTimers.set(group, timer);
  }

  function truncateText(value, max) {
    const text = String(value || "").trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function parseTags(value) {
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
    return String(value || "")
      .split(/[、,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function addPerson() {
    const name = $("#newPersonName").value.trim();
    if (!name) {
      showToast("请先填写姓名");
      return;
    }
    const person = {
      personId: createId("person"),
      journeyId: createId("journey"),
      personName: name,
      personaRole: $("#newPersonaRole").value.trim() || "内部体验用户",
      sampleType: $("#newSampleType").value || "内部体验者",
      experienceDate: $("#newExperienceDate").value || new Date().toISOString().slice(0, 10),
      tags: parseTags($("#newSampleTags").value)
    };
    state.people.push(person);
    state.currentJourneyId = person.journeyId;
    state.personId = person.personId;
    state.data = createBlankData(person);
    saveRegistry();
    saveData();
    $("#personDialog").close();
    $("#newPersonName").value = "";
    $("#newPersonaRole").value = "";
    $("#newSampleTags").value = "";
    renderProfile();
    renderSampleList();
    renderStage();
    showToast(`已新增一份体验：${person.personName}`);
  }

  function saveProfileChanges() {
    const nextName = $("#personNameInput").value.trim();
    if (!nextName) {
      showToast("请先填写姓名");
      $("#personNameInput").focus();
      return;
    }
    const duplicated = state.people.some((person) => (
      person.journeyId !== state.currentJourneyId
      && (loadData(person.journeyId).personName || person.personName) === nextName
    ));
    if (duplicated) {
      const confirmed = window.confirm("检测到已有同名填写人。仍然仅修改当前样本名称、不合并数据吗？");
      if (!confirmed) {
        renderProfile();
        return;
      }
    }
    readStageFromForm({ commitName: true });
    if (saveData()) {
      renderProfile();
      renderSampleList();
      showToast("填写人信息已保存");
    }
  }

  function openJourney(journeyId, options = {}) {
    if (!state.people.some((person) => person.journeyId === journeyId)) return;
    readStageFromForm();
    saveData();
    state.currentJourneyId = journeyId;
    const person = currentPerson();
    state.personId = person.personId;
    state.data = loadData(journeyId);
    state.currentStageIndex = 0;
    renderProfile();
    renderStage();
    renderSampleList();
    $("#sampleDialog").close();
    if (options.focusName) {
      window.setTimeout(() => {
        const input = $("#personNameInput");
        input.focus();
        input.select();
      }, 80);
    }
    showToast(`已打开 ${state.data.personName || "该样本"} 的完整旅程`);
  }

  async function deleteJourneyById(journeyId) {
    if (state.people.length <= 1) {
      showToast("至少需要保留一个样本");
      return;
    }
    const person = state.people.find((item) => item.journeyId === journeyId);
    if (!person) return;
    const data = loadData(journeyId);
    const confirmed = window.confirm(`确认删除「${data.personName || person.personName}」在当前浏览器里的填写缓存吗？这不会删除已经下载到电脑上的 JSON 文件。`);
    if (!confirmed) return;
    await deleteJourneyEvidenceFiles(data);
    localStorage.removeItem(journeyStorageKey(person.journeyId));
    localStorage.removeItem(legacyStorageKey(person.personName));
    state.people = state.people.filter((item) => item.journeyId !== journeyId);
    if (state.currentJourneyId === journeyId) {
      state.currentJourneyId = state.people[0].journeyId;
      state.personId = state.people[0].personId;
      state.data = loadData(state.currentJourneyId);
      state.currentStageIndex = 0;
    }
    saveRegistry();
    renderProfile();
    renderStage();
    renderSampleList();
    showToast(`已删除 ${data.personName || person.personName} 的本机缓存`);
  }

  async function deleteJourneyEvidenceFiles(data) {
    if (!data || !Array.isArray(data.stages)) return;
    const keys = data.stages
      .flatMap((stage) => Array.isArray(stage.evidenceFiles) ? stage.evidenceFiles : [])
      .map((file) => file.storageKey)
      .filter(Boolean);
    await Promise.all(keys.map((key) => deleteEvidenceBlob(key).catch(() => {})));
  }

  function escapeHtml(value) {
    return String(value)
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

    state.people = loadRegistry().people;
    state.currentJourneyId = state.people[0].journeyId;
    state.personId = state.people[0].personId;
    renderTouchpoints();
    state.data = loadData(state.currentJourneyId);
    renderProfile();
    renderStage();

    $("#experienceDate").addEventListener("input", () => {
      readStageFromForm();
      queueSave();
    });

    $("#sampleType").addEventListener("change", () => {
      readStageFromForm();
      queueSave();
    });

    $("#personaRole").addEventListener("input", () => {
      readStageFromForm();
      queueSave();
    });

    $("#sampleTags").addEventListener("input", () => {
      readStageFromForm();
      queueSave();
    });

    $("#saveProfileButton").addEventListener("click", saveProfileChanges);
    $("#openSamplesButton").addEventListener("click", () => {
      renderSampleList();
      $("#sampleDialog").showModal();
    });
    $("#sampleList").addEventListener("click", (event) => {
      const openButton = event.target.closest("[data-open-journey]");
      if (openButton) {
        openJourney(openButton.dataset.openJourney);
        return;
      }
      const renameButton = event.target.closest("[data-rename-journey]");
      if (renameButton) {
        openJourney(renameButton.dataset.renameJourney, { focusName: true });
        return;
      }
      const deleteButton = event.target.closest("[data-delete-journey]");
      if (deleteButton) deleteJourneyById(deleteButton.dataset.deleteJourney);
    });

    form.addEventListener("input", (event) => {
      readStageFromForm();
      updateEmotionDisplay($("#emotionScore").value);
      renderStageNav();
      renderProgress();
      renderCurve();
      if (event.target.matches("textarea")) markFieldSaved(event.target);
      queueSave();
    });

    form.addEventListener("change", () => {
      readStageFromForm();
      renderStageNav();
      renderProgress();
      renderCurve();
      queueSave();
    });

    $("#stageNav").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-index]");
      if (!button) return;
      switchStage(Number(button.dataset.index));
    });

    $("#prevButton").addEventListener("click", () => {
      switchStage(Math.max(0, state.currentStageIndex - 1));
    });

    $("#nextButton").addEventListener("click", () => {
      switchStage(state.currentStageIndex === STAGES.length - 1 ? 0 : state.currentStageIndex + 1);
    });

    $("#curvePreview").addEventListener("click", (event) => {
      const node = event.target.closest("[data-curve-stage]");
      if (!node) return;
      switchStage(Number(node.dataset.curveStage));
      document.querySelector(".form-panel").scrollIntoView({ block: "start", behavior: state.reducedMotion ? "auto" : "smooth" });
    });

    $("#curvePreview").addEventListener("keydown", (event) => {
      if (!["Enter", " "].includes(event.key)) return;
      const node = event.target.closest("[data-curve-stage]");
      if (!node) return;
      event.preventDefault();
      switchStage(Number(node.dataset.curveStage));
    });

    $("#emotionScore").addEventListener("pointerup", () => {
      const editor = document.querySelector(".emotion-editor");
      if (!editor || state.reducedMotion) return;
      editor.classList.remove("settle");
      void editor.offsetWidth;
      editor.classList.add("settle");
    });

    const evidenceDropzone = $("#evidenceDropzone");
    const evidenceInput = $("#evidenceFileInput");
    evidenceDropzone.addEventListener("click", () => evidenceInput.click());
    evidenceDropzone.addEventListener("keydown", (event) => {
      if (!["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      evidenceInput.click();
    });
    evidenceInput.addEventListener("change", (event) => {
      addEvidenceFiles(event.target.files, "upload").finally(() => {
        event.target.value = "";
      });
    });
    ["dragenter", "dragover"].forEach((type) => {
      evidenceDropzone.addEventListener(type, (event) => {
        event.preventDefault();
        evidenceDropzone.classList.add("drag-over");
      });
    });
    ["dragleave", "drop"].forEach((type) => {
      evidenceDropzone.addEventListener(type, (event) => {
        event.preventDefault();
        evidenceDropzone.classList.remove("drag-over");
      });
    });
    evidenceDropzone.addEventListener("drop", (event) => {
      addEvidenceFiles(event.dataTransfer.files, "drag");
    });
    document.addEventListener("paste", (event) => {
      const activeInEvidence = document.activeElement && document.activeElement.closest && document.activeElement.closest(".evidence-field");
      if (!activeInEvidence) return;
      const files = Array.from(event.clipboardData && event.clipboardData.files ? event.clipboardData.files : []);
      if (!files.length) return;
      event.preventDefault();
      addEvidenceFiles(files, "paste");
    });
    $("#evidenceAttachmentList").addEventListener("input", (event) => {
      const note = event.target.closest("[data-evidence-note]");
      if (!note) return;
      updateEvidenceNote(note.dataset.evidenceNote, note.value);
    });
    $("#evidenceAttachmentList").addEventListener("click", (event) => {
      const deleteButton = event.target.closest("[data-delete-evidence]");
      if (deleteButton) {
        deleteEvidence(deleteButton.dataset.deleteEvidence);
        return;
      }
      const previewButton = event.target.closest("[data-preview-evidence]");
      if (previewButton) {
        previewEvidence(previewButton.dataset.previewEvidence);
        return;
      }
      const openButton = event.target.closest("[data-open-evidence]");
      if (openButton) openEvidence(openButton.dataset.openEvidence);
    });

    $("#fillPendingButton").addEventListener("click", fillPending);
    $("#manualSaveButton").addEventListener("click", manualSave);
    $("#cloudSubmitButton").addEventListener("click", () => {
      submitCurrentJourneyToCloud();
    });
    $("#exportJsonButton").addEventListener("click", openExportDialog);
    $("#confirmExportButton").addEventListener("click", () => {
      $("#exportDialog").close();
      exportJson();
    });
    $("#confirmExportZipButton").addEventListener("click", () => {
      $("#exportDialog").close();
      exportEvidenceZip().catch((error) => {
        showToast(`证据包导出失败：${error.message}`);
      });
    });
    $("#addPersonButton").addEventListener("click", () => {
      $("#newExperienceDate").value = new Date().toISOString().slice(0, 10);
      $("#personDialog").showModal();
    });
    $("#confirmAddPersonButton").addEventListener("click", addPerson);
  }

  init();
})();

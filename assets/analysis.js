(function () {
  "use strict";

  const DASHBOARD_DB_NAME = "lightingJourneyDashboardDB";
  const DASHBOARD_SESSION_KEY = "lightingJourneyDashboard:lastSessionId";
  const STORE_SESSIONS = "dashboardSessions";
  const STORE_JOURNEYS = "journeys";
  const STORE_EVIDENCE = "evidenceFiles";
  const PUBLISHED_MANIFEST_PATH = "./data/published-manifest.json";
  const BRAND_MAP = [
    { brand: "柏曼", personName: "戚日莲", status: "较完整", tone: "#5f91bd" },
    { brand: "高灯大师", personName: "谢珊珊", status: "前段有效", tone: "#7fa9cc" },
    { brand: "Lipro", personName: "李娜", status: "卡点集中", tone: "#9fb7cc" }
  ];
  const STAGES = [
    { id: 1, name: "第一次了解灯光设计服务", short: "第一次了解" },
    { id: 2, name: "发起咨询", short: "发起咨询" },
    { id: 3, name: "明确服务内容与价格", short: "服务与价格" },
    { id: 4, name: "提交基础信息", short: "提交信息" },
    { id: 5, name: "准备并提交资料", short: "准备资料" },
    { id: 6, name: "需求沟通与确认", short: "需求沟通" },
    { id: 7, name: "等待方案", short: "等待方案" },
    { id: 8, name: "查看并理解方案", short: "查看方案" },
    { id: 9, name: "修改确认 / 下单 / 施工衔接", short: "修改施工" }
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
  const STATIC_STAGES = [
    { title: "第一次了解", short: "小红书 / 淘宝搜索", observe: "用户会先在小红书、淘宝搜索灯光设计，但容易看到灯具内容多、服务内容少，难以判断服务是否值得。", opportunity: ["建立灯光设计服务入口", "流程、费用、交付物、案例和适合阶段前置", "减少用户自己做攻略的成本"] },
    { title: "发起咨询", short: "客服首轮判断", observe: "客服第一轮直接影响信任感。单纯推拍单链接，或直接问专业问题，会让小白用户产生压力。", opportunity: ["客服从响应型改为引导型", "先判断装修阶段，再解释服务路径", "把用户从问问题带到愿意继续聊"] },
    { title: "服务与价格", short: "套餐、周期、规则", observe: "用户会反复确认套餐差异、服务内容、周期、是否退款、是否抵扣灯款。", opportunity: ["用一张卡讲清价格档位", "说明包含内容、交付周期、修改次数和费用规则", "降低被推销感"] },
    { title: "提交基础信息", short: "问卷与案例", observe: "案例图和问卷会影响用户对专业度的判断。案例不够高级或不够真实，会削弱信任。", opportunity: ["按户型、面积、风格、家庭结构建立案例库", "案例展示设计前问题和设计后解决了什么", "让用户看到我家也能这样改善"] },
    { title: "准备资料", short: "户型图 / CAD / 吊顶图", observe: "用户提交资料后，容易不知道这些资料会怎样影响方案，也不知道下一步何时反馈。", opportunity: ["资料提交后给确认回执", "说明已收到什么、缺什么、下一步做什么", "给明确反馈时间"] },
    { title: "需求沟通", short: "从参数转向生活", observe: "用户不会主动表达照度、色温、防眩等专业需求，但能表达老人、小孩、观影、做饭、学习、起夜等生活场景。", opportunity: ["需求问卷从参数型改为生活方式型", "设计师围绕真实场景做方案", "让用户感到被理解，而不是被考专业题"] },
    { title: "等待方案", short: "进度感与专业感", observe: "等待太久会焦虑，出图太快也可能让用户怀疑专业度；过程中需要进度感。", opportunity: ["提供进度提示", "展示建模、布灯、清单、复核等节点", "让等待变成可感知服务"] },
    { title: "查看方案", short: "图纸与清单理解", observe: "灯位图、回路图、照度图、灯具清单专业但难懂；用户需要知道为什么这样设计。", opportunity: ["每套方案配小白版说明", "解释空间目标、设计理由、用户确认项、施工注意点", "把专业交付转成决策工具"] },
    { title: "修改 / 下单 / 施工", short: "闭环衔接", observe: "该阶段样本还不够完整，但可预判会卡在修改边界、施工衔接、清单购买和售后责任。", opportunity: ["下一轮重点补齐修改次数、施工图对接、购买清单", "明确安装售后和设计师合作闭环", "用真实成交样本验证转化"] }
  ];

  const state = {
    records: [],
    objectUrls: new Set(),
    toastTimer: null,
    dataSource: ""
  };

  const $ = (selector) => document.querySelector(selector);

  function openDashboardDb() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("当前浏览器不支持 IndexedDB"));
        return;
      }
      const request = indexedDB.open(DASHBOARD_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_SESSIONS)) db.createObjectStore(STORE_SESSIONS, { keyPath: "sessionId" });
        if (!db.objectStoreNames.contains(STORE_JOURNEYS)) db.createObjectStore(STORE_JOURNEYS, { keyPath: "dashboardJourneyKey" });
        if (!db.objectStoreNames.contains(STORE_EVIDENCE)) db.createObjectStore(STORE_EVIDENCE, { keyPath: "dashboardFileKey" });
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

  async function restoreDashboardSession() {
    const sessionId = localStorage.getItem(DASHBOARD_SESSION_KEY);
    if (!sessionId) return [];
    const db = await openDashboardDb();
    try {
      const tx = db.transaction([STORE_SESSIONS, STORE_JOURNEYS, STORE_EVIDENCE], "readonly");
      const session = await requestToPromise(tx.objectStore(STORE_SESSIONS).get(sessionId));
      if (!session || !Array.isArray(session.journeyIds)) return [];
      const journeyStore = tx.objectStore(STORE_JOURNEYS);
      const evidenceStore = tx.objectStore(STORE_EVIDENCE);
      const records = [];
      for (const journeyKey of session.journeyIds) {
        const stored = await requestToPromise(journeyStore.get(journeyKey));
        if (!stored) continue;
        const record = normalizeRecord(stored);
        record._dashboardKey = stored.dashboardJourneyKey || journeyKey;
        await hydrateEvidence(record, evidenceStore);
        records.push(record);
      }
      await transactionDone(tx);
      return records;
    } finally {
      db.close();
    }
  }

  async function hydrateEvidence(record, evidenceStore) {
    for (const stage of record.stages || []) {
      for (const file of stage.evidenceFiles || []) {
        if (!file.dashboardFileKey) continue;
        const stored = await requestToPromise(evidenceStore.get(file.dashboardFileKey));
        if (!stored || !stored.blob) continue;
        file._blob = normalizeBlob(file, stored.blob);
        file.hasOriginalFile = true;
      }
    }
  }

  async function loadPublishedPackages() {
    let manifest;
    try {
      const response = await fetch(PUBLISHED_MANIFEST_PATH, { cache: "no-store" });
      if (!response.ok) return [];
      manifest = await response.json();
    } catch {
      return [];
    }
    const packages = Array.isArray(manifest.packages) ? manifest.packages : [];
    if (!packages.length) return [];
    showToast("正在读取公开证据包...");
    const records = [];
    for (const item of packages) {
      const response = await fetch(item.url);
      if (!response.ok) continue;
      const blob = await response.blob();
      const fileName = item.url.split("/").pop() || `${item.name || "journey"}.zip`;
      const file = new File([blob], fileName, { type: "application/zip" });
      records.push(await readZipPackage(file));
    }
    return records;
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
    for (const stage of record.stages || []) {
      const files = Array.isArray(stage.evidenceFiles) ? stage.evidenceFiles : [];
      for (const evidence of files) {
        const entry = findEvidenceEntry(evidence, entries);
        if (!entry) continue;
        const blob = await entry.async("blob");
        evidence.hasOriginalFile = true;
        evidence.zipPath = evidence.zipPath || entry.name;
        evidence.sourcePackageName = packageName;
        evidence._blob = normalizeBlob(evidence, blob);
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

  function normalizeRecord(input) {
    const stages = STAGES.map((stage, index) => {
      const value = (input.stages || [])[index] || {};
      const score = Number(value.emotionScore || 0);
      return {
        id: stage.id,
        name: value.name || stage.name,
        description: value.description || "",
        status: value.status || "已体验",
        goal: value.goal || "",
        actions: value.actions || "",
        touchpoints: Array.isArray(value.touchpoints) ? value.touchpoints : [],
        thoughts: value.thoughts || "",
        emotionScore: score,
        emotionLabel: value.emotionLabel || emotionFor(score).label,
        emotionReason: value.emotionReason || "",
        painSeverity: value.painSeverity || "没有",
        painPoint: value.painPoint || "",
        opportunity: value.opportunity || "",
        contentOpportunity: value.contentOpportunity || "",
        evidenceText: value.evidenceText || "",
        evidenceFiles: Array.isArray(value.evidenceFiles)
          ? value.evidenceFiles.map((file, fileIndex) => ({
            ...file,
            id: file.id || `evidence_${stage.id}_${fileIndex}`
          }))
          : []
      };
    });
    return {
      journeyId: input.journeyId || input.dashboardJourneyKey || "",
      personId: input.personId || "",
      personName: input.personName || "未命名",
      personaRole: input.personaRole || "",
      sampleType: input.sampleType || "",
      experienceDate: input.experienceDate || "",
      tags: Array.isArray(input.tags) ? input.tags : [],
      stages
    };
  }

  function renderAll() {
    renderMeta();
    renderEmotionCurves();
    renderStaticStages(0);
    bindStaticInteractions();
    bindReveal();
  }

  function renderMeta() {
    const sampleCount = $("#sampleCount");
    const evidenceCount = $("#evidenceCount");
    const lowestStageLabel = $("#lowestStageLabel");
    const restoreState = $("#restoreState");
    const mappedRecords = BRAND_MAP.map((item) => findRecord(item.personName)).filter(Boolean);
    const allFiles = mappedRecords.flatMap((record) => record.stages.flatMap((stage) => stage.evidenceFiles || []));
    sampleCount.textContent = String(mappedRecords.length);
    evidenceCount.textContent = String(allFiles.length);
    const low = buildLowestStage(mappedRecords);
    lowestStageLabel.textContent = low ? STAGES[low.index].short : "待读取";
    const sourceLabel = state.dataSource === "published" ? "公开发布数据" : "展示页导入会话";
    restoreState.textContent = mappedRecords.length
      ? `已读取 ${mappedRecords.map((record) => record.personName).join("、")} 的${sourceLabel}。`
      : "还没有读取到展示页导入会话，请先在展示页导入 JSON / 证据包 ZIP。";
  }

  function renderEmotionCurves() {
    const container = $("#emotionCurves");
    container.innerHTML = BRAND_MAP.map((item) => {
      const record = findRecord(item.personName);
      return record ? renderCurveCard(item, record) : renderEmptyCurveCard(item);
    }).join("");
    container.querySelectorAll("[data-curve-node]").forEach((button) => {
      button.addEventListener("click", () => {
        const record = findRecord(button.dataset.personName);
        if (!record) return;
        const stage = record.stages.find((item) => String(item.id) === button.dataset.stageId);
        if (stage) openStageDrawer(record, stage, button.dataset.brand);
      });
    });
  }

  function renderCurveCard(mapping, record) {
    const points = record.stages.map((stage, index) => {
      const x = 8 + (index / Math.max(1, record.stages.length - 1)) * 84;
      const y = scoreToPercent(stage.emotionScore);
      return { stage, x, y };
    });
    const path = points.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
    const low = minStage(record.stages);
    const high = maxStage(record.stages);
    const firstReason = record.stages.find((stage) => stage.emotionReason)?.emotionReason || "点击节点查看每个阶段的完整原因和证据。";
    return `
      <article class="analysis-card emotion-card">
        <header class="emotion-card-header">
          <div>
            <h3>${escapeHtml(mapping.brand)}情绪曲线</h3>
            <p>${escapeHtml(record.experienceDate || "未填写日期")} · ${escapeHtml(record.sampleType || "样本")}</p>
          </div>
          <span class="status-pill">${escapeHtml(mapping.status)}</span>
        </header>
        <div class="curve-canvas">
          <span class="curve-axis-label high">+3</span>
          <span class="curve-axis-label mid">0</span>
          <span class="curve-axis-label low">-3</span>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path d="${path}" fill="none" stroke="${mapping.tone}" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"></path>
            <path d="${path} L 92 92 L 8 92 Z" fill="${mapping.tone}" opacity=".08"></path>
          </svg>
          ${points.map(({ stage, x, y }) => {
            const emotion = emotionFor(stage.emotionScore);
            return `<button class="curve-node" type="button" style="left:${x}%;top:${y}%" data-curve-node data-brand="${escapeHtml(mapping.brand)}" data-person-name="${escapeHtml(record.personName)}" data-stage-id="${stage.id}" title="${escapeHtml(stage.name)}：${formatScore(stage.emotionScore)} ${escapeHtml(stage.emotionLabel || emotion.label)}">${emotion.emoji}</button>`;
          }).join("")}
        </div>
        <div class="curve-stage-labels">${STAGES.map((stage) => `<span>${escapeHtml(stage.short)}</span>`).join("")}</div>
        <p class="curve-reason">${escapeHtml(truncateText(firstReason, 72))}</p>
        <div class="curve-stage-badges">
          <div><span>最低谷</span><strong>${escapeHtml(low.name)} · ${formatScore(low.emotionScore)}</strong></div>
          <div><span>最高峰</span><strong>${escapeHtml(high.name)} · ${formatScore(high.emotionScore)}</strong></div>
        </div>
      </article>
    `;
  }

  function renderEmptyCurveCard(mapping) {
    return `
      <article class="analysis-card emotion-card empty">
        <p class="eyebrow">${escapeHtml(mapping.brand)} · ${escapeHtml(mapping.personName)}</p>
        <h3>${escapeHtml(mapping.brand)}情绪曲线</h3>
        <p class="muted-copy">暂未读取到 ${escapeHtml(mapping.personName)} 的展示数据。请先在展示页导入对应 JSON 或完整证据包 ZIP。</p>
        <div class="modal-actions"><a class="ghost-button" href="./dashboard.html">去展示页导入</a></div>
      </article>
    `;
  }

  function renderStaticStages(active = 0) {
    const timeline = $("#stageTimeline");
    const detail = $("#stageDetail");
    if (!timeline || !detail) return;
    timeline.innerHTML = STATIC_STAGES.map((stage, index) => `
      <button class="stage-button ${index === active ? "active" : ""}" type="button" data-static-stage="${index}">
        <span class="stage-index">${String(index + 1).padStart(2, "0")}</span>
        <strong>${escapeHtml(stage.title)}</strong>
        <span>${escapeHtml(stage.short)}</span>
      </button>
    `).join("");
    renderStaticStageDetail(active);
  }

  function renderStaticStageDetail(index) {
    const detail = $("#stageDetail");
    const stage = STATIC_STAGES[index];
    detail.innerHTML = `
      <p class="eyebrow">Stage ${String(index + 1).padStart(2, "0")}</p>
      <h3>${escapeHtml(stage.title)}</h3>
      <p>${escapeHtml(stage.observe)}</p>
      <div class="detail-block">
        <h4>对简顿的机会</h4>
        <ul>${stage.opportunity.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>
    `;
  }

  function bindStaticInteractions() {
    $("#stageTimeline")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-static-stage]");
      if (!button) return;
      const index = Number(button.dataset.staticStage);
      document.querySelectorAll("[data-static-stage]").forEach((item) => item.classList.toggle("active", item === button));
      renderStaticStageDetail(index);
    });
  }

  function openStageDrawer(record, stage, brand) {
    const drawer = $("#analysisDrawer");
    const dashboardUrl = `./dashboard.html?view=individual&personName=${encodeURIComponent(record.personName)}&stage=${encodeURIComponent(stage.id)}`;
    const files = Array.isArray(stage.evidenceFiles) ? stage.evidenceFiles : [];
    drawer.innerHTML = `
      <div class="drawer-inner">
        <header class="drawer-head">
          <div>
            <p class="eyebrow">${escapeHtml(brand)} · ${escapeHtml(record.personName)}</p>
            <h2>Stage ${String(stage.id).padStart(2, "0")} · ${escapeHtml(stage.name)}</h2>
          </div>
          <button class="ghost-button" type="button" data-close-drawer>关闭</button>
        </header>
        <div class="drawer-body">
          ${detailBlock("情绪", `${formatScore(stage.emotionScore)} · ${stage.emotionLabel || emotionFor(stage.emotionScore).label}`)}
          ${detailBlock("情绪原因", stage.emotionReason || "暂无填写")}
          ${detailBlock("用户目标", stage.goal || "未填写")}
          ${detailBlock("关键行为", stage.actions || "未填写")}
          ${detailBlock("真实想法", stage.thoughts || "未填写")}
          ${detailBlock("痛点", `${stage.painSeverity || "没有"}：${stage.painPoint || "无"}`)}
          ${detailBlock("机会点", stage.opportunity || "未填写")}
          ${detailBlock("内容机会", stage.contentOpportunity || "未填写")}
          <section class="drawer-block">
            <h3>证据摘要</h3>
            ${stage.evidenceText ? `<p class="evidence-text-full">${escapeHtml(stage.evidenceText).replace(/\n/g, "<br>")}</p>` : ""}
            ${files.length ? `<div class="evidence-list">${files.map((file) => renderEvidenceCard(file, stage, record)).join("")}</div>` : "<p>暂无附件证据。</p>"}
          </section>
          <div class="modal-actions">
            <a class="dark-button" href="${dashboardUrl}">在旅程地图中打开</a>
            <button class="ghost-button" type="button" data-focus-evidence>查看原始证据</button>
          </div>
        </div>
      </div>
    `;
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    drawer.querySelector("[data-close-drawer]")?.addEventListener("click", closeStageDrawer);
    drawer.querySelector("[data-focus-evidence]")?.addEventListener("click", () => drawer.querySelector(".evidence-list, .evidence-text-full")?.scrollIntoView({ behavior: "smooth", block: "center" }));
    drawer.querySelectorAll("[data-evidence-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const file = files.find((item) => item.id === button.dataset.evidenceId);
        if (file) openEvidenceModal(file, stage, record, brand);
      });
    });
  }

  function closeStageDrawer() {
    const drawer = $("#analysisDrawer");
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
  }

  function detailBlock(label, value) {
    return `
      <section class="drawer-block">
        <h3>${escapeHtml(label)}</h3>
        <p>${escapeHtml(value).replace(/\n/g, "<br>")}</p>
      </section>
    `;
  }

  function renderEvidenceCard(file, stage, record) {
    const category = file.category || categorizeEvidence(file);
    const thumb = file.thumbnailDataUrl || file.previewDataUrl || "";
    const hasBody = Boolean(file._blob || thumb);
    return `
      <button class="analysis-evidence-card" type="button" data-evidence-id="${escapeHtml(file.id || "")}">
        <span class="analysis-evidence-thumb">${category === "image" && thumb ? `<img src="${escapeHtml(thumb)}" alt="${escapeHtml(file.name || "图片证据")}">` : escapeHtml(fileTypeLabel(file))}</span>
        <span>
          <strong>${escapeHtml(file.name || "未命名文件")}</strong>
          <span>${escapeHtml(stage.name)} · ${formatBytes(file.size || (file._blob && file._blob.size) || 0)}</span>
          <small>${escapeHtml(file.note || (hasBody ? "点击查看证据" : "JSON 仅含文件信息，请导入 ZIP 查看原件"))}</small>
        </span>
      </button>
    `;
  }

  function openEvidenceModal(file, stage, record, brand) {
    const modal = $("#analysisModal");
    const category = file.category || categorizeEvidence(file);
    const objectUrl = file._blob ? createObjectUrl(file._blob) : "";
    const thumb = file.thumbnailDataUrl || file.previewDataUrl || "";
    let body = "";
    if (category === "image" && (objectUrl || thumb)) {
      body = `<img src="${escapeHtml(objectUrl || thumb)}" alt="${escapeHtml(file.name || "证据图片")}">`;
    } else if (category === "pdf" && objectUrl) {
      body = `<iframe src="${escapeHtml(objectUrl)}" title="${escapeHtml(file.name || "PDF 证据")}"></iframe>`;
    } else {
      body = `
        <p class="muted-copy">${objectUrl ? "该文件可下载后查看。" : "当前数据只包含文件名称和说明，没有真实文件本体。请在展示页导入完整证据包 ZIP 后查看原文件。"}</p>
        <dl class="file-info-list">
          <dt>文件名</dt><dd>${escapeHtml(file.name || "未命名文件")}</dd>
          <dt>文件类型</dt><dd>${escapeHtml(fileTypeLabel(file))}</dd>
          <dt>所属阶段</dt><dd>${escapeHtml(stage.name)}</dd>
          <dt>证据说明</dt><dd>${escapeHtml(file.note || "暂无说明")}</dd>
        </dl>
      `;
    }
    modal.innerHTML = `
      <article class="analysis-modal-card">
        <header class="modal-head">
          <div>
            <p class="eyebrow">${escapeHtml(brand)} · ${escapeHtml(record.personName)} · ${escapeHtml(stage.name)}</p>
            <h2>${escapeHtml(file.name || "证据文件")}</h2>
          </div>
          <button class="ghost-button" type="button" data-close-modal>关闭</button>
        </header>
        <div class="modal-body">
          ${body}
          <div class="modal-actions">
            ${objectUrl ? `<button class="dark-button" type="button" data-download-evidence>下载文件</button>` : ""}
            <a class="ghost-button" href="./dashboard.html?view=individual&personName=${encodeURIComponent(record.personName)}&stage=${encodeURIComponent(stage.id)}">在旅程地图中打开</a>
          </div>
        </div>
      </article>
    `;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    modal.querySelector("[data-close-modal]")?.addEventListener("click", closeEvidenceModal);
    modal.querySelector("[data-download-evidence]")?.addEventListener("click", () => downloadBlob(file._blob, file.name || "evidence-file"));
  }

  function closeEvidenceModal() {
    const modal = $("#analysisModal");
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = "";
  }

  function bindReveal() {
    const items = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      items.forEach((item) => item.classList.add("visible"));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: .12 });
    items.forEach((item) => observer.observe(item));
  }

  function bindPageChrome() {
    const progress = $("#scrollProgress");
    const backTop = $("#backTop");
    const navLinks = Array.from(document.querySelectorAll("#reportNav a"));
    const sections = navLinks.map((link) => document.querySelector(link.getAttribute("href"))).filter(Boolean);
    const onScroll = () => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const percent = maxScroll > 0 ? (window.scrollY / maxScroll) * 100 : 0;
      if (progress) progress.style.width = `${percent}%`;
      backTop?.classList.toggle("visible", window.scrollY > 650);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    backTop?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    if ("IntersectionObserver" in window) {
      const activeObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            navLinks.forEach((link) => link.classList.toggle("active", link.getAttribute("href") === `#${entry.target.id}`));
          }
        });
      }, { rootMargin: "-42% 0px -48% 0px", threshold: 0 });
      sections.forEach((section) => activeObserver.observe(section));
    }
    $("#printButton")?.addEventListener("click", () => window.print());
    $("#copyButton")?.addEventListener("click", copySummary);
    $("#analysisModal")?.addEventListener("click", (event) => {
      if (event.target === $("#analysisModal")) closeEvidenceModal();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeEvidenceModal();
        closeStageDrawer();
      }
    });
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText($("#speechText")?.innerText || "");
      showToast("已复制总结");
    } catch {
      showToast("复制失败，可以手动选择摘要文本");
    }
  }

  function findRecord(personName) {
    return state.records.find((record) => record.personName === personName)
      || state.records.find((record) => record.personName && record.personName.includes(personName))
      || null;
  }

  function buildLowestStage(records) {
    const averages = STAGES.map((stage, index) => {
      const scores = records.map((record) => Number(record.stages[index]?.emotionScore)).filter(Number.isFinite);
      return scores.length ? { index, average: scores.reduce((sum, value) => sum + value, 0) / scores.length } : null;
    }).filter(Boolean);
    return averages.sort((a, b) => a.average - b.average)[0] || null;
  }

  function minStage(stages) {
    return [...stages].sort((a, b) => Number(a.emotionScore) - Number(b.emotionScore))[0] || stages[0];
  }

  function maxStage(stages) {
    return [...stages].sort((a, b) => Number(b.emotionScore) - Number(a.emotionScore))[0] || stages[0];
  }

  function scoreToPercent(score) {
    const value = Math.max(-3, Math.min(3, Number(score) || 0));
    return 88 - ((value + 3) / 6) * 76;
  }

  function emotionFor(score) {
    const rounded = Math.max(-3, Math.min(3, Math.round(Number(score) || 0)));
    return EMOTIONS[String(rounded)] || EMOTIONS["0"];
  }

  function formatScore(value) {
    const number = Number(value || 0);
    return number > 0 ? `+${number}` : String(number);
  }

  function categorizeEvidence(file) {
    const type = String(file.type || "").toLowerCase();
    const name = String(file.name || "").toLowerCase();
    if (type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/.test(name)) return "image";
    if (type.includes("pdf") || name.endsWith(".pdf")) return "pdf";
    if (/\.(xlsx?|csv)$/.test(name)) return "sheet";
    if (/\.(docx?|txt)$/.test(name)) return "doc";
    if (/\.(dwg|dxf|cad)$/.test(name)) return "cad";
    return "file";
  }

  function fileTypeLabel(file) {
    const category = file.category || categorizeEvidence(file);
    const name = String(file.name || "");
    const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1];
    if (ext) return ext.toUpperCase();
    return { image: "IMG", pdf: "PDF", sheet: "XLSX", doc: "DOC", cad: "CAD", file: "FILE" }[category] || "FILE";
  }

  function normalizeBlob(file, blob) {
    if (!blob) return null;
    if (blob.type || !file.type) return blob;
    return new Blob([blob], { type: file.type });
  }

  function createObjectUrl(blob) {
    const url = URL.createObjectURL(blob);
    state.objectUrls.add(url);
    return url;
  }

  function downloadBlob(blob, filename) {
    if (!blob) return;
    const url = createObjectUrl(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!value) return "未知大小";
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  function truncateText(text, length) {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    return value.length > length ? `${value.slice(0, length)}...` : value;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function showToast(message) {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
  }

  async function init() {
    bindPageChrome();
    try {
      state.records = await restoreDashboardSession();
      state.dataSource = state.records.length ? "session" : "";
      if (!state.records.length) {
        state.records = await loadPublishedPackages();
        state.dataSource = state.records.length ? "published" : "";
      }
      renderAll();
    } catch (error) {
      $("#restoreState").textContent = `展示数据读取失败：${error.message}`;
      renderAll();
    }
  }

  window.addEventListener("beforeunload", () => {
    state.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    state.objectUrls.clear();
  });

  init();
})();

window.LIGHTING_SUPABASE_CONFIG = {
  enabled: false,
  url: "",
  anonKey: "",
  projectCode: "lighting-journey-main",
  journeysTable: "lighting_journeys",
  evidenceTable: "lighting_evidence_files",
  storageBucket: "lighting-evidence"
};

(function () {
  "use strict";

  const STORAGE_PREFIX = "lightingJourneyMap:v1:";
  const REGISTRY_KEY = `${STORAGE_PREFIX}registry`;
  const JOURNEY_PREFIX = `${STORAGE_PREFIX}journey:`;
  const EVIDENCE_DB_NAME = "lightingJourneyMapEvidence:v1";
  const EVIDENCE_STORE_NAME = "evidenceFiles";
  const STAGES = [
    "第一次了解灯光设计服务",
    "发起咨询",
    "明确服务内容与价格",
    "提交基础信息",
    "准备并提交资料",
    "需求沟通与确认",
    "等待方案",
    "查看并理解方案",
    "修改确认 / 下单 / 施工衔接"
  ];
  const DESCRIPTIONS = [
    "从小红书、店铺、朋友、客服等渠道知道这个服务。",
    "主动问客服或设计师，想知道怎么做。",
    "了解服务包含什么、多少钱、是否返现、是否要买灯。",
    "填问卷、说户型、说需求、说装修阶段。",
    "户型图、CAD、效果图、吊顶图、尺寸、现场照片等。",
    "和客服 / 设计师进一步确认风格、区域、预算、功能。",
    "等设计师出点位、参数、灯具建议或方案文件。",
    "看点位图、参数、灯具配置，判断自己能不能看懂。",
    "反馈修改、确认方案、买灯、和施工方对接。"
  ];
  const EMOTIONS = {
    "-3": "卡住了，想放弃",
    "-2": "有点焦虑 / 费劲",
    "-1": "有点疑惑",
    "0": "无明显感受",
    "1": "还可以，没明显问题",
    "2": "顺畅，比较安心",
    "3": "超预期，很惊喜"
  };

  function createId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function showToast(message) {
    const toast = document.querySelector("#toast");
    if (toast) {
      toast.textContent = message;
      toast.classList.add("show");
      window.setTimeout(() => toast.classList.remove("show"), 2600);
      return;
    }
    window.alert(message);
  }

  function parseTags(value) {
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
    return String(value || "").split(/[、,，\s]+/).map((item) => item.trim()).filter(Boolean);
  }

  function defaultStage(index) {
    const score = 0;
    return {
      id: index + 1,
      name: STAGES[index],
      description: DESCRIPTIONS[index],
      status: "已体验",
      goal: "",
      actions: "",
      touchpoints: [],
      thoughts: "",
      emotionScore: score,
      emotionLabel: EMOTIONS[String(score)],
      emotionReason: "",
      painSeverity: "没有",
      painPoint: "",
      opportunity: "",
      contentOpportunity: "",
      evidenceText: "",
      evidenceFiles: []
    };
  }

  function normalizeJourney(raw, person) {
    const stages = Array.isArray(raw.stages) ? raw.stages : [];
    return {
      version: raw.version || 1,
      journeyId: person.journeyId,
      personId: person.personId,
      personName: person.personName,
      experienceDate: person.experienceDate,
      personaRole: person.personaRole,
      sampleType: person.sampleType,
      tags: person.tags,
      updatedAt: new Date().toISOString(),
      stages: STAGES.map((name, index) => {
        const source = stages[index] || {};
        const score = Number.isFinite(Number(source.emotionScore)) ? Number(source.emotionScore) : 0;
        return {
          ...defaultStage(index),
          ...source,
          id: index + 1,
          name,
          description: DESCRIPTIONS[index],
          emotionScore: score,
          emotionLabel: source.emotionLabel || EMOTIONS[String(score)] || EMOTIONS[0],
          touchpoints: Array.isArray(source.touchpoints) ? source.touchpoints : [],
          evidenceFiles: Array.isArray(source.evidenceFiles) ? source.evidenceFiles : []
        };
      })
    };
  }

  function readRegistry() {
    try {
      const registry = JSON.parse(localStorage.getItem(REGISTRY_KEY) || "{}");
      return { people: Array.isArray(registry.people) ? registry.people : [] };
    } catch {
      return { people: [] };
    }
  }

  function saveRegistry(registry) {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify({ people: registry.people }));
  }

  function compactJourney(data) {
    const copy = JSON.parse(JSON.stringify(data));
    copy.stages.forEach((stage) => {
      stage.evidenceFiles = (stage.evidenceFiles || []).map((file) => {
        const next = { ...file };
        if (next.storageKey || next.thumbnailDataUrl) delete next.previewDataUrl;
        delete next.viewerObjectUrl;
        return next;
      });
    });
    return copy;
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

  async function putEvidenceBlob(record, blob) {
    const db = await openEvidenceDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(EVIDENCE_STORE_NAME, "readwrite");
      tx.objectStore(EVIDENCE_STORE_NAME).put({ ...record, blob });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  }

  function dataUrlToBlob(dataUrl) {
    const [header, payload] = String(dataUrl || "").split(",");
    const mime = (header.match(/data:([^;]+);base64/) || [])[1] || "application/octet-stream";
    const binary = atob(payload || "");
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: mime });
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

  function safeFileName(value) {
    return String(value || "").replace(/[\\/:*?"<>|]/g, "-").replace(/^\.+/, "").slice(0, 120);
  }

  function findZipEntry(zip, zipPath, fileName, stageId) {
    const directPath = String(zipPath || "").replace(/^\/+/, "");
    if (directPath && zip.file(directPath)) return zip.file(directPath);
    const files = Object.values(zip.files).filter((entry) => !entry.dir);
    const safeName = safeFileName(fileName || "");
    const stageToken = `stage-${String(stageId).padStart(2, "0")}`;
    return files.find((entry) => entry.name.includes(stageToken) && entry.name.endsWith(`/${safeName}`))
      || files.find((entry) => entry.name.endsWith(`/${safeName}`))
      || null;
  }

  async function prepareEvidence(data, zip, packageName) {
    for (const stage of data.stages) {
      const files = Array.isArray(stage.evidenceFiles) ? stage.evidenceFiles : [];
      stage.evidenceFiles = [];
      for (const file of files) {
        const next = {
          ...file,
          id: file.id || createId("evidence"),
          stageId: stage.id,
          category: file.category || categorizeFile({ name: file.name, type: file.type }),
          sourcePackageName: packageName || file.sourcePackageName || "",
          hasOriginalFile: false,
          storedInIndexedDB: false
        };
        delete next.storageKey;
        let blob = null;
        if (zip) {
          const entry = findZipEntry(zip, file.zipPath, file.name, stage.id);
          if (entry) blob = await entry.async("blob");
        } else if (file.previewDataUrl && next.category === "image") {
          blob = dataUrlToBlob(file.previewDataUrl);
        }
        if (blob) {
          next.storageKey = `${data.journeyId}:stage-${stage.id}:${next.id}`;
          next.hasOriginalFile = true;
          next.storedInIndexedDB = true;
          next.type = next.type || blob.type || "application/octet-stream";
          next.size = next.size || blob.size;
          next.uploadedAt = next.uploadedAt || new Date().toISOString();
          await putEvidenceBlob({ ...next, journeyId: data.journeyId, stageId: stage.id }, blob).catch(() => {
            delete next.storageKey;
            next.hasOriginalFile = false;
            next.storedInIndexedDB = false;
          });
        }
        if (next.storageKey || next.thumbnailDataUrl) delete next.previewDataUrl;
        stage.evidenceFiles.push(next);
      }
    }
  }

  async function readImportedFile(file) {
    if (String(file.name || "").toLowerCase().endsWith(".zip")) {
      if (!window.JSZip) throw new Error("证据包组件未加载，请刷新页面后再试。");
      const zip = await window.JSZip.loadAsync(file);
      const entry = zip.file("journey.json")
        || Object.values(zip.files).find((item) => !item.dir && item.name.endsWith("/journey.json"));
      if (!entry) throw new Error("这个 ZIP 里没有找到 journey.json。");
      return { raw: JSON.parse(await entry.async("string")), zip };
    }
    return { raw: JSON.parse(await file.text()), zip: null };
  }

  async function importDraft(file) {
    const { raw, zip } = await readImportedFile(file);
    if (!raw || !Array.isArray(raw.stages)) throw new Error("没有识别到旅程阶段数据。");
    const registry = readRegistry();
    const incomingJourneyId = raw.journeyId || createId("journey");
    const existing = registry.people.find((person) => person.journeyId === incomingJourneyId);
    const overwrite = existing
      ? window.confirm(`检测到本机已有「${existing.personName || raw.personName || "这份样本"}」。确定覆盖继续填写；取消则作为副本导入。`)
      : false;
    const person = overwrite && existing ? {
      ...existing,
      personName: raw.personName || existing.personName || "导入样本",
      personaRole: raw.personaRole || existing.personaRole || "内部体验用户",
      sampleType: raw.sampleType || existing.sampleType || "内部体验者",
      experienceDate: raw.experienceDate || existing.experienceDate || new Date().toISOString().slice(0, 10),
      tags: Array.isArray(raw.tags) ? raw.tags : parseTags(raw.tags)
    } : {
      personId: existing ? createId("person") : (raw.personId || createId("person")),
      journeyId: existing ? createId("journey") : incomingJourneyId,
      personName: raw.personName || "导入样本",
      personaRole: raw.personaRole || "内部体验用户",
      sampleType: raw.sampleType || "内部体验者",
      experienceDate: raw.experienceDate || new Date().toISOString().slice(0, 10),
      tags: existing ? [...parseTags(raw.tags), "导入副本"] : parseTags(raw.tags)
    };
    const data = normalizeJourney(raw, person);
    await prepareEvidence(data, zip, file.name);
    registry.people = registry.people.filter((item) => item.journeyId !== data.journeyId);
    registry.people.unshift({
      personId: data.personId,
      journeyId: data.journeyId,
      personName: data.personName,
      personaRole: data.personaRole,
      sampleType: data.sampleType,
      experienceDate: data.experienceDate,
      tags: data.tags,
      updatedAt: data.updatedAt
    });
    saveRegistry(registry);
    localStorage.setItem(`${JOURNEY_PREFIX}${data.journeyId}`, JSON.stringify(compactJourney(data)));
    showToast(`已导入 ${data.personName || "这份草稿"}，页面即将打开继续填写`);
    window.setTimeout(() => window.location.reload(), 650);
  }

  function bind() {
    if (window.LightingJourneyCollectorImportReady) return;
    if (document.body && document.body.dataset.page !== "collector") return;
    const actions = document.querySelector(".top-actions");
    if (!actions) return;
    let button = document.querySelector("#importDraftButton");
    let input = document.querySelector("#importDraftFileInput");
    if (!button) {
      button = document.createElement("button");
      button.className = "ghost-button";
      button.id = "importDraftButton";
      button.type = "button";
      button.textContent = "导入填写内容";
      const cloudButton = document.querySelector("#cloudSubmitButton");
      actions.insertBefore(button, cloudButton || actions.querySelector("#exportJsonButton"));
    }
    if (!input) {
      input = document.createElement("input");
      input.id = "importDraftFileInput";
      input.type = "file";
      input.hidden = true;
      input.accept = ".json,.zip,application/json,application/zip";
      actions.insertBefore(input, button.nextSibling);
    }
    if (!button || !input || button.dataset.importDraftAddonBound) return;
    button.dataset.importDraftAddonBound = "true";
    button.addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) return;
      importDraft(file).catch((error) => showToast(`导入失败：${error.message || "文件格式不正确"}`)).finally(() => {
        input.value = "";
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();

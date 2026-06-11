(function () {
  "use strict";

  const DEFAULT_CONFIG = {
    enabled: false,
    url: "",
    anonKey: "",
    projectCode: "lighting-journey-main",
    journeysTable: "lighting_journeys",
    evidenceTable: "lighting_evidence_files",
    storageBucket: "lighting-evidence"
  };

  const config = {
    ...DEFAULT_CONFIG,
    ...(window.LIGHTING_SUPABASE_CONFIG || {})
  };

  let client = null;

  function isEnabled() {
    return Boolean(config.enabled && config.url && config.anonKey && window.supabase && typeof window.supabase.createClient === "function");
  }

  function getClient() {
    if (!isEnabled()) {
      throw new Error("还没有启用 Supabase。请先填写 assets/supabase-config.js。");
    }
    if (!client) {
      client = window.supabase.createClient(config.url, config.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
    }
    return client;
  }

  function projectCode() {
    return String(config.projectCode || "lighting-journey-main").trim() || "lighting-journey-main";
  }

  function safePathPart(value) {
    return String(value || "file")
      .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 120) || "file";
  }

  function cloneJourney(journey) {
    return JSON.parse(JSON.stringify(journey, (key, value) => {
      if (key === "_blob" || key === "viewerObjectUrl") return undefined;
      return value;
    }));
  }

  function stageFolder(stage) {
    return `stage-${String(stage.id || "0").padStart(2, "0")}-${safePathPart(stage.name || "stage")}`;
  }

  function evidencePath(journey, stage, file) {
    const fileId = file.id || `evidence-${Date.now()}`;
    const fileName = safePathPart(file.name || `${fileId}.bin`);
    return `${projectCode()}/${safePathPart(journey.journeyId || "journey")}/${stageFolder(stage)}/${safePathPart(fileId)}-${fileName}`;
  }

  function categorize(file) {
    const name = String(file.name || "").toLowerCase();
    const type = String(file.type || "").toLowerCase();
    if (type.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic)$/.test(name)) return "image";
    if (type.includes("pdf") || name.endsWith(".pdf")) return "pdf";
    if (/\.(xlsx|xls|csv)$/.test(name)) return "spreadsheet";
    if (/\.(docx?|txt)$/.test(name)) return "document";
    if (/\.(dwg|dxf|cad)$/.test(name)) return "cad";
    if (name.endsWith(".zip")) return "archive";
    return "file";
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

  function mergeCloudFileFields(targetJourney, cloudJourney) {
    (cloudJourney.stages || []).forEach((cloudStage) => {
      const targetStage = (targetJourney.stages || []).find((stage) => Number(stage.id) === Number(cloudStage.id));
      if (!targetStage) return;
      (cloudStage.evidenceFiles || []).forEach((cloudFile) => {
        const targetFile = (targetStage.evidenceFiles || []).find((file) => file.id === cloudFile.id);
        if (!targetFile) return;
        targetFile.cloudStoragePath = cloudFile.cloudStoragePath || cloudFile.storagePath || targetFile.cloudStoragePath || "";
        targetFile.storagePath = cloudFile.storagePath || cloudFile.cloudStoragePath || targetFile.storagePath || "";
        targetFile.hasOriginalFile = Boolean(cloudFile.hasOriginalFile || targetFile.hasOriginalFile);
        targetFile.sourcePackageName = cloudFile.sourcePackageName || targetFile.sourcePackageName || "Supabase";
      });
    });
  }

  async function uploadEvidenceFiles(journey, options = {}) {
    const supabaseClient = getClient();
    const getBlob = typeof options.getBlob === "function" ? options.getBlob : async () => null;
    const cloudJourney = cloneJourney(journey);
    const evidenceRows = [];

    for (const stage of cloudJourney.stages || []) {
      for (const file of stage.evidenceFiles || []) {
        file.category = file.category || categorize(file);
        let blob = null;
        if (file.storageKey) {
          blob = await getBlob(file).catch(() => null);
        }
        if (!blob && file._blob) blob = file._blob;
        if (!blob && file.previewDataUrl) blob = dataUrlToBlob(file.previewDataUrl);
        if (!blob && file.thumbnailDataUrl && file.category === "image") blob = dataUrlToBlob(file.thumbnailDataUrl);

        if (blob) {
          const path = file.cloudStoragePath || file.storagePath || evidencePath(cloudJourney, stage, file);
          const uploadResult = await supabaseClient.storage
            .from(config.storageBucket)
            .upload(path, blob, {
              cacheControl: "3600",
              contentType: file.type || blob.type || "application/octet-stream",
              upsert: true
            });
          if (uploadResult.error) throw uploadResult.error;
          file.cloudStoragePath = path;
          file.storagePath = path;
          file.hasOriginalFile = true;
          file.sourcePackageName = "Supabase";
        }

        evidenceRows.push({
          project_code: projectCode(),
          journey_id: cloudJourney.journeyId,
          stage_id: Number(stage.id),
          evidence_id: file.id,
          name: file.name || "evidence-file",
          type: file.type || "application/octet-stream",
          category: file.category || categorize(file),
          size: Number(file.size || 0),
          note: file.note || "",
          storage_path: file.cloudStoragePath || file.storagePath || "",
          updated_at: new Date().toISOString()
        });

        delete file._blob;
        delete file.viewerObjectUrl;
        delete file.previewDataUrl;
      }
    }

    if (evidenceRows.length) {
      const result = await supabaseClient
        .from(config.evidenceTable)
        .upsert(evidenceRows, { onConflict: "project_code,journey_id,evidence_id" });
      if (result.error) throw result.error;
    }

    return cloudJourney;
  }

  async function saveJourney(journey, options = {}) {
    const supabaseClient = getClient();
    const cloudJourney = await uploadEvidenceFiles(journey, options);
    const result = await supabaseClient
      .from(config.journeysTable)
      .upsert({
        project_code: projectCode(),
        journey_id: cloudJourney.journeyId,
        person_id: cloudJourney.personId || "",
        person_name: cloudJourney.personName || "未命名",
        persona_role: cloudJourney.personaRole || "",
        sample_type: cloudJourney.sampleType || "",
        experience_date: cloudJourney.experienceDate || null,
        tags: Array.isArray(cloudJourney.tags) ? cloudJourney.tags : [],
        journey_data: cloudJourney,
        updated_at: new Date().toISOString()
      }, { onConflict: "project_code,journey_id" })
      .select("journey_data")
      .single();
    if (result.error) throw result.error;
    mergeCloudFileFields(journey, result.data.journey_data);
    return result.data.journey_data;
  }

  async function fetchJourneys() {
    const supabaseClient = getClient();
    const result = await supabaseClient
      .from(config.journeysTable)
      .select("journey_data, updated_at")
      .eq("project_code", projectCode())
      .order("updated_at", { ascending: true });
    if (result.error) throw result.error;
    const journeys = (result.data || []).map((row) => row.journey_data).filter(Boolean);
    const evidenceResult = await supabaseClient
      .from(config.evidenceTable)
      .select("*")
      .eq("project_code", projectCode());
    if (!evidenceResult.error) {
      mergeEvidenceRows(journeys, evidenceResult.data || []);
    }
    return journeys;
  }

  function mergeEvidenceRows(journeys, rows) {
    const byKey = new Map();
    rows.forEach((row) => byKey.set(`${row.journey_id}:${row.stage_id}:${row.evidence_id}`, row));
    journeys.forEach((journey) => {
      (journey.stages || []).forEach((stage) => {
        (stage.evidenceFiles || []).forEach((file) => {
          const row = byKey.get(`${journey.journeyId}:${Number(stage.id)}:${file.id}`);
          if (!row) return;
          file.cloudStoragePath = row.storage_path || file.cloudStoragePath || "";
          file.storagePath = row.storage_path || file.storagePath || "";
          file.category = row.category || file.category || categorize(file);
          file.note = file.note || row.note || "";
          file.hasOriginalFile = Boolean(row.storage_path || file.hasOriginalFile);
          file.sourcePackageName = row.storage_path ? "Supabase" : file.sourcePackageName;
        });
      });
    });
  }

  async function downloadEvidence(file) {
    const path = file && (file.cloudStoragePath || file.storagePath);
    if (!path) return null;
    const result = await getClient().storage.from(config.storageBucket).download(path);
    if (result.error) throw result.error;
    return result.data;
  }

  async function getEvidenceUrl(file, expiresIn = 3600) {
    const path = file && (file.cloudStoragePath || file.storagePath);
    if (!path) return "";
    const signed = await getClient().storage.from(config.storageBucket).createSignedUrl(path, expiresIn);
    if (!signed.error && signed.data && signed.data.signedUrl) return signed.data.signedUrl;
    const publicUrl = getClient().storage.from(config.storageBucket).getPublicUrl(path);
    return publicUrl.data && publicUrl.data.publicUrl ? publicUrl.data.publicUrl : "";
  }

  function subscribeToJourneys(callback) {
    if (!isEnabled()) return null;
    const channel = getClient()
      .channel(`lighting-journeys-${projectCode()}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: config.journeysTable,
        filter: `project_code=eq.${projectCode()}`
      }, (payload) => callback(payload))
      .subscribe();
    return channel;
  }

  window.LightingCloud = {
    config,
    isEnabled,
    saveJourney,
    fetchJourneys,
    downloadEvidence,
    getEvidenceUrl,
    subscribeToJourneys,
    mergeCloudFileFields
  };
})();

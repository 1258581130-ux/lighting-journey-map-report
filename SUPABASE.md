# Supabase 实时版配置

这个项目可以作为公网实时版使用：前端继续放在 GitHub Pages，旅程数据和证据文件放在 Supabase。

## 1. 创建 Supabase 项目

在 Supabase 新建项目后，进入 SQL Editor，执行 `supabase-schema.sql`。

这个 SQL 会创建：

- `lighting_journeys`：保存每份旅程 JSON。
- `lighting_evidence_files`：保存证据文件元信息。
- `lighting-evidence` Storage bucket：保存截图、PDF、Excel、DWG 等文件。

## 2. 填写前端配置

打开 `assets/supabase-config.js`，改成你的项目配置：

```js
window.LIGHTING_SUPABASE_CONFIG = {
  enabled: true,
  url: "https://你的项目.supabase.co",
  anonKey: "你的 anon public key",
  projectCode: "lighting-journey-main",
  journeysTable: "lighting_journeys",
  evidenceTable: "lighting_evidence_files",
  storageBucket: "lighting-evidence"
};
```

只放 `anon public key`，不要放 `service_role key`。

## 3. 使用方式

- 填写页：填写后点击「提交云端」。
- 展示页：点击「读取云端」，或打开页面后等待自动读取。
- 展示页保持打开时，别人提交新样本后会自动刷新。

## 4. 公网安全提醒

当前 SQL 是便于快速公网协作的开放策略：知道网页链接的人可以读取和提交数据。适合内部小组测试、课程作业、临时研究。

更正式的客户数据建议改成 Supabase Auth 登录、私有 Storage 策略，或用带权限的服务端接口。

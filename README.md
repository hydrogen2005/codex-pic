# 图像工作台

一个本地运行的 OpenAI 文生图工具。支持选择图片模型、尺寸和画质，预览并下载 PNG、JPEG 或 WebP。GPT Image 2.6 Sunburst 和 Flare 还支持 GIF 动图和 SVG 矢量图。

## 启动

需要 Node.js 20 或更新版本。双击 `start.cmd`，然后在浏览器打开 [图像工作台](http://127.0.0.1:3210)。也可以在 PowerShell 运行以下命令。

```powershell
Set-Location 'E:\fps\image-studio'
node .\server.mjs
```

在页面填写 OpenAI API Key。若启动时已设置 `OPENAI_API_KEY` 环境变量，服务会直接使用该值。需要保留图片时请点击下载。

默认模型是 `gpt-image-2.6-sunburst`。下拉列表还提供 2.6 Flare、2.5 Sunburst、2.5 Flare 和 GPT Image 2。实际可用性取决于 API 项目权限。每次点击生成会发起一次 API 调用，按项目的 API 用量计费。

选择 GIF 后，尺寸默认切到自动，可设置 2–64 帧和 20–2000 毫秒的单帧时长。默认值为 9 帧和 200 毫秒。尺寸按单帧计算，帧数和尺寸受 API 的像素预算限制。

页面下方显示最近一次请求和响应的 JSON，启动终端也会逐次输出。请求日志包含提示词和模型 ID，响应日志包含 OpenAI HTTP 状态、请求 ID、耗时及返回体。响应没有返回模型 ID 时，`returned_model` 显示 `null`。日志隐藏 API Key，并用字符数替代图片 Base64。

成功生成的图像和提示词会自动保存到当前浏览器的本地历史。点击页面顶部的「历史记录」查看，打开任一条目可查看完整提示词、预览或下载原图。请使用同一浏览器和访问地址查看，清除该站点的数据会删除历史记录。

「使用案例」索引来自 [YouMind OpenLab 中文 README](https://github.com/YouMind-OpenLab/awesome-gpt-image-2/blob/main/README_zh.md)（[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)）。可搜索、筛选并导入正文所列案例的提示词。导入时会展开有默认值的 Raycast 占位符。案例文本随项目提供，样图从 YouMind 加载。运行 `node .\update-cases.mjs` 可更新本地索引。

如果端口 3210 被占用，可以在启动前设置 `$env:IMAGE_STUDIO_PORT = '3211'`，再打开终端显示的地址。按 Ctrl+C 停止服务。

[OpenAI 图片生成接口](https://developers.openai.com/api/reference/resources/images/methods/generate) · [GPT Image 2.6 Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.6-sunburst) · [GPT Image 2.6 Flare](https://developers.openai.com/api/docs/models/gpt-image-2.6-flare)

# 语文听写助手

一个面向语文词语听写的小工具。输入词表后，应用会按设置自动朗读词语，适合家长、老师或学生进行听写练习。

## 功能

- 支持按空格、换行、制表符、中英文标点等常见分隔符解析词表
- 支持自定义分隔符
- 可调整语速、音量、朗读次数和词语间隔
- 支持自动播放和手动确认模式
- 默认使用在线 TTS，在线失败时自动回退到浏览器本地语音
- 可手动优先使用本地语音引擎
- 支持保存、加载、删除词表
- 支持随机排序、隐藏/显示当前词
- 支持浅色/深色主题

## 在线使用

生产环境地址：

- https://tx.c100.net
- https://dictation-cyan.vercel.app

## 本地运行

安装依赖：

```bash
npm install
```

本项目包含 Vercel Serverless Function 用于在线 TTS。推荐使用 Vercel CLI 在本地运行：

```bash
npx vercel dev
```

然后打开 Vercel CLI 提示的本地地址。

如果只想查看静态页面，也可以直接打开 `index.html`，但在线 TTS 接口 `/api/tts` 不会在普通 file URL 下工作。

## 部署

项目已适配 Vercel，推送到 GitHub 后可在 Vercel 中导入仓库部署。

也可以使用 Vercel CLI：

```bash
npx vercel --prod
```

## 目录结构

```text
.
├── api/tts.js        # 在线 TTS 接口，基于 msedge-tts
├── css/style.css     # 页面样式
├── js/app.js         # 前端交互和播放逻辑
├── index.html        # 应用入口
├── package.json
└── package-lock.json
```

## 注意事项

- 在线 TTS 依赖 `msedge-tts`，网络不稳定时可能失败；应用会自动回退到浏览器本地语音。
- 不同浏览器和系统的本地语音音色、语速支持可能不同。
- 词表和设置保存在浏览器 `localStorage` 中，不会上传到服务器。

## 许可证

本项目基于 [MIT License](LICENSE) 开源。

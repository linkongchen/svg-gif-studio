# SVG 动画转 GIF / APNG

一个 JavaScript 网页工具，支持两种输入：

1. 输入公开网页 URL，扫描 HTML 中的内联 SVG 与引用的 `.svg` 文件，逐个导出或将全部结果打包为 ZIP。对 [LDRS](https://uiball.com/ldrs/) 页面内由 JavaScript 生成的 44 款动画提供专门适配。
2. 上传 SVG 文件或粘贴 SVG 代码，预览并导出。

输出格式：有损 GIF（64/128/256 色）、无损 APNG（完整 RGBA 色彩），或同时生成两种。可调整预览颜色、背景、大小、帧率和录制时长。文件在浏览器内编码，SVG 不会上传。

## 运行

```sh
npm start
```

然后打开 `http://127.0.0.1:8765/`。需要 Node.js 18 或更高版本。项目没有 npm 依赖；浏览器通过固定版本的 CDN 加载 LDRS、SnapDOM、gifenc、UPNG.js、DOMPurify 和 JSZip，首次使用需要网络。

如果部署到 GitHub Pages，SVG 上传和 LDRS 模式可以直接使用。**任意 URL 扫描需要同源的 `server.mjs` 服务端**，因为浏览器不能绕过目标网站的 CORS 限制。对于允许跨域读取的公开 URL，纯静态部署也可直接扫描。服务端只接受公开 HTTP/HTTPS 地址，限制响应大小、时间与重定向次数。

扫描的是网页返回的 HTML 和引用 SVG；其他站点由 JavaScript 运行后动态生成的 SVG 不会自动执行或扫描。LDRS 是特例。外部图片、脚本和远程资源会从导入的 SVG 中移除。对自包含的内联 CSS / SMIL 动画可录制；浏览器不支持的效果可能与原图不同。

GIF 格式最多 256 色，无法保证原始 SVG 的色彩无损。无损 APNG 指录制得到的每帧像素以无损 PNG 保存，不代表与矢量 SVG 的分辨率无关。

LDRS、SnapDOM、gifenc、UPNG.js、DOMPurify 和 JSZip 均采用 MIT 许可证；版权归各自作者所有。

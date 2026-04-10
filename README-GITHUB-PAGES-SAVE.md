# 仓库存档使用方式

1. 程序启动时会尝试读取 `data/save-state.json`
2. 你在网页中正常使用程序，数据仍会先保存在浏览器本地
3. 当你希望把当前进度变成仓库正式存档时：
   - 打开“等级分与历史”
   - 点击“保存为仓库存档”
   - 选择并覆盖项目里的 `data/save-state.json`
4. 然后执行：

```powershell
git add .
git commit -m "Update save state"
git push
```

5. 手机刷新 GitHub Pages 页面后，就会读取新的 `data/save-state.json`

如果浏览器不支持直接覆盖文件，程序会下载一个 `save-state.json`，你手动替换到 `data` 目录即可。

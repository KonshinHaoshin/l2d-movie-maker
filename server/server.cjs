const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
const port = 5174;

// 允许跨域（方便 Vite 前端访问）
app.use(cors());

// 模型目录路径
const modelDir = path.join(__dirname, "../public/model");

app.get("/api/models", (req, res) => {
    const folders = fs.readdirSync(modelDir).filter((file) =>
        fs.statSync(path.join(modelDir, file)).isDirectory()
    );

    const modelList = folders.map((folder) => {
        const files = fs.readdirSync(path.join(modelDir, folder));
        const modelFile = files.find(
            (f) => f === "model.json" || f.endsWith(".model3.json")
        );
        if (modelFile) {
            return {
                name: folder,
                path: `/model/${folder}/${modelFile}`,
            };
        }
        return null;
    }).filter(Boolean);

    res.json(modelList);
});

app.listen(port, () => {
    console.log(`🚀 模型服务运行于 http://localhost:${port}/api/models`);
});

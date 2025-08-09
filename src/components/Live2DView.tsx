import { useEffect, useRef } from "react";
import * as PIXI from "pixi.js";
import { Live2DModel } from "pixi-live2d-display";

const Live2DView = () => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        const run = async () => {
            if (!canvasRef.current) {
                console.error("❌ canvasRef is null");
                return;
            }

            (window as any).PIXI = PIXI;

            const app = new PIXI.Application({
                view: canvasRef.current,
                backgroundAlpha: 0,
                resizeTo: window,
            });

            try {
                console.log("📦 正在加载模型...");
                const model = await Live2DModel.from("/model/anon/model.json");

                model.anchor.set(0.5, 0.5);
                model.scale.set(0.3);
                model.position.set(app.screen.width / 2, app.screen.height / 2);

                app.stage.addChild(model);

                model.on("pointertap", () => {
                    model.motion("tap_body");
                });

                window.addEventListener("resize", () => {
                    model.position.set(app.screen.width / 2, app.screen.height / 2);
                });

                console.log("✅ 模型加载成功");
            } catch (err) {
                console.error("❌ 模型加载失败:", err);
            }
        };

        run();

        return () => {
            if (canvasRef.current) {
                const view = canvasRef.current;
                view.width = 0;
                view.height = 0;
            }
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            style={{ width: "100vw", height: "100vh", display: "block" }}
        />
    );
};

export default Live2DView;